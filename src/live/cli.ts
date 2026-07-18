import { readFileSync, existsSync } from "node:fs";
import { loadConfig } from "../config";
import { HistoricalClient } from "../kalshi/historicalClient";
import { AuthedClient } from "../kalshi/orderClient";
import { planProbe, executeProbe, ProbeCandidate } from "./probe";
import { Investigator, Investigation } from "./investigator";
import { ClaudeInvestigator } from "./claudeInvestigator";

export interface CliArgs {
  minVolume: number;
  maxMarkets: number;
  period: 1 | 60 | 1440;
  maxBets: number;
  windowSize: number;
  baselineSize: number;
  minReturn: number;
  maxHorizonDays: number;
  maxSpreadCents: number | undefined;
  categories: string[] | undefined;
  live: boolean;
  confirm: boolean;
}

const USAGE =
  "usage: npm run probe -- [--min-volume V] [--max-markets N] [--period 1|60|1440] " +
  "[--max-bets N] [--window N] [--baseline N] [--min-return PCT] [--horizon-days N] " +
  "[--max-spread N] [--categories A,B,C] [--section culture,mentions] [--live --confirm]";

// Friendly section names (as they appear in Kalshi's top nav) -> the underlying API categories.
// "Culture" is not itself an API category; it maps to Entertainment (+ Social).
const SECTION_MAP: Record<string, string[]> = {
  culture: ["Entertainment", "Social"],
  mentions: ["Mentions"],
  politics: ["Politics", "Elections"],
  economics: ["Economics", "Financials"],
  companies: ["Companies"],
};

/** Resolves --categories (raw API names) and --section (friendly aliases) into one deduped list. */
export function resolveCategories(rawCategories?: string, rawSections?: string): string[] | undefined {
  const out: string[] = [];
  if (rawCategories) out.push(...rawCategories.split(",").map((s) => s.trim()).filter(Boolean));
  if (rawSections) {
    for (const s of rawSections.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      const mapped = SECTION_MAP[s];
      if (!mapped) {
        throw new Error(
          `unknown --section "${s}"; valid sections: ${Object.keys(SECTION_MAP).join(", ")}\n${USAGE}`,
        );
      }
      out.push(...mapped);
    }
  }
  if (out.length === 0) return undefined;
  return [...new Set(out)];
}

export function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const minVolumeRaw = get("--min-volume");
  const minVolume = minVolumeRaw !== undefined ? Number(minVolumeRaw) : 1000;
  if (!Number.isFinite(minVolume) || minVolume < 0) {
    throw new Error(`--min-volume must be a non-negative number, got: ${minVolumeRaw}\n${USAGE}`);
  }

  const maxMarketsRaw = get("--max-markets");
  const maxMarkets = maxMarketsRaw !== undefined ? Number(maxMarketsRaw) : 300;
  if (!Number.isInteger(maxMarkets) || maxMarkets <= 0) {
    throw new Error(`--max-markets must be a positive integer, got: ${maxMarketsRaw}\n${USAGE}`);
  }

  const periodRaw = get("--period");
  const period = periodRaw !== undefined ? Number(periodRaw) : 60;
  if (period !== 1 && period !== 60 && period !== 1440) {
    throw new Error(`--period must be one of 1, 60, 1440, got: ${periodRaw}\n${USAGE}`);
  }

  const maxBetsRaw = get("--max-bets");
  const maxBets = maxBetsRaw !== undefined ? Number(maxBetsRaw) : 10;
  if (!Number.isInteger(maxBets) || maxBets <= 0) {
    throw new Error(`--max-bets must be a positive integer, got: ${maxBetsRaw}\n${USAGE}`);
  }

  const windowSizeRaw = get("--window");
  const windowSize = windowSizeRaw !== undefined ? Number(windowSizeRaw) : 3;
  if (!Number.isInteger(windowSize) || windowSize <= 0) {
    throw new Error(`--window must be a positive integer, got: ${windowSizeRaw}\n${USAGE}`);
  }

  const baselineSizeRaw = get("--baseline");
  const baselineSize = baselineSizeRaw !== undefined ? Number(baselineSizeRaw) : 5;
  if (!Number.isInteger(baselineSize) || baselineSize <= 0) {
    throw new Error(`--baseline must be a positive integer, got: ${baselineSizeRaw}\n${USAGE}`);
  }

  const minReturnRaw = get("--min-return");
  const minReturnPercent = minReturnRaw !== undefined ? Number(minReturnRaw) : 5;
  if (!Number.isFinite(minReturnPercent) || minReturnPercent < 0) {
    throw new Error(`--min-return must be a non-negative number (percent), got: ${minReturnRaw}\n${USAGE}`);
  }
  const minReturn = minReturnPercent / 100;

  const horizonDaysRaw = get("--horizon-days");
  const maxHorizonDays = horizonDaysRaw !== undefined ? Number(horizonDaysRaw) : 31;
  if (!Number.isInteger(maxHorizonDays) || maxHorizonDays <= 0) {
    throw new Error(`--horizon-days must be a positive integer, got: ${horizonDaysRaw}\n${USAGE}`);
  }

  const maxSpreadRaw = get("--max-spread");
  const maxSpreadCents = maxSpreadRaw !== undefined ? Number(maxSpreadRaw) : undefined;
  if (maxSpreadCents !== undefined && (!Number.isInteger(maxSpreadCents) || maxSpreadCents < 1)) {
    throw new Error(`--max-spread must be a positive integer, got: ${maxSpreadRaw}\n${USAGE}`);
  }

  const categories = resolveCategories(get("--categories"), get("--section"));

  return {
    minVolume,
    maxMarkets,
    period: period as 1 | 60 | 1440,
    maxBets,
    windowSize,
    baselineSize,
    minReturn,
    maxHorizonDays,
    maxSpreadCents,
    categories,
    live: argv.includes("--live"),
    confirm: argv.includes("--confirm"),
  };
}

/**
 * Minimal `.env` loader (no `dotenv` dependency, and no Node --env-file since this repo
 * targets Node >=18). Never overrides a variable already present in process.env.
 */
export function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf-8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/**
 * Loads trading credentials for --live --confirm from an already-populated env (call
 * `loadDotEnv()` first to fold in `.env`). `.env` (see .env.example) holds KALSHI_API_KEY_ID
 * directly and KALSHI_PRIVATE_KEY_PATH pointing at a PEM file kept OUTSIDE git. Errors clearly
 * (and refuses to proceed) if either is missing/blank. Pure function of `env` (no disk I/O
 * beyond reading the PEM file) so it's straightforward to unit test without touching the real
 * `.env`/`process.env`.
 */
export function loadTradingCredentials(env: NodeJS.ProcessEnv = process.env): { keyId: string; pem: string } {
  const keyId = env.KALSHI_API_KEY_ID?.trim();
  if (!keyId) {
    throw new Error(
      "KALSHI_API_KEY_ID is missing or blank. Set it in .env (see .env.example) before using --live --confirm.",
    );
  }
  const pemPath = env.KALSHI_PRIVATE_KEY_PATH?.trim();
  if (!pemPath) {
    throw new Error(
      "KALSHI_PRIVATE_KEY_PATH is missing or blank. Set it in .env (see .env.example) before using --live --confirm.",
    );
  }
  if (!existsSync(pemPath)) {
    throw new Error(`KALSHI_PRIVATE_KEY_PATH points to a file that does not exist: ${pemPath}`);
  }
  const pem = readFileSync(pemPath, "utf-8").trim();
  if (!pem) {
    throw new Error(`Private key file at ${pemPath} is empty.`);
  }
  return { keyId, pem };
}

/**
 * Placeholder investigator standing in for the real Claude-backed one (Task 5, built later per
 * the plan's recommended sequence). Always returns AMBIGUOUS so `keepCandidate` filters it
 * out -- the dry-run pipeline runs end-to-end but never plans a bet until Task 5 wires in the
 * real investigator (swap the `investigator` field in main() below).
 */
export const placeholderInvestigator: Investigator = {
  async investigate(): Promise<Investigation> {
    return {
      verdict: "AMBIGUOUS",
      rationale: "Placeholder investigator (Task 5 not yet wired in) -- no bets are planned.",
      sources: [],
    };
  },
};

/**
 * Picks the real Claude-backed investigator when ANTHROPIC_API_KEY is present (call
 * `loadDotEnv()` first so a key set in `.env` is honored), else falls back to the placeholder --
 * this keeps the dry-run-without-key path working exactly as before Task 5.
 */
export function selectInvestigator(env: NodeJS.ProcessEnv = process.env): Investigator {
  return env.ANTHROPIC_API_KEY?.trim() ? new ClaudeInvestigator() : placeholderInvestigator;
}

function renderPlan(plan: ProbeCandidate[]): number {
  if (plan.length === 0) {
    console.log("No viable, unexplained candidates found.");
    return 0;
  }
  let total = 0;
  for (const p of plan) {
    const m = p.candidate.market;
    total += p.order.costCents;
    console.log(
      `${m.marketTicker}  dir=${p.candidate.direction}  entry=${p.candidate.entryCents}c  ` +
        `count=${p.order.count}  cost=${p.order.costCents}c  score=${p.candidate.anomalyScore.toFixed(3)}  ` +
        `verdict=${p.investigation.verdict}`,
    );
    console.log(`    rationale: ${p.investigation.rationale}`);
    console.log(`    sources: ${p.investigation.sources.join(", ") || "(none)"}`);
  }
  console.log(`\nTotal cost: ${total}c across ${plan.length} order(s).`);
  return total;
}

async function main() {
  // Load .env BEFORE loadConfig() so KALSHI_BASE_URL / REQUESTS_PER_SECOND / CACHE_DIR set
  // there are actually honored (both dry-run and --live). Unconditional: loadDotEnv() never
  // overrides a variable already present in process.env, so this is safe either way.
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();
  const nowTs = Math.floor(Date.now() / 1000);
  const client = new HistoricalClient(cfg);

  const willPlaceOrders = args.live && args.confirm;

  console.error(
    `Run config: minVolume=${args.minVolume} maxMarkets=${args.maxMarkets} period=${args.period}min ` +
      `maxBets=${args.maxBets} window=${args.windowSize} baseline=${args.baselineSize} ` +
      `minReturn=${(args.minReturn * 100).toFixed(1)}% horizonDays=${args.maxHorizonDays} ` +
      `maxSpread=${args.maxSpreadCents ?? "default"} ` +
      `categories=${args.categories ? args.categories.join("+") : "ALL"} ` +
      `mode=${willPlaceOrders ? "LIVE" : "DRY-RUN"}`,
  );

  const plan = await planProbe(
    {
      listOpenMarkets: (opts) => client.listOpenMarkets(opts),
      getCandles: (seriesTicker, marketTicker, startTs, endTs, periodInterval) =>
        client.getCandles(seriesTicker, marketTicker, startTs, endTs, periodInterval),
      getTrades: (marketTicker, minTs, maxTs) => client.getTrades(marketTicker, minTs, maxTs),
      investigator: selectInvestigator(),
      nowTs,
    },
    {
      minVolume: args.minVolume,
      maxMarkets: args.maxMarkets,
      period: args.period,
      maxBets: args.maxBets,
      windowSize: args.windowSize,
      baselineSize: args.baselineSize,
      minReturn: args.minReturn,
      maxHorizonDays: args.maxHorizonDays,
      maxSpreadCents: args.maxSpreadCents,
      ...(args.categories ? { categories: args.categories } : {}),
    },
  );

  if (!willPlaceOrders) {
    console.log("\n=== DRY-RUN -- no orders will be placed (use --live --confirm to place real orders) ===\n");
    renderPlan(plan);
    if (args.live || args.confirm) {
      console.log(
        `\nNote: both --live AND --confirm are required to place real orders; ` +
          `only ${args.live ? "--live" : "--confirm"} was given.`,
      );
    }
    return;
  }

  console.log("\n=== LIVE -- placing real orders ===\n");
  renderPlan(plan);

  const { keyId, pem } = loadTradingCredentials();
  const orderClient = new AuthedClient(cfg, keyId, pem);
  const results = await executeProbe(orderClient, plan);

  console.log("\n=== Order results ===");
  for (const r of results) {
    console.log(`${r.ticker}  clientOrderId=${r.clientOrderId}  orderId=${r.orderId}  status=${r.status}`);
  }
}

// Only run when executed directly (not when imported, e.g. by tests).
if (process.argv[1] && process.argv[1].endsWith("cli.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
