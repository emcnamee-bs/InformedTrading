import { describe, it, expect } from "vitest";
import { cusum } from "../../src/math/cusum";
import { toLogOdds } from "../../src/math/logOdds";

describe("cusum", () => {
  it("does not fire on a flat, slightly noisy series", () => {
    const prices = [50, 51, 49, 50, 51, 49, 50, 51, 49, 50];
    const lo = prices.map(toLogOdds);
    expect(cusum(lo, 0.5, 5).fired).toBe(false);
  });

  it("fires YES on a strong sustained upward jump", () => {
    const prices = [50, 50, 50, 50, 60, 70, 80, 88, 92, 95];
    const lo = prices.map(toLogOdds);
    const r = cusum(lo, 0.5, 4);
    expect(r.fired).toBe(true);
    expect(r.direction).toBe("yes");
  });

  it("fires NO on a strong sustained downward jump", () => {
    const prices = [50, 50, 50, 50, 40, 30, 20, 12, 8, 5];
    const lo = prices.map(toLogOdds);
    const r = cusum(lo, 0.5, 4);
    expect(r.fired).toBe(true);
    expect(r.direction).toBe("no");
  });

  it("abstains (no fire) on too-short series", () => {
    expect(cusum([0.1, 0.2], 0.5, 4).fired).toBe(false);
  });
});
