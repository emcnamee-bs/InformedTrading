import { describe, it, expect } from "vitest";
import { feePerContract } from "../../src/expectancy/fees";

describe("feePerContract", () => {
  it("peaks near 50 cents and rounds up to the cent", () => {
    // 0.07 * 0.5 * 0.5 = 0.0175 -> ceil to 0.02
    expect(feePerContract(50)).toBeCloseTo(0.02, 6);
  });

  it("is small near the edges", () => {
    // 0.07 * 0.05 * 0.95 = 0.003325 -> ceil to 0.01
    expect(feePerContract(5)).toBeCloseTo(0.01, 6);
  });

  it("is monotonic increasing from an edge toward 50c", () => {
    expect(feePerContract(30)).toBeGreaterThanOrEqual(feePerContract(10));
  });
});
