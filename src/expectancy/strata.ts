import { meanCI95 } from "../math/stats";

export interface Observation {
  stratumKey: string;
  kind: "anomaly" | "control";
  drift: number;
}

export interface StratumStat {
  stratumKey: string;
  kind: "anomaly" | "control";
  n: number;
  meanDrift: number;
  lo: number;
  hi: number;
}

export function aggregate(obs: Observation[]): StratumStat[] {
  const groups = new Map<string, Observation[]>();
  for (const o of obs) {
    const key = `${o.stratumKey}::${o.kind}`;
    const arr = groups.get(key) ?? [];
    arr.push(o);
    groups.set(key, arr);
  }
  const stats: StratumStat[] = [];
  for (const [key, arr] of groups) {
    const [stratumKey, kind] = key.split("::") as [string, "anomaly" | "control"];
    const ci = meanCI95(arr.map((o) => o.drift));
    stats.push({ stratumKey, kind, n: ci.n, meanDrift: ci.mean, lo: ci.lo, hi: ci.hi });
  }
  return stats;
}
