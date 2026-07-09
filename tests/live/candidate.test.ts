import { describe, it, expect } from "vitest";
import { detectCandidate, anomalyScore } from "../../src/live/candidate";
import { LiveMarket, Candle, Trade } from "../../src/kalshi/types";

const candle = (ts: number, close: number, vol: number, oi: number): Candle => ({
  marketTicker: "M", seriesTicker: "S", endPeriodTs: ts, periodMinutes: 1,
  price: { open: close, high: close, low: close, close, mean: close },
  yesBid: { open: close - 1, high: close - 1, low: close - 1, close: close - 1 },
  yesAsk: { open: close + 1, high: close + 1, low: close + 1, close: close + 1 },
  volume: vol, openInterest: oi,
});

describe("detectCandidate", () => {
  it("returns a YES candidate on a clear informed-looking upswing", () => {
    // flat baseline, then a sharp confirmed upswing on heavy YES volume
    const flat = Array.from({ length: 8 }, (_, i) => candle(i, 50, 5, 100));
    const surge = [
      candle(8, 62, 80, 130),
      candle(9, 74, 80, 160),
      candle(10, 86, 80, 190),
    ];
    const candles = [...flat, ...surge];
    const trades: Trade[] = surge.flatMap((c, i) => [
      { tradeId: `t${i}a`, ticker: "M", yesPriceCents: c.price.close, count: 40, takerSide: "yes", createdTs: c.endPeriodTs },
      { tradeId: `t${i}b`, ticker: "M", yesPriceCents: c.price.close, count: 40, takerSide: "yes", createdTs: c.endPeriodTs },
    ]);
    const market: LiveMarket = {
      marketTicker: "M", seriesTicker: "S", category: "Politics",
      openTs: 0, closeTs: 20, liquidityVolume: 5_000,
      yesBidCents: 60, yesAskCents: 62,
    };
    const candidate = detectCandidate(market, candles, trades, 3, 5);
    expect(candidate).not.toBeNull();
    expect(candidate!.direction).toBe("yes");
    expect(candidate!.entryCents).toBe(62);
    expect(candidate!.anomalyScore).toBeGreaterThan(0);
    expect(Number.isFinite(candidate!.anomalyScore)).toBe(true);
  });

  it("returns null on a flat market with no anomaly", () => {
    const flat = Array.from({ length: 20 }, (_, i) => candle(i, 50, 5, 100));
    const market: LiveMarket = {
      marketTicker: "M", seriesTicker: "S", category: "Sports",
      openTs: 0, closeTs: 21, liquidityVolume: 10_000,
      yesBidCents: 49, yesAskCents: 51,
    };
    const candidate = detectCandidate(market, flat, [], 3, 5);
    expect(candidate).toBeNull();
  });

  it("anomalyScore is a finite, non-negative combination of feature signals", () => {
    const score = anomalyScore({
      cusumFired: true, cusumDir: "yes", flowImbalance: 0.5, volumeZ: 10, oiDelta: 5, vpin: 0.3,
    });
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThan(0);
  });
});
