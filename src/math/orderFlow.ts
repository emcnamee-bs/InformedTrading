import { Candle, Trade } from "../kalshi/types";
import { mean, sampleStd } from "./stats";

/** Signed taker-flow imbalance in [-1,1]. Abstains (null) with no trades. */
export function flowImbalance(trades: Trade[]): number | null {
  if (trades.length === 0) return null;
  let yes = 0;
  let no = 0;
  for (const t of trades) {
    if (t.takerSide === "yes") yes += t.count;
    else no += t.count;
  }
  const total = yes + no;
  if (total === 0) return null;
  return (yes - no) / total;
}

/** z-score of window volume vs a trailing baseline. Abstains if baseline < 5. */
export function volumeZScore(windowVol: number, baselineVols: number[]): number | null {
  if (baselineVols.length < 5) return null;
  const sd = sampleStd(baselineVols);
  if (sd === 0) return null;
  return (windowVol - mean(baselineVols)) / sd;
}

/** Change in open interest across a window (last - first). Abstains if < 2 candles. */
export function oiDelta(candles: Candle[]): number | null {
  if (candles.length < 2) return null;
  return candles[candles.length - 1]!.openInterest - candles[0]!.openInterest;
}
