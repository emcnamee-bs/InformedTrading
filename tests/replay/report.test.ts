import { describe, it, expect } from "vitest";
import { verdictFor, renderReport } from "../../src/replay/report";
import { StratumStat } from "../../src/expectancy/strata";

const stat = (
  kind: "anomaly" | "control",
  n: number,
  mean: number,
  lo: number,
  hi: number,
  stdErr: number,
  stratumKey = "Politics|mid",
): StratumStat => ({ stratumKey, kind, n, meanDrift: mean, lo, hi, stdErr });

describe("verdictFor", () => {
  it("PASS when an anomaly stratum clears the Bonferroni-corrected bound AND beats its control", () => {
    const stats = [
      stat("anomaly", 60, 0.12, 0.06, 0.18, 0.03),
      stat("control", 200, -0.02, -0.04, 0.0, 0.01),
    ];
    const r = verdictFor(stats, 0.05, 30);
    expect(r.verdict).toBe("PASS");
    expect(r.bettableStrata).toContain("Politics|mid");
    expect(r.strataTested).toBe(1);
  });

  it("KILL when anomaly drift corrected lower bound is below the bar despite big sample", () => {
    const stats = [
      stat("anomaly", 200, 0.01, -0.03, 0.05, 0.02),
      stat("control", 200, 0.0, -0.02, 0.02, 0.02),
    ];
    const r = verdictFor(stats, 0.05, 30);
    expect(r.verdict).toBe("KILL");
    expect(r.strataTested).toBe(1);
  });

  it("INCONCLUSIVE when samples are too small to decide", () => {
    const stats = [
      stat("anomaly", 5, 0.2, -0.1, 0.5, 0.1),
      stat("control", 5, 0.0, -0.1, 0.1, 0.1),
    ];
    const r = verdictFor(stats, 0.05, 30);
    expect(r.verdict).toBe("INCONCLUSIVE");
    expect(r.strataTested).toBe(0);
  });

  it("renderReport produces a non-empty table string", () => {
    expect(renderReport([stat("anomaly", 60, 0.12, 0.06, 0.18, 0.03)]).length).toBeGreaterThan(0);
  });

  it("Bonferroni: a stratum that PASSES at m=1 FAILS once the decidable-stratum family is large", () => {
    // Target stratum: at m=1, z = invNormCDF(0.95) ~= 1.6449.
    // correctedLo = 0.11 - 1.6449*0.03 = 0.11 - 0.04935 = 0.06065 >= 0.05 -> PASS.
    const target = [
      stat("anomaly", 60, 0.11, 0.05, 0.17, 0.03, "Target|mid"),
      stat("control", 200, -0.01, -0.03, 0.01, 0.01, "Target|mid"),
    ];
    const r1 = verdictFor(target, 0.05, 30);
    expect(r1.verdict).toBe("PASS");
    expect(r1.strataTested).toBe(1);

    // Add 19 more decidable-but-failing strata -> family size m=20.
    // z = invNormCDF(1 - 0.05/20) = invNormCDF(0.9975) ~= 2.807.
    // correctedLo = 0.11 - 2.807*0.03 = 0.11 - 0.08421 = 0.02579 < 0.05 -> the same
    // target stratum now FAILS; none of the filler strata pass either -> KILL.
    const filler: StratumStat[] = [];
    for (let i = 0; i < 19; i++) {
      const key = `Filler${i}|mid`;
      filler.push(stat("anomaly", 40, 0.01, -0.02, 0.04, 0.02, key));
      filler.push(stat("control", 40, 0.0, -0.02, 0.02, 0.02, key));
    }
    const stats2 = [...target, ...filler];
    const r2 = verdictFor(stats2, 0.05, 30);
    expect(r2.strataTested).toBe(20);
    expect(r2.bettableStrata).toHaveLength(0);
    expect(r2.verdict).toBe("KILL");
  });
});
