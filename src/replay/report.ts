import { StratumStat } from "../expectancy/strata";
import { invNormCDF } from "../math/stats";

export type Verdict = "PASS" | "KILL" | "INCONCLUSIVE";

export interface VerdictResult {
  verdict: Verdict;
  bettableStrata: string[];
  reasons: string[];
  /** Family size (m): number of decidable strata the Bonferroni correction was applied over. */
  strataTested: number;
}

/**
 * PASS: at least one stratum where the anomaly-drift's one-sided Bonferroni-corrected
 *       lower bound >= minDrift, n >= minSample, AND anomaly meanDrift exceeds its
 *       control meanDrift (control is direction-matched to the local move, not an
 *       always-YES baseline -- final-review #4).
 * INCONCLUSIVE: no stratum has n >= minSample for BOTH anomaly and control (m===0).
 * KILL: enough sample everywhere but no stratum clears the corrected bar.
 * (§10 kill-gate honesty; final-review #5 multiple-comparisons correction.)
 */
export function verdictFor(
  stats: StratumStat[],
  minDrift = 0.05,
  minSample = 30,
  alpha = 0.05,
): VerdictResult {
  const byKey = new Map<string, { anomaly?: StratumStat; control?: StratumStat }>();
  for (const s of stats) {
    const e = byKey.get(s.stratumKey) ?? {};
    e[s.kind] = s;
    byKey.set(s.stratumKey, e);
  }

  // Family size (m) = number of decidable strata (both arms present, n >= minSample).
  // One-sided Bonferroni across this family bounds the overall false-positive rate at
  // alpha even when many strata are tested, so a single lucky stratum can't flip the
  // whole run to PASS (final-review #5). When m=1, z = invNormCDF(1 - alpha) (~1.645
  // for alpha=0.05) -- looser than the old two-sided 1.96, which is correct: a lone
  // hypothesis test at alpha shouldn't pay a multi-comparison tax.
  const decidable: Array<{ key: string; anomaly: StratumStat; control: StratumStat }> = [];
  const reasons: string[] = [];

  for (const [key, { anomaly, control }] of byKey) {
    if (!anomaly || !control) {
      reasons.push(`${key}: missing anomaly or control observations`);
      continue;
    }
    if (anomaly.n < minSample || control.n < minSample) {
      reasons.push(`${key}: sample too small (anom n=${anomaly.n}, ctrl n=${control.n})`);
      continue;
    }
    decidable.push({ key, anomaly, control });
  }

  const m = decidable.length;
  reasons.unshift(`strata tested (family size): m=${m}`);

  const bettable: string[] = [];
  if (m > 0) {
    const z = invNormCDF(1 - alpha / m);
    for (const { key, anomaly, control } of decidable) {
      const correctedLo = anomaly.meanDrift - z * anomaly.stdErr;
      const beatsControl = anomaly.meanDrift > control.meanDrift;
      if (correctedLo >= minDrift && beatsControl) {
        bettable.push(key);
        reasons.push(
          `${key}: PASS (correctedLo=${correctedLo.toFixed(3)} >= ${minDrift}, z=${z.toFixed(3)}, beats control)`,
        );
      } else {
        reasons.push(
          `${key}: fails (correctedLo=${correctedLo.toFixed(3)}, z=${z.toFixed(3)}, clearsBar=${correctedLo >= minDrift}, beatsControl=${beatsControl})`,
        );
      }
    }
  }

  let verdict: Verdict;
  if (bettable.length > 0) verdict = "PASS";
  else if (m === 0) verdict = "INCONCLUSIVE";
  else verdict = "KILL";

  return { verdict, bettableStrata: bettable, reasons, strataTested: m };
}

export function renderReport(stats: StratumStat[]): string {
  const header = "stratum                     kind      n      meanDrift   ci95_lo   ci95_hi";
  const rows = stats
    .sort((a, b) => a.stratumKey.localeCompare(b.stratumKey) || a.kind.localeCompare(b.kind))
    .map(
      (s) =>
        `${s.stratumKey.padEnd(26)} ${s.kind.padEnd(8)} ${String(s.n).padStart(5)}   ${s.meanDrift
          .toFixed(4)
          .padStart(9)}  ${s.lo.toFixed(4).padStart(8)}  ${s.hi.toFixed(4).padStart(8)}`,
    );
  return [header, ...rows].join("\n");
}
