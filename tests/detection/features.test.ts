import { describe, it, expect } from "vitest";
import { buildFeatures } from "../../src/detection/features";
import { Candle, Trade } from "../../src/kalshi/types";

const candle = (ts: number, close: number, vol: number, oi: number): Candle => ({
  marketTicker: "T", seriesTicker: "S", endPeriodTs: ts, periodMinutes: 1,
  price: { open: close, high: close, low: close, close, mean: close },
  yesBid: { open: close - 1, high: close - 1, low: close - 1, close: close - 1 },
  yesAsk: { open: close + 1, high: close + 1, low: close + 1, close: close + 1 },
  volume: vol, openInterest: oi,
});
const trade = (takerSide: "yes" | "no", count: number): Trade => ({
  tradeId: Math.random().toString(36), ticker: "T", yesPriceCents: 60,
  count, takerSide, createdTs: 0,
});

describe("buildFeatures", () => {
  it("produces a vector; abstained features are null, not noise", () => {
    const baseline = [10, 11, 9, 10, 12].map((v, i) => candle(i, 50, v, 100));
    const window = [candle(5, 50, 90, 100), candle(6, 70, 90, 130), candle(7, 85, 90, 160)];
    const f = buildFeatures(window, [trade("yes", 20), trade("yes", 20)], baseline);
    expect(f.cusumFired).toBe(true);
    expect(f.cusumDir).toBe("yes");
    expect(f.oiDelta).toBe(60);
    expect(f.flowImbalance).toBe(1);
    expect(f.volumeZ).not.toBeNull();
  });

  it("abstains cleanly with no trades and short baseline", () => {
    const f = buildFeatures([candle(0, 50, 1, 100)], [], []);
    expect(f.flowImbalance).toBeNull();
    expect(f.volumeZ).toBeNull();
    expect(f.oiDelta).toBeNull();
  });
});
