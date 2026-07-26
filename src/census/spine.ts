import Database from "better-sqlite3";
import { MarketData } from "./entry";
import { SettlementRecord } from "./settle";
import { LiveMarket, Candle, Trade } from "../kalshi/types";

/** Reads the poller-written spine.db (Fast99Follower agent schema): `latest` (markets), `candles`,
 *  `trades`, `settlement`. Opened READONLY — the census never mutates the spine. */
export class SpineReader {
  private db: Database.Database;
  constructor(path: string) { this.db = new Database(path, { readonly: true }); }

  listMarketData(): MarketData[] {
    const markets = this.db.prepare(`SELECT * FROM latest`).all() as any[];
    return markets.map((m) => {
      const market: LiveMarket = {
        marketTicker: m.ticker, seriesTicker: m.series, category: m.series,
        openTs: 0, closeTs: m.close_ms != null ? Math.floor(m.close_ms / 1000) : 0,
        liquidityVolume: m.open_interest ?? 0, yesBidCents: m.yes_bid, yesAskCents: m.yes_ask,
      };
      const candles: Candle[] = (this.db.prepare(`SELECT * FROM candles WHERE ticker=? ORDER BY end_period_ts`).all(m.ticker) as any[])
        .filter((c) => c.close_cents != null)
        .map((c) => ({
          marketTicker: m.ticker, seriesTicker: m.series, endPeriodTs: c.end_period_ts, periodMinutes: c.period_minutes,
          price: { open: c.close_cents, high: c.close_cents, low: c.close_cents, close: c.close_cents, mean: c.close_cents },
          yesBid: { open: c.close_cents - 1, high: c.close_cents - 1, low: c.close_cents - 1, close: c.close_cents - 1 },
          yesAsk: { open: c.close_cents + 1, high: c.close_cents + 1, low: c.close_cents + 1, close: c.close_cents + 1 },
          volume: c.volume ?? 0, openInterest: 0,
        }));
      const trades: Trade[] = (this.db.prepare(`SELECT * FROM trades WHERE ticker=? ORDER BY created_ts`).all(m.ticker) as any[])
        .map((t) => ({ tradeId: t.trade_id, ticker: m.ticker, yesPriceCents: t.yes_price_cents, count: t.count, takerSide: t.taker_side, createdTs: t.created_ts }));
      return { market, candles, trades };
    });
  }

  listSettlements(): SettlementRecord[] {
    // Only definitively-resolved rows with a yes/no result; parse ISO settled_at to unix seconds.
    return (this.db.prepare(`SELECT * FROM settlement WHERE result IN ('yes','no')`).all() as any[])
      .map((s) => ({
        ticker: s.ticker, result: s.result as "yes" | "no",
        settledAt: s.settled_at ? Math.floor(new Date(s.settled_at).getTime() / 1000) : 0,
        source: s.source ?? "settlement",
      }));
  }

  close(): void { this.db.close(); }
}
