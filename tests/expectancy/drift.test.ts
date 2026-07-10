import { describe, it, expect } from "vitest";
import { realizedDrift } from "../../src/expectancy/drift";
import { Candle } from "../../src/kalshi/types";

const c = (yesBid: number, yesAsk: number): Candle => ({
  marketTicker: "T", seriesTicker: "S", endPeriodTs: 0, periodMinutes: 1,
  price: { open: 50, high: 50, low: 50, close: 50, mean: 50 },
  yesBid: { open: yesBid, high: yesBid, low: yesBid, close: yesBid },
  yesAsk: { open: yesAsk, high: yesAsk, low: yesAsk, close: yesAsk },
  volume: 0, openInterest: 0,
});

describe("realizedDrift", () => {
  it("YES win: buy at ask 60c (+fee), settle YES", () => {
    // entryCost = 0.60 + fee(60); payout = 1; return = (1 - cost)/cost
    const d = realizedDrift(c(58, 60), "yes", "yes");
    expect(d).toBeGreaterThan(0.6); // ~ (1-0.62)/0.62
    expect(d).toBeLessThan(0.7);
  });
  it("YES loss: buy at ask 60c, settle NO -> -100%", () => {
    expect(realizedDrift(c(58, 60), "yes", "no")).toBeCloseTo(-1, 6);
  });
  it("NO win: buy NO at (100-58)=42c, settle NO", () => {
    const d = realizedDrift(c(58, 60), "no", "no");
    expect(d).toBeGreaterThan(1.2); // ~ (1-0.43)/0.43
  });
  it("fees make a coin-flip entry negative-EV before any drift", () => {
    // symmetric 50/50 entry both ways, averaged, must be < 0 due to fees+spread
    const win = realizedDrift(c(49, 51), "yes", "yes");
    const loss = realizedDrift(c(49, 51), "yes", "no");
    expect((win + loss) / 2).toBeLessThan(0);
  });

  it("YES side, empty ask (0c) -> degenerate entry -> NaN, not Infinity", () => {
    const result = realizedDrift(c(58, 0), "yes", "yes");
    expect(Number.isNaN(result)).toBe(true);
    expect(Number.isFinite(result)).toBe(false);
  });

  it("NO side, empty bid (yesBid.close = 100) -> entryCents 0 -> NaN, not Infinity", () => {
    const result = realizedDrift(c(100, 100), "no", "no");
    expect(Number.isNaN(result)).toBe(true);
  });

  it("YES side, ask at 100c (entryCents >= 100) -> NaN", () => {
    const result = realizedDrift(c(58, 100), "yes", "yes");
    expect(Number.isNaN(result)).toBe(true);
  });
});
