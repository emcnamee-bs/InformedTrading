import Database from "better-sqlite3";
import { HistoricalClient } from "../kalshi/historicalClient";
import { InsiderDb } from "./insiderDb";
import { SPINE_SCHEMA } from "./spine";

// Non-sports categories the local census cares about (excludes MVE via listOpenMarkets' own
// server-side mve_filter=exclude). Kept in sync with Task 5's live/cli.ts SECTION_MAP entries.
export const CENSUS_CATEGORIES = ["Entertainment", "Social", "Mentions", "Politics", "Economics", "Companies"];

const LOOKBACK_HOURS = 74;

/**
 * The ONLY component that calls Kalshi in Phase 1 -- a local stand-in for the production spine
 * poller (Fast99Follower/agent, Phase 3, out of scope here). Fetches a bounded non-sports
 * universe of open markets plus their recent candles/trades, and writes them into `spine.db`
 * (the read contract SpineReader/SPINE_SCHEMA defines). Also opportunistically backfills
 * `spine_settlement` for any ticker the local insider ledger still has open.
 *
 * PAPER only: no order-placement client is touched anywhere in this module.
 */
export async function hydrateSpine(
  client: HistoricalClient,
  spinePath: string,
  insiderDb: InsiderDb,
  nowTs: number,
): Promise<{ markets: number; candles: number; trades: number; settlements: number }> {
  const db = new Database(spinePath);
  db.exec(SPINE_SCHEMA);
  let candleCount = 0;
  let tradeCount = 0;
  let settlementCount = 0;

  try {
    const markets = await client.listOpenMarkets({
      minVolume: 100,
      maxMarkets: 1000,
      categories: CENSUS_CATEGORIES,
    });

    const insertMarket = db.prepare(
      `INSERT OR REPLACE INTO spine_markets (ticker, series, yes_bid_cents, yes_ask_cents, open_ts, close_ts)
       VALUES (@ticker,@series,@yesBidCents,@yesAskCents,@openTs,@closeTs)`,
    );
    const insertCandle = db.prepare(
      `INSERT INTO spine_candles (ticker, end_period_ts, period_minutes, close_cents, volume)
       VALUES (@ticker,@endPeriodTs,@periodMinutes,@closeCents,@volume)`,
    );
    const insertTrade = db.prepare(
      `INSERT INTO spine_trades (ticker, created_ts, yes_price_cents, count, taker_side)
       VALUES (@ticker,@createdTs,@yesPriceCents,@count,@takerSide)`,
    );
    const deleteCandles = db.prepare(`DELETE FROM spine_candles WHERE ticker=?`);
    const deleteTrades = db.prepare(`DELETE FROM spine_trades WHERE ticker=?`);

    const startTs = nowTs - LOOKBACK_HOURS * 3600;

    for (const m of markets) {
      insertMarket.run({
        ticker: m.marketTicker,
        series: m.seriesTicker,
        yesBidCents: m.yesBidCents,
        yesAskCents: m.yesAskCents,
        openTs: m.openTs,
        closeTs: m.closeTs,
      });

      const candles = await client.getCandles(m.seriesTicker, m.marketTicker, startTs, nowTs, 60);
      const trades = await client.getTrades(m.marketTicker, startTs, nowTs);

      const tx = db.transaction(() => {
        deleteCandles.run(m.marketTicker);
        deleteTrades.run(m.marketTicker);
        for (const c of candles) {
          insertCandle.run({
            ticker: m.marketTicker,
            endPeriodTs: c.endPeriodTs,
            periodMinutes: c.periodMinutes,
            closeCents: c.price.close,
            volume: c.volume,
          });
        }
        for (const t of trades) {
          insertTrade.run({
            ticker: m.marketTicker,
            createdTs: t.createdTs,
            yesPriceCents: t.yesPriceCents,
            count: t.count,
            takerSide: t.takerSide,
          });
        }
      });
      tx();

      candleCount += candles.length;
      tradeCount += trades.length;
    }

    // Opportunistically backfill settlements for any ticker still open in the local ledger --
    // this is what lets `runSettleCycle` eventually close positions the entry cycle opened.
    const insertSettlement = db.prepare(
      `INSERT OR IGNORE INTO spine_settlement (ticker, result, settled_at, source) VALUES (?,?,?,?)`,
    );
    const openTickers = new Set(insiderDb.listOpen().map((b) => b.ticker));
    for (const ticker of openTickers) {
      const result = await client.getMarketResult(ticker);
      if (result) {
        insertSettlement.run(ticker, result.result, nowTs, "market-result");
        settlementCount++;
      }
    }

    return { markets: markets.length, candles: candleCount, trades: tradeCount, settlements: settlementCount };
  } finally {
    db.close();
  }
}
