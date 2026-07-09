import { describe, it, expect } from "vitest";
import { liquidityBand, stratumKey } from "../../src/detection/stratum";
import { aggregate, Observation } from "../../src/expectancy/strata";
import { ResolvedMarket } from "../../src/kalshi/types";

describe("stratum keys", () => {
  it("bands by liquidity", () => {
    expect(liquidityBand(1000)).toBe("thin");
    expect(liquidityBand(100_000)).toBe("mid");
    expect(liquidityBand(9_000_000)).toBe("deep");
  });
  it("builds a category|band key", () => {
    const m: ResolvedMarket = {
      marketTicker: "K", seriesTicker: "S", category: "Politics",
      outcome: "yes", openTs: 0, closeTs: 1, liquidityCents: 100_000,
    };
    expect(stratumKey(m)).toBe("Politics|mid");
  });
});

describe("aggregate", () => {
  it("groups by (stratumKey, kind) and reports CI + n", () => {
    const obs: Observation[] = [
      { stratumKey: "Politics|mid", kind: "anomaly", drift: 0.1 },
      { stratumKey: "Politics|mid", kind: "anomaly", drift: 0.2 },
      { stratumKey: "Politics|mid", kind: "control", drift: -0.05 },
    ];
    const stats = aggregate(obs);
    const anom = stats.find((s) => s.kind === "anomaly")!;
    expect(anom.n).toBe(2);
    expect(anom.meanDrift).toBeCloseTo(0.15, 6);
    const ctrl = stats.find((s) => s.kind === "control")!;
    expect(ctrl.n).toBe(1);
  });
});
