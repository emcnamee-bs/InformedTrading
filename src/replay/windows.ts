import { Candle } from "../kalshi/types";

export interface WindowSlice {
  window: Candle[];
  baseline: Candle[];
  endTs: number;
}

/**
 * Sliding windows over time-ordered candles. Each window is `size` candles;
 * `baseline` is the up-to-`baselineSize` candles immediately preceding the
 * window. Never includes any candle at or after the window (no lookahead).
 */
export function slidingWindows(
  candles: Candle[],
  size: number,
  baselineSize: number,
): WindowSlice[] {
  const sorted = [...candles].sort((a, b) => a.endPeriodTs - b.endPeriodTs);
  const out: WindowSlice[] = [];
  for (let start = baselineSize; start + size <= sorted.length; start++) {
    const window = sorted.slice(start, start + size);
    const baseline = sorted.slice(Math.max(0, start - baselineSize), start);
    out.push({ window, baseline, endTs: window[window.length - 1]!.endPeriodTs });
  }
  return out;
}
