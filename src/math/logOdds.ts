export function clampProb(p: number, eps = 1e-4): number {
  return Math.min(1 - eps, Math.max(eps, p));
}

/** Log-odds of a YES price given in cents (1..99). Clamps to keep finite. */
export function toLogOdds(priceCents: number): number {
  const p = clampProb(priceCents / 100);
  return Math.log(p / (1 - p));
}
