import { Candle, Trade, ResolvedMarket } from "../kalshi/types";
import { readCache, writeCache } from "../kalshi/cache";
import { replayMarket } from "./replay";
import { Observation } from "../expectancy/strata";

/** The subset of HistoricalClient's surface runReplay depends on (kept minimal for testability). */
export interface ReplayClient {
  getCandles(
    seriesTicker: string,
    marketTicker: string,
    startTs: number,
    endTs: number,
    periodInterval?: 1 | 60 | 1440,
  ): Promise<Candle[]>;
  getTrades(marketTicker: string): Promise<Trade[]>;
}

export interface RunReplayConfig {
  cacheDir: string;
}

/**
 * Replays every market, accumulating observations. A single market's fetch/replay
 * failure is caught, logged, and skipped rather than aborting the whole run (final-review #7).
 * `period` (candle bucket size in minutes) is threaded through to `getCandles`.
 */
export async function runReplay(
  client: ReplayClient,
  markets: ResolvedMarket[],
  cfg: RunReplayConfig,
  period: 1 | 60 | 1440 = 60,
): Promise<Observation[]> {
  const allObs: Observation[] = [];
  let skipped = 0;
  const total = markets.length;

  for (let i = 0; i < markets.length; i++) {
    const m = markets[i]!;
    console.error(`[${i + 1}/${total}] ${m.marketTicker}`);
    try {
      let candles = readCache<Candle>(cfg.cacheDir, `candles_${m.marketTicker}`);
      if (!candles) {
        candles = await client.getCandles(m.seriesTicker, m.marketTicker, m.openTs, m.closeTs, period);
        writeCache(cfg.cacheDir, `candles_${m.marketTicker}`, candles);
      }
      let trades = readCache<Trade>(cfg.cacheDir, `trades_${m.marketTicker}`);
      if (!trades) {
        trades = await client.getTrades(m.marketTicker);
        writeCache(cfg.cacheDir, `trades_${m.marketTicker}`, trades);
      }
      if (candles.length === 0) continue;
      allObs.push(...replayMarket({ market: m, candles, trades }));
    } catch (err) {
      skipped++;
      console.error(`skip ${m.marketTicker}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
  }

  const processed = markets.length - skipped;
  console.error(`Replay summary: ${processed} processed, ${skipped} skipped (of ${markets.length} total)`);
  return allObs;
}
