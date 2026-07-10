/**
 * Kalshi per-contract trading fee, in dollars.
 * fee = ceil(0.07 * p * (1 - p) * 100) / 100, with p = priceCents / 100.
 * Peaks near 50c. NOTE: verify exact live schedule per series at build time (§8.1).
 */
export function feePerContract(priceCents: number): number {
  const p = priceCents / 100;
  const rawDollars = 0.07 * p * (1 - p);
  return Math.ceil(rawDollars * 100) / 100;
}
