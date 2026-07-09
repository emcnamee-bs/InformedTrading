import { describe, it, expect } from "vitest";
import { RateGovernor } from "../../src/kalshi/rateGovernor";

describe("RateGovernor", () => {
  it("spaces out acquisitions to ~1/rps seconds", async () => {
    const gov = new RateGovernor(50); // 50 rps -> 20ms spacing
    const start = Date.now();
    await gov.acquire();
    await gov.acquire();
    await gov.acquire();
    expect(Date.now() - start).toBeGreaterThanOrEqual(35); // >= 2 gaps of ~20ms
  });
});
