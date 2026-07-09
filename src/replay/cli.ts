import { loadConfig } from "../config";
import { HistoricalClient } from "../kalshi/historicalClient";
import { readCache, writeCache } from "../kalshi/cache";
import { Candle, Trade, ResolvedMarket } from "../kalshi/types";
import { replayMarket } from "./replay";
import { aggregate, Observation } from "../expectancy/strata";
import { renderReport, verdictFor } from "./report";

function parseArgs(argv: string[]): { start: number; end: number; categories: string[] | null } {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const history = get("--history");
  if (!history || !history.includes("..")) {
    throw new Error("usage: npm run replay -- --history <startISO>..<endISO> [--categories a,b]");
  }
  const [startISO, endISO] = history.split("..");
  const cats = get("--categories");
  return {
    start: Math.floor(new Date(startISO!).getTime() / 1000),
    end: Math.floor(new Date(endISO!).getTime() / 1000),
    categories: cats ? cats.split(",") : null,
  };
}

async function main() {
  const cfg = loadConfig();
  const { start, end, categories } = parseArgs(process.argv.slice(2));
  const client = new HistoricalClient(cfg);

  const universeKey = `universe_${start}_${end}`;
  let markets = readCache<ResolvedMarket>(cfg.cacheDir, universeKey);
  if (!markets) {
    markets = await client.listResolvedMarkets(start, end);
    writeCache(cfg.cacheDir, universeKey, markets);
  }
  if (categories) markets = markets.filter((m) => categories.includes(m.category));
  console.error(`Replaying ${markets.length} resolved markets...`);

  const allObs: Observation[] = [];
  for (const m of markets) {
    let candles = readCache<Candle>(cfg.cacheDir, `candles_${m.marketTicker}`);
    if (!candles) {
      candles = await client.getCandles(m.seriesTicker, m.marketTicker, m.openTs, m.closeTs);
      writeCache(cfg.cacheDir, `candles_${m.marketTicker}`, candles);
    }
    let trades = readCache<Trade>(cfg.cacheDir, `trades_${m.marketTicker}`);
    if (!trades) {
      trades = await client.getTrades(m.marketTicker);
      writeCache(cfg.cacheDir, `trades_${m.marketTicker}`, trades);
    }
    if (candles.length === 0) continue;
    allObs.push(...replayMarket({ market: m, candles, trades }));
  }

  const stats = aggregate(allObs);
  const result = verdictFor(stats);
  console.log(renderReport(stats));
  console.log("\n=== KILL-GATE VERDICT ===");
  console.log(`Verdict: ${result.verdict}`);
  if (result.bettableStrata.length) console.log(`Bettable strata: ${result.bettableStrata.join(", ")}`);
  for (const r of result.reasons) console.log(`  - ${r}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
