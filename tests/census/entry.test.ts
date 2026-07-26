import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InsiderDb } from "../../src/census/insiderDb";
import { runEntryCycle, MarketData } from "../../src/census/entry";
import { LiveMarket, Candle, Trade } from "../../src/kalshi/types";

const dirs: string[] = [];
const tmpDb = () => { const d = mkdtempSync(join(tmpdir(), "entry-")); dirs.push(d); return join(d, "i.db"); };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const NOW = Math.floor(Date.UTC(2026, 6, 30, 12, 0, 0) / 1000);
const candle = (ts: number, close: number, vol: number): Candle => ({
  marketTicker: "M", seriesTicker: "S", endPeriodTs: ts, periodMinutes: 60,
  price: { open: close, high: close, low: close, close, mean: close },
  yesBid: { open: close - 1, high: close - 1, low: close - 1, close: close - 1 },
  yesAsk: { open: close + 1, high: close + 1, low: close + 1, close: close + 1 },
  volume: vol, openInterest: 100,
});
function surge(ticker: string): { candles: Candle[]; trades: Trade[] } {
  const flat = Array.from({ length: 8 }, (_, i) => candle(i, 50, 5));
  const s = [candle(8, 62, 80), candle(9, 74, 80), candle(10, 86, 80)];
  const trades: Trade[] = s.map((c, i) => ({ tradeId: `${ticker}-${i}`, ticker, yesPriceCents: c.price.close, count: 80, takerSide: "yes", createdTs: c.endPeriodTs }));
  return { candles: [...flat, ...s], trades };
}
function mkt(ticker: string, series: string): LiveMarket {
  return { marketTicker: ticker, seriesTicker: series, category: series, openTs: NOW - 100000, closeTs: NOW + 3600, liquidityVolume: 5000, yesBidCents: 60, yesAskCents: 62 };
}

describe("runEntryCycle", () => {
  it("enters only firing, non-sports, non-past markets — once", () => {
    const db = new InsiderDb(tmpDb());
    const fire = surge("KXAOCMENTION-26JUL30-A");
    const markets: MarketData[] = [
      { market: mkt("KXAOCMENTION-26JUL30-A", "KXAOCMENTION"), ...fire },          // fires, mentions, future -> ENTER
      { market: mkt("KXAOCMENTION-26JUL10-B", "KXAOCMENTION"), ...surge("KXAOCMENTION-26JUL10-B") }, // past event -> skip
      { market: mkt("KXMLBMENTION-26JUL30-C", "KXMLBMENTION"), ...surge("KXMLBMENTION-26JUL30-C") }, // sports -> skip
    ];
    const f = runEntryCycle(markets, db, NOW);
    expect(f.entered).toBe(1);
    expect(f.pastEvent).toBe(1);
    expect(f.sports).toBe(1);
    expect(db.listOpen()).toHaveLength(1);
    // second run does not double-enter
    expect(runEntryCycle(markets, db, NOW).entered).toBe(0);
    db.close();
  });
});
