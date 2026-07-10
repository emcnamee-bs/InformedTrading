import { Trade } from "../kalshi/types";

/**
 * Volume-synchronized probability of informed trading (Easley et al. 2011),
 * simplified for exact taker classification (Kalshi provides takerSide).
 * Fills fixed-size volume buckets in trade order; returns the mean order-flow
 * imbalance over the last `numBuckets` COMPLETE buckets. Abstains (null) if
 * fewer than `numBuckets` complete buckets can be formed (volume floor, #4).
 */
export function vpin(
  trades: Trade[],
  bucketSize: number,
  numBuckets: number,
): number | null {
  const buckets: { buy: number; sell: number }[] = [];
  let buy = 0;
  let sell = 0;
  let filled = 0;

  for (const tr of trades) {
    let remaining = tr.count;
    while (remaining > 0) {
      const room = bucketSize - filled;
      const take = Math.min(room, remaining);
      if (tr.takerSide === "yes") buy += take;
      else sell += take;
      filled += take;
      remaining -= take;
      if (filled === bucketSize) {
        buckets.push({ buy, sell });
        buy = 0;
        sell = 0;
        filled = 0;
      }
    }
  }

  if (buckets.length < numBuckets) return null;
  const last = buckets.slice(-numBuckets);
  const sum = last.reduce((a, b) => a + Math.abs(b.buy - b.sell) / bucketSize, 0);
  return sum / numBuckets;
}
