import { describe, it, expect } from "vitest";
import { slidingWindows } from "../../src/replay/windows";
import { Candle } from "../../src/kalshi/types";

const c = (ts: number): Candle => ({
  marketTicker: "T", seriesTicker: "S", endPeriodTs: ts, periodMinutes: 1,
  price: { open: 50, high: 50, low: 50, close: 50, mean: 50 },
  yesBid: { open: 49, high: 49, low: 49, close: 49 },
  yesAsk: { open: 51, high: 51, low: 51, close: 51 },
  volume: 1, openInterest: 100,
});

describe("slidingWindows", () => {
  it("yields windows with a preceding baseline and never looks ahead", () => {
    const candles = Array.from({ length: 10 }, (_, i) => c(i));
    const out = slidingWindows(candles, 3, 4);
    expect(out.length).toBeGreaterThan(0);
    for (const w of out) {
      expect(w.window).toHaveLength(3);
      const maxWindowTs = Math.max(...w.window.map((x) => x.endPeriodTs));
      for (const b of w.baseline) expect(b.endPeriodTs).toBeLessThan(maxWindowTs);
    }
  });
});
