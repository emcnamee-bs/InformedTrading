import { describe, it, expect } from "vitest";
import { verdictFor, renderReport } from "../../src/replay/report";
import { StratumStat } from "../../src/expectancy/strata";

const stat = (kind: "anomaly" | "control", n: number, mean: number, lo: number, hi: number): StratumStat =>
  ({ stratumKey: "Politics|mid", kind, n, meanDrift: mean, lo, hi });

describe("verdictFor", () => {
  it("PASS when an anomaly stratum clears drift+sample AND beats its control", () => {
    const stats = [
      stat("anomaly", 60, 0.12, 0.06, 0.18),
      stat("control", 200, -0.02, -0.04, 0.0),
    ];
    const r = verdictFor(stats, 0.05, 30);
    expect(r.verdict).toBe("PASS");
    expect(r.bettableStrata).toContain("Politics|mid");
  });

  it("KILL when anomaly drift CI lower bound is below the bar despite big sample", () => {
    const stats = [
      stat("anomaly", 200, 0.01, -0.03, 0.05),
      stat("control", 200, 0.0, -0.02, 0.02),
    ];
    expect(verdictFor(stats, 0.05, 30).verdict).toBe("KILL");
  });

  it("INCONCLUSIVE when samples are too small to decide", () => {
    const stats = [stat("anomaly", 5, 0.2, -0.1, 0.5), stat("control", 5, 0.0, -0.1, 0.1)];
    expect(verdictFor(stats, 0.05, 30).verdict).toBe("INCONCLUSIVE");
  });

  it("renderReport produces a non-empty table string", () => {
    expect(renderReport([stat("anomaly", 60, 0.12, 0.06, 0.18)]).length).toBeGreaterThan(0);
  });
});
