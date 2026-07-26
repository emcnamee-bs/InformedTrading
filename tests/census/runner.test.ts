import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InsiderDb } from "../../src/census/insiderDb";
import { runOnce } from "../../src/census/runner";
import { MarketData } from "../../src/census/entry";
import { LiveMarket, Candle, Trade } from "../../src/kalshi/types";

const dirs: string[] = [];
const tmpDb = () => { const d = mkdtempSync(join(tmpdir(), "runner-")); dirs.push(d); return join(d, "i.db"); };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const NOW = Math.floor(Date.UTC(2026, 6, 30, 12, 0, 0) / 1000);
const candle = (ts: number, close: number, vol: number): Candle => ({
  marketTicker: "M", seriesTicker: "S", endPeriodTs: ts, periodMinutes: 60,
  price: { open: close, high: close, low: close, close, mean: close },
  yesBid: { open: close - 1, high: close - 1, low: close - 1, close: close - 1 },
  yesAsk: { open: close + 1, high: close + 1, low: close + 1, close: close + 1 }, volume: vol, openInterest: 0,
});
function fire(ticker: string): MarketData {
  const flat = Array.from({ length: 8 }, (_, i) => candle(i, 50, 5));
  const s = [candle(8, 62, 80), candle(9, 74, 80), candle(10, 86, 80)];
  const trades: Trade[] = s.map((c, i) => ({ tradeId: `${ticker}-${i}`, ticker, yesPriceCents: c.price.close, count: 80, takerSide: "yes", createdTs: c.endPeriodTs }));
  const market: LiveMarket = { marketTicker: ticker, seriesTicker: "KXAOCMENTION", category: "KXAOCMENTION", openTs: NOW - 100000, closeTs: NOW + 3600, liquidityVolume: 5000, yesBidCents: 60, yesAskCents: 62 };
  return { market, candles: [...flat, ...s], trades };
}

it("runOnce enters a firing market then settles it into a cell", () => {
  const db = new InsiderDb(tmpDb());
  const reader = {
    listMarketData: () => [fire("KXAOCMENTION-26JUL30-A")],
    listSettlements: () => [{ ticker: "KXAOCMENTION-26JUL30-A", result: "yes" as const, settledAt: NOW + 7200, source: "market-result" }],
    close: () => {},
  };
  const r = runOnce(reader as any, db, NOW);
  expect(r.entry.entered).toBe(1);
  expect(r.settle.settled).toBe(1);
  expect(db.listCells()[0]!.n).toBe(1);
  db.close();
});
