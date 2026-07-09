import { describe, it, expect } from "vitest";
import { replayMarket, ReplayInput } from "../../src/replay/replay";
import { Candle, Trade, ResolvedMarket } from "../../src/kalshi/types";

const candle = (ts: number, close: number, vol: number, oi: number): Candle => ({
  marketTicker: "M", seriesTicker: "S", endPeriodTs: ts, periodMinutes: 1,
  price: { open: close, high: close, low: close, close, mean: close },
  yesBid: { open: close - 1, high: close - 1, low: close - 1, close: close - 1 },
  yesAsk: { open: close + 1, high: close + 1, low: close + 1, close: close + 1 },
  volume: vol, openInterest: oi,
});

describe("replayMarket", () => {
  it("emits an anomaly observation on a clear informed-looking upswing", () => {
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
    const market: ResolvedMarket = {
      marketTicker: "M", seriesTicker: "S", category: "Politics",
      outcome: "yes", openTs: 0, closeTs: 11, liquidityCents: 100_000,
    };
    const input: ReplayInput = { market, candles, trades };
    const obs = replayMarket(input, 3, 5);
    const anomalies = obs.filter((o) => o.kind === "anomaly");
    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies[0]!.stratumKey).toBe("Politics|mid");
    // YES surge, settles YES -> positive drift recorded
    expect(anomalies[0]!.drift).toBeGreaterThan(0);
  });

  it("emits control observations for non-anomaly windows", () => {
    const flat = Array.from({ length: 20 }, (_, i) => candle(i, 50, 5, 100));
    const market: ResolvedMarket = {
      marketTicker: "M", seriesTicker: "S", category: "Sports",
      outcome: "no", openTs: 0, closeTs: 21, liquidityCents: 10_000,
    };
    const obs = replayMarket({ market, candles: flat, trades: [] }, 3, 5);
    expect(obs.every((o) => o.kind === "control")).toBe(true);
    expect(obs.length).toBeGreaterThan(0);
  });

  it("excludes observations whose resolution is more than ~1 month out", () => {
    const flat = Array.from({ length: 8 }, (_, i) => candle(i, 50, 5, 100));
    const surge = [candle(8, 62, 80, 130), candle(9, 74, 80, 160), candle(10, 86, 80, 190)];
    const trades: Trade[] = surge.map((c, i) => ({
      tradeId: `t${i}`, ticker: "M", yesPriceCents: c.price.close,
      count: 80, takerSide: "yes", createdTs: c.endPeriodTs,
    }));
    const market: ResolvedMarket = {
      marketTicker: "M", seriesTicker: "S", category: "Politics",
      outcome: "yes", openTs: 0, closeTs: 40 * 86400, liquidityCents: 100_000,
    };
    // Resolution ~40 days after entry (> 31) -> every window skipped.
    expect(replayMarket({ market, candles: [...flat, ...surge], trades }, 3, 5)).toHaveLength(0);
  });
});
