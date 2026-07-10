import { describe, it, expect } from "vitest";
import { toLogOdds, clampProb } from "../../src/math/logOdds";

describe("logOdds", () => {
  it("50c maps to 0", () => expect(toLogOdds(50)).toBeCloseTo(0, 9));
  it("is symmetric: logodds(30) === -logodds(70)", () =>
    expect(toLogOdds(30)).toBeCloseTo(-toLogOdds(70), 9));
  it("clamps extreme prices instead of returning +/-Infinity", () => {
    expect(Number.isFinite(toLogOdds(0))).toBe(true);
    expect(Number.isFinite(toLogOdds(100))).toBe(true);
  });
  it("clampProb keeps values inside (0,1)", () => {
    expect(clampProb(0)).toBeGreaterThan(0);
    expect(clampProb(1)).toBeLessThan(1);
  });
});
