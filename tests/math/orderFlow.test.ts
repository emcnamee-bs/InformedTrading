import { describe, it, expect } from "vitest";
import { flowImbalance, volumeZScore, oiDelta } from "../../src/math/orderFlow";
import { Trade, Candle } from "../../src/kalshi/types";

const trade = (takerSide: "yes" | "no", count: number): Trade => ({
  tradeId: Math.random().toString(36),
  ticker: "T",
  yesPriceCents: 50,
  count,
  takerSide,
  createdTs: 0,
});

describe("order-flow features", () => {
  it("flowImbalance is +1 for all-YES taker flow", () =>
    expect(flowImbalance([trade("yes", 10), trade("yes", 5)])).toBe(1));
  it("flowImbalance is 0 for balanced flow", () =>
    expect(flowImbalance([trade("yes", 5), trade("no", 5)])).toBe(0));
  it("flowImbalance abstains (null) with no trades", () =>
    expect(flowImbalance([])).toBeNull());
  it("volumeZScore flags a spike above baseline", () => {
    const z = volumeZScore(100, [10, 12, 9, 11, 10]);
    expect(z).not.toBeNull();
    expect(z as number).toBeGreaterThan(3);
  });
  it("volumeZScore abstains when baseline too short", () =>
    expect(volumeZScore(100, [10, 12])).toBeNull());
  it("oiDelta reports the rise in open interest", () => {
    const c = (oi: number): Candle => ({
      marketTicker: "T", seriesTicker: "S", endPeriodTs: 0, periodMinutes: 1,
      price: { open: 50, high: 50, low: 50, close: 50, mean: 50 },
      yesBid: { open: 49, high: 49, low: 49, close: 49 },
      yesAsk: { open: 51, high: 51, low: 51, close: 51 },
      volume: 0, openInterest: oi,
    });
    expect(oiDelta([c(100), c(140)])).toBe(40);
  });
});
