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
      obs.push({
        stratumKey: key,
        kind: "anomaly",
        drift: realizedDrift(entry, direction, market.outcome),
      });
    } else if (idx % CONTROL_EVERY === 0) {
      // control: what a naive YES-follow would have returned here
      obs.push({
        stratumKey: key,
        kind: "control",
        drift: realizedDrift(entry, "yes", market.outcome),
      });
    }
  });

  return obs;
}
