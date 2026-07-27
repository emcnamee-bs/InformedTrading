import { LiveMarket, Candle, Trade, Side } from "../kalshi/types";
import { buildFeatures, FeatureVector } from "../detection/features";
import { detectAnomaly } from "../detection/anomaly";
import { slidingWindows } from "../replay/windows";

export interface LiveCandidate {
  market: LiveMarket;
  direction: Side;
  anomalyScore: number;
  entryCents: number;
}

/**
 * First-pass ranking scalar for candidate anomalies. Combines CUSUM firing,
 * order-flow imbalance magnitude, a capped volume z-score, and VPIN. Not a
 * probability -- purely for ordering/prioritizing candidates. Tune later.
 */
export function anomalyScore(f: FeatureVector): number {
  return (
    (f.cusumFired ? 1 : 0) +
    Math.abs(f.flowImbalance ?? 0) +
    Math.min(1, Math.max(0, (f.volumeZ ?? 0) / 5)) +
    (f.vpin ?? 0)
  );
}

/**
 * Runs the existing anomaly detector on the LATEST sliding window of the given
 * candles/trades and, if it fires, returns a live trade candidate for `market`.
 * Entry price is the side's cost to enter now: yesAskCents for YES, or
 * 100 - yesBidCents for NO. Returns null if no window is available or no
 * anomaly is detected.
 */
export function detectCandidateWithFeatures(
  market: LiveMarket,
  candles: Candle[],
  trades: Trade[],
  windowSize = 3,
  baselineSize = 5,
): { candidate: LiveCandidate; features: FeatureVector } | null {
  const slices = slidingWindows(candles, windowSize, baselineSize);
  if (slices.length === 0) return null;
  const slice = slices[slices.length - 1]!; // latest window, no lookahead
  const wt = trades.filter(
    (t) => t.createdTs >= slice.window[0]!.endPeriodTs && t.createdTs <= slice.endTs,
  );
  const f = buildFeatures(slice.window, wt, slice.baseline);
  const { isAnomaly, direction } = detectAnomaly(f);
  if (!isAnomaly || !direction) return null;
  const entryCents = direction === "yes" ? market.yesAskCents : 100 - market.yesBidCents;
  return { candidate: { market, direction, anomalyScore: anomalyScore(f), entryCents }, features: f };
}

export function detectCandidate(
  market: LiveMarket,
  candles: Candle[],
  trades: Trade[],
  windowSize = 3,
  baselineSize = 5,
): LiveCandidate | null {
  return detectCandidateWithFeatures(market, candles, trades, windowSize, baselineSize)?.candidate ?? null;
}
