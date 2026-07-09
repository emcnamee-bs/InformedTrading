import { loadConfig } from "../config";
import { HistoricalClient } from "../kalshi/historicalClient";
import { readCache, writeCache } from "../kalshi/cache";
import { ResolvedMarket } from "../kalshi/types";
import { runReplay } from "./run";
import { aggregate } from "../expectancy/strata";
import { renderReport, verdictFor } from "./report";

export interface CliArgs {
  start: number;
  end: number;
  maxMarkets: number;
  minVolume: number;
  period: 1 | 60 | 1440;
  categories: string[] | null;
}

const USAGE =
  "usage: npm run replay -- --history <startISO>..<endISO> " +
  "[--categories a,b] [--max-markets N] [--min-volume V] [--period 1|60|1440]";

export function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const history = get("--history");
  if (!history || !history.includes("..")) {
    throw new Error(USAGE);
  }
  const [startISO, endISO] = history.split("..");

  const cats = get("--categories");

  const maxMarketsRaw = get("--max-markets");
  const maxMarkets = maxMarketsRaw !== undefined ? Number(maxMarketsRaw) : 200;
  if (!Number.isInteger(maxMarkets) || maxMarkets <= 0) {
    throw new Error(`--max-markets must be a positive integer, got: ${maxMarketsRaw}`);
  }

  const minVolumeRaw = get("--min-volume");
  const minVolume = minVolumeRaw !== undefined ? Number(minVolumeRaw) : 1000;
  if (!Number.isFinite(minVolume) || minVolume < 0) {
    throw new Error(`--min-volume must be a non-negative number, got: ${minVolumeRaw}`);
  }

  const periodRaw = get("--period");
  const period = periodRaw !== undefined ? Number(periodRaw) : 60;
  if (period !== 1 && period !== 60 && period !== 1440) {
    throw new Error(`--period must be one of 1, 60, 1440, got: ${periodRaw}`);
  }

  return {
    start: Math.floor(new Date(startISO!).getTime() / 1000),
    end: Math.floor(new Date(endISO!).getTime() / 1000),
    maxMarkets,
    minVolume,
    period,
    categories: cats ? cats.split(",") : null,
  };
}

async function main() {
  const cfg = loadConfig();
  const { start, end, maxMarkets, minVolume, period, categories } = parseArgs(process.argv.slice(2));
  const client = new HistoricalClient(cfg);

  console.error(
    `Run config: window=${new Date(start * 1000).toISOString()}..${new Date(end * 1000).toISOString()} ` +
      `maxMarkets=${maxMarkets} minVolume=${minVolume} period=${period}min requestsPerSecond=${cfg.requestsPerSecond}` +
      (categories ? ` categories=${categories.join(",")}` : ""),
  );

  const universeKey = `universe_${start}_${end}_min${minVolume}_max${maxMarkets}`;
  let markets = readCache<ResolvedMarket>(cfg.cacheDir, universeKey);
  if (!markets) {
    markets = await client.listResolvedMarkets(start, end, { minVolume, maxMarkets });
    writeCache(cfg.cacheDir, universeKey, markets);
  }
  if (categories) markets = markets.filter((m) => categories.includes(m.category));
  console.error(`Replaying ${markets.length} resolved markets...`);

  const allObs = await runReplay(client, markets, cfg, period);

  const stats = aggregate(allObs);
  const result = verdictFor(stats);
  console.log(renderReport(stats));
  console.log("\n=== KILL-GATE VERDICT ===");
  console.log(`Verdict: ${result.verdict}`);
  if (result.bettableStrata.length) console.log(`Bettable strata: ${result.bettableStrata.join(", ")}`);
  for (const r of result.reasons) console.log(`  - ${r}`);
}

// Only run when executed directly (not when imported, e.g. by tests).
if (process.argv[1] && process.argv[1].endsWith("cli.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
