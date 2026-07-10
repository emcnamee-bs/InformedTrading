import { describe, it, expect } from "vitest";
import { mean, sampleStd, meanCI95, stdErr, invNormCDF } from "../../src/math/stats";

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

  it("stdErr matches sampleStd/sqrt(n)", () => {
    const xs = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(stdErr(xs)).toBeCloseTo(sampleStd(xs) / Math.sqrt(xs.length), 10);
  });
  it("stdErr of a single value (n<2) is 0", () => expect(stdErr([5])).toBe(0));
  it("stdErr of an empty array is 0", () => expect(stdErr([])).toBe(0));

  it("invNormCDF matches known quantiles", () => {
    expect(invNormCDF(0.975)).toBeCloseTo(1.96, 3);
    expect(invNormCDF(0.995)).toBeCloseTo(2.5758, 3);
    expect(invNormCDF(0.95)).toBeCloseTo(1.6449, 3);
  });
  it("invNormCDF returns NaN outside (0,1)", () => {
    expect(invNormCDF(0)).toBeNaN();
    expect(invNormCDF(1)).toBeNaN();
    expect(invNormCDF(-0.1)).toBeNaN();
    expect(invNormCDF(1.1)).toBeNaN();
  });
});
