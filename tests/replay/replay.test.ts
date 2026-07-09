import { describe, it, expect } from "vitest";
import { replayMarket, ReplayInput } from "../../src/replay/replay";
import { realizedDrift } from "../../src/expectancy/drift";
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
      outcome: "yes", openTs: 0, closeTs: 11, liquidityVolume: 5_000,
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
      outcome: "no", openTs: 0, closeTs: 21, liquidityVolume: 10_000,
    };
    const obs = replayMarket({ market, candles: flat, trades: [] }, 3, 5);
    expect(obs.every((o) => o.kind === "control")).toBe(true);
    expect(obs.length).toBeGreaterThan(0);
  });

  it("direction-matches the control to the local move (down-moving window -> NO control bet)", () => {
    // No CUSUM fire (small gradual decline), so control direction falls back to the
    // sign of the window's price change: last close (44) < first close (48) -> "no".
    const baseline = Array.from({ length: 5 }, (_, i) => candle(i, 50, 5, 100));
    const decliningWindow = [candle(5, 48, 5, 100), candle(6, 46, 5, 100), candle(7, 44, 5, 100)];
    const candles = [...baseline, ...decliningWindow];
    const market: ResolvedMarket = {
      marketTicker: "M", seriesTicker: "S", category: "Sports",
      outcome: "no", openTs: 0, closeTs: 8, liquidityVolume: 10_000,
    };
    const obs = replayMarket({ market, candles, trades: [] }, 3, 5);
    expect(obs).toHaveLength(1);
    const control = obs[0]!;
    expect(control.kind).toBe("control");
    const entry = decliningWindow[decliningWindow.length - 1]!;
    const expectedNoDrift = realizedDrift(entry, "no", market.outcome);
    const wouldBeYesDrift = realizedDrift(entry, "yes", market.outcome);
    // Sanity: a NO bet on a market that settles NO is profitable; an always-YES
    // bet on the same market is not -> the two are clearly distinguishable.
    expect(expectedNoDrift).toBeGreaterThan(0);
    expect(wouldBeYesDrift).toBeLessThan(0);
    expect(control.drift).toBeCloseTo(expectedNoDrift, 10);
    expect(control.drift).not.toBeCloseTo(wouldBeYesDrift, 2);
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
      outcome: "yes", openTs: 0, closeTs: 40 * 86400, liquidityVolume: 100_000,
    };
    // Resolution ~40 days after entry (> 31) -> every window skipped.
    expect(replayMarket({ market, candles: [...flat, ...surge], trades }, 3, 5)).toHaveLength(0);
  });

  it("does not record an observation whose drift is non-finite (degenerate entry book)", () => {
    // Flat control candles, but the entry candle for each window has yesAsk.close = 0
    // (empty ask) -> realizedDrift returns NaN for the "yes" control leg -> must be skipped.
    const flat = Array.from({ length: 20 }, (_, i) => candle(i, 50, 5, 100));
    const degenerate = flat.map((c) => ({ ...c, yesAsk: { ...c.yesAsk, close: 0 } }));
    const market: ResolvedMarket = {
      marketTicker: "M", seriesTicker: "S", category: "Sports",
      outcome: "no", openTs: 0, closeTs: 21, liquidityVolume: 10_000,
    };
    const obs = replayMarket({ market, candles: degenerate, trades: [] }, 3, 5);
    expect(obs).toHaveLength(0);
    expect(obs.every((o) => Number.isFinite(o.drift))).toBe(true);
  });
});
