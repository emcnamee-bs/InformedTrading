import { describe, it, expect } from "vitest";
import { mean, sampleStd, meanCI95 } from "../../src/math/stats";

describe("stats", () => {
  it("mean of [1,2,3] is 2", () => expect(mean([1, 2, 3])).toBe(2));
  it("sampleStd of [2,4,4,4,5,5,7,9] is 2.138...", () =>
    expect(sampleStd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4));
  it("sampleStd of a single value is 0", () =>
    expect(sampleStd([5])).toBe(0));
  it("meanCI95 brackets the mean and reports n", () => {
    const ci = meanCI95([1, 2, 3, 4, 5]);
    expect(ci.mean).toBe(3);
    expect(ci.lo).toBeLessThan(3);
    expect(ci.hi).toBeGreaterThan(3);
    expect(ci.n).toBe(5);
  });
});
