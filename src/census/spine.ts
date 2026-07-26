import Database from "better-sqlite3";
import { MarketData } from "./entry";
import { SettlementRecord } from "./settle";
import { LiveMarket, Candle, Trade } from "../kalshi/types";

// The read contract the production poller (Fast99Follower/agent) must satisfy. Phase 1 fills it
// locally via hydrate.ts. Columns are the minimum the detectors + bucketing need.
export const SPINE_SCHEMA = `
CREATE TABLE IF NOT EXISTS spine_markets (
  ticker TEXT PRIMARY KEY, series TEXT, yes_bid_cents INTEGER, yes_ask_cents INTEGER, open_ts INTEGER, close_ts INTEGER
);
CREATE TABLE IF NOT EXISTS spine_candles (
  ticker TEXT, end_period_ts INTEGER, period_minutes INTEGER, close_cents INTEGER, volume REAL
);
CREATE TABLE IF NOT EXISTS spine_trades (
  ticker TEXT, created_ts INTEGER, yes_price_cents INTEGER, count REAL, taker_side TEXT
);
CREATE TABLE IF NOT EXISTS spine_settlement (
  ticker TEXT PRIMARY KEY, result TEXT, settled_at INTEGER, source TEXT
);
`;

export class SpineReader {
  private db: Database.Database;
  constructor(path: string) { this.db = new Database(path, { readonly: true }); }

  listMarketData(): MarketData[] {
    const markets = this.db.prepare(`SELECT * FROM spine_markets`).all() as any[];
    return markets.map((m) => {
      const market: LiveMarket = {
        marketTicker: m.ticker, seriesTicker: m.series, category: m.series,
        openTs: m.open_ts, closeTs: m.close_ts, liquidityVolume: 0,
        yesBidCents: m.yes_bid_cents, yesAskCents: m.yes_ask_cents,
      };
      const candles: Candle[] = (this.db.prepare(`SELECT * FROM spine_candles WHERE ticker=? ORDER BY end_period_ts`).all(m.ticker) as any[])
        .map((c) => ({
          marketTicker: m.ticker, seriesTicker: m.series, endPeriodTs: c.end_period_ts, periodMinutes: c.period_minutes,
          price: { open: c.close_cents, high: c.close_cents, low: c.close_cents, close: c.close_cents, mean: c.close_cents },
          yesBid: { open: c.close_cents - 1, high: c.close_cents - 1, low: c.close_cents - 1, close: c.close_cents - 1 },
          yesAsk: { open: c.close_cents + 1, high: c.close_cents + 1, low: c.close_cents + 1, close: c.close_cents + 1 },
          volume: c.volume, openInterest: 0,
        }));
      const trades: Trade[] = (this.db.prepare(`SELECT * FROM spine_trades WHERE ticker=? ORDER BY created_ts`).all(m.ticker) as any[])
        .map((t, i) => ({ tradeId: `${m.ticker}-${i}`, ticker: m.ticker, yesPriceCents: t.yes_price_cents, count: t.count, takerSide: t.taker_side, createdTs: t.created_ts }));
      return { market, candles, trades };
    });
  }

  listSettlements(): SettlementRecord[] {
    return (this.db.prepare(`SELECT * FROM spine_settlement`).all() as any[])
      .map((s) => ({ ticker: s.ticker, result: s.result, settledAt: s.settled_at, source: s.source }));
  }

  close(): void { this.db.close(); }
}
