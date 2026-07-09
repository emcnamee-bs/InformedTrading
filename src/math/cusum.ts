import { Side } from "../kalshi/types";
import { sampleStd } from "./stats";

export interface CusumResult {
  sHi: number;
  sLo: number;
  fired: boolean;
  direction: Side | null;
}

/**
 * Two-sided CUSUM on standardized increments of a log-odds series.
 * Detects a sustained regime shift away from the no-drift (zero) expectation.
 * `k` = slack (in std units), `h` = decision threshold. Abstains if < 3 points.
 */
export function cusum(logOddsSeries: number[], k: number, h: number): CusumResult {
  if (logOddsSeries.length < 3) {
    return { sHi: 0, sLo: 0, fired: false, direction: null };
  }
  const diffs: number[] = [];
  for (let i = 1; i < logOddsSeries.length; i++) {
    diffs.push(logOddsSeries[i]! - logOddsSeries[i - 1]!);
  }
  const sd = sampleStd(diffs) || 1;
  let sHi = 0;
  let sLo = 0;
  for (const d of diffs) {
    const z = d / sd;
    sHi = Math.max(0, sHi + z - k);
    sLo = Math.min(0, sLo + z + k);
  }
  const firedHi = sHi > h;
  const firedLo = sLo < -h;
  const fired = firedHi || firedLo;
  let direction: Side | null = null;
  if (fired) direction = sHi >= -sLo ? "yes" : "no";
  return { sHi, sLo, fired, direction };
}
