import { Candle, Trade, ResolvedMarket } from "../kalshi/types";
import { buildFeatures } from "../detection/features";
import { detectAnomaly } from "../detection/anomaly";
import { realizedDrift } from "../expectancy/drift";
import { stratumKey } from "../detection/stratum";
import { Observation } from "../expectancy/strata";
import { slidingWindows } from "./windows";

export interface ReplayInput {
  market: ResolvedMarket;
  candles: Candle[];
  trades: Trade[];
}

const CONTROL_EVERY = 5; // subsample control windows to bound their count
const MAX_HORIZON_DAYS = 31; // < ~1 month; enforces the §8.1 time gate inside the replay

/** Trades whose createdTs falls within [startTs, endTs] (no lookahead). */
function tradesInWindow(trades: Trade[], startTs: number, endTs: number): Trade[] {
  return trades.filter((t) => t.createdTs >= startTs && t.createdTs <= endTs);
}

export function replayMarket(
  input: ReplayInput,
  windowSize = 3,
  baselineSize = 5,
  maxHorizonDays = MAX_HORIZON_DAYS,
): Observation[] {
  const { market, candles, trades } = input;
  const key = stratumKey(market);
  const slices = slidingWindows(candles, windowSize, baselineSize);
  const obs: Observation[] = [];
  const maxHorizonSec = maxHorizonDays * 86400;

  slices.forEach((slice, idx) => {
    const startTs = slice.window[0]!.endPeriodTs;
    const wt = tradesInWindow(trades, startTs, slice.endTs);
    const features = buildFeatures(slice.window, wt, slice.baseline);
    const { isAnomaly, direction } = detectAnomaly(features);
    const entry = slice.window[slice.window.length - 1]!;

    // Horizon filter (< 1 month): only count markets resolving within the bettable window (§8.1).
    const horizonSec = market.closeTs - entry.endPeriodTs;
    if (horizonSec <= 0 || horizonSec > maxHorizonSec) return;

    if (isAnomaly && direction) {
      const drift = realizedDrift(entry, direction, market.outcome);
      // Belt-and-suspenders: a degenerate entry book yields NaN (see drift.ts); don't
      // record it (aggregate() also filters non-finite drifts as the required safety net).
      if (Number.isFinite(drift)) obs.push({ stratumKey: key, kind: "anomaly", drift });
    } else if (idx % CONTROL_EVERY === 0) {
      // Direction-matched control: what a naive follow-the-local-move bet would have
      // returned here. Uses CUSUM's direction if it has one (even unconfirmed/unfired
      // it still reflects the window's regime), else falls back to the sign of the
      // window's own price change. This is a like-for-like baseline against the
      // anomaly strategy's own direction call -- an always-YES control would make
      // "anomaly beats control" trivially true on markets that settle NO (final-review #4).
      const controlDir =
        features.cusumDir ??
        (entry.price.close >= slice.window[0]!.price.close ? "yes" : "no");
      const drift = realizedDrift(entry, controlDir, market.outcome);
      if (Number.isFinite(drift)) obs.push({ stratumKey: key, kind: "control", drift });
    }
  });

  return obs;
}
