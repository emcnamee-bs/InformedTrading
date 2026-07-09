import { StratumStat } from "../expectancy/strata";

export type Verdict = "PASS" | "KILL" | "INCONCLUSIVE";

export interface VerdictResult {
  verdict: Verdict;
  bettableStrata: string[];
  reasons: string[];
}

/**
 * PASS: at least one stratum where the anomaly-drift 95% CI lower bound >= minDrift,
 *       n >= minSample, AND anomaly meanDrift exceeds its control meanDrift.
 * INCONCLUSIVE: no stratum has n >= minSample for BOTH anomaly and control.
 * KILL: enough sample everywhere but no stratum clears the bar.
 * (§10 kill-gate honesty.)
 */
export function verdictFor(
  stats: StratumStat[],
  minDrift = 0.05,
  minSample = 30,
): VerdictResult {
  const byKey = new Map<string, { anomaly?: StratumStat; control?: StratumStat }>();
  for (const s of stats) {
    const e = byKey.get(s.stratumKey) ?? {};
    e[s.kind] = s;
    byKey.set(s.stratumKey, e);
  }

  const bettable: string[] = [];
  const reasons: string[] = [];
  let anyDecidable = false;

  for (const [key, { anomaly, control }] of byKey) {
    if (!anomaly || !control) {
      reasons.push(`${key}: missing anomaly or control observations`);
      continue;
    }
    const decidable = anomaly.n >= minSample && control.n >= minSample;
    if (!decidable) {
      reasons.push(`${key}: sample too small (anom n=${anomaly.n}, ctrl n=${control.n})`);
      continue;
    }
    anyDecidable = true;
    const clearsBar = anomaly.lo >= minDrift;
    const beatsControl = anomaly.meanDrift > control.meanDrift;
    if (clearsBar && beatsControl) {
      bettable.push(key);
      reasons.push(`${key}: PASS (anom lo=${anomaly.lo.toFixed(3)} >= ${minDrift}, beats control)`);
    } else {
      reasons.push(
        `${key}: fails (lo=${anomaly.lo.toFixed(3)}, clearsBar=${clearsBar}, beatsControl=${beatsControl})`,
      );
    }
  }

  let verdict: Verdict;
  if (bettable.length > 0) verdict = "PASS";
  else if (!anyDecidable) verdict = "INCONCLUSIVE";
  else verdict = "KILL";

  return { verdict, bettableStrata: bettable, reasons };
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
