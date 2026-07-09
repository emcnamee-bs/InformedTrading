export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function sampleStd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const ss = xs.reduce((a, b) => a + (b - m) * (b - m), 0);
  return Math.sqrt(ss / (xs.length - 1));
}

export interface MeanCI {
  mean: number;
  lo: number;
  hi: number;
  n: number;
}

/** Normal-approx 95% CI for the mean (adequate at the sample sizes the gate needs). */
export function meanCI95(xs: number[]): MeanCI {
  const n = xs.length;
  const m = mean(xs);
  if (n < 2) return { mean: m, lo: m, hi: m, n };
  const se = sampleStd(xs) / Math.sqrt(n);
  return { mean: m, lo: m - 1.96 * se, hi: m + 1.96 * se, n };
}
