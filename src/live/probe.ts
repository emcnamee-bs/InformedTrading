import { LiveMarket, Candle, Trade } from "../kalshi/types";
import { LiveCandidate, detectCandidate } from "./candidate";
import { isViable, ViabilityParams, DEFAULT_VIABILITY } from "./viability";
import { Investigator, Investigation, Verdict, keepCandidate } from "./investigator";
import { isEventPast } from "./eventDate";
import { OrderRequest } from "../kalshi/orderClient";

// Hard safety caps for the live probe. These are NOT tuning knobs -- they bound real-money
// exposure regardless of what CLI flags or ranking produce. Keep in sync with the plan's
// task brief: <=10 orders, <=$10 total, <=$1 ($1 == 100 cents) per order.
export const HARD_MAX_ORDERS = 10;
export const HARD_MAX_TOTAL_COST_CENTS = 1000;
export const HARD_MAX_ORDER_COST_CENTS = 100;

/**
 * Sizes a probe order to ~$1 notional without ever exceeding it: as many contracts as $1 buys
 * at `entryCents`, at least 1. `Math.floor(100 / entryCents)` already satisfies
 * `count*entryCents <= 100` for any entryCents >= 1, so the decrement loop only guards the
 * degenerate entryCents > 100 case (never reached given viability's degenerate-price guard
 * rejects entryCents >= 100).
 */
export function sizeOrder(entryCents: number): { count: number; costCents: number } {
  if (!Number.isFinite(entryCents) || entryCents <= 0) return { count: 0, costCents: 0 };
  let count = Math.max(1, Math.floor(100 / entryCents));
  while (count > 1 && count * entryCents > HARD_MAX_ORDER_COST_CENTS) count--;
  return { count, costCents: count * entryCents };
}

/** min / median / max of a numeric array; zeros for an empty array. Median rounded to an int. */
export function candleStats(counts: number[]): { min: number; median: number; max: number } {
  if (counts.length === 0) return { min: 0, median: 0, max: 0 };
  const sorted = [...counts].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
  return { min: sorted[0]!, median, max: sorted[sorted.length - 1]! };
}

export interface ProbeDeps {
  listOpenMarkets: (opts: {
    minVolume?: number;
    maxMarkets?: number;
    categories?: string[];
  }) => Promise<LiveMarket[]>;
  getCandles: (
    seriesTicker: string,
    marketTicker: string,
    startTs: number,
    endTs: number,
    periodInterval: 1 | 60 | 1440,
  ) => Promise<Candle[]>;
  getTrades: (marketTicker: string, minTs?: number, maxTs?: number) => Promise<Trade[]>;
  investigator: Investigator;
  nowTs: number;
}

export interface ProbeOpts {
  minVolume: number;
  maxMarkets: number;
  period: 1 | 60 | 1440;
  maxBets: number;
  // Optional Kalshi category filter (e.g. ["Entertainment","Social","Mentions"]). When set, only
  // markets whose event is in one of these categories are scanned. Omit to scan all categories.
  categories?: string[];
  viability?: ViabilityParams;
  // Individual viability overrides (operator-facing, e.g. via CLI flags) -- when provided,
  // each overrides only that one field of DEFAULT_VIABILITY (see buildViabilityParams below).
  // These are independent of -- and merged on top of -- `viability` above.
  minReturn?: number;
  maxHorizonDays?: number;
  maxSpreadCents?: number;
  // Detection window sizing for detectCandidate (see candidate.ts / windows.ts). Optional --
  // defaults (3 / 5) match detectCandidate's own defaults so existing callers/tests are
  // unaffected when these are omitted.
  windowSize?: number;
  baselineSize?: number;
}

/**
 * Builds the ViabilityParams passed to isViable: starts from `opts.viability` (or
 * DEFAULT_VIABILITY if not given), then layers any individually-provided overrides
 * (minReturn/maxHorizonDays/maxSpreadCents) on top.
 */
function buildViabilityParams(opts: ProbeOpts): ViabilityParams {
  return {
    ...DEFAULT_VIABILITY,
    ...opts.viability,
    ...(opts.minReturn !== undefined ? { minReturn: opts.minReturn } : {}),
    ...(opts.maxHorizonDays !== undefined ? { maxHorizonDays: opts.maxHorizonDays } : {}),
    ...(opts.maxSpreadCents !== undefined ? { maxSpreadCents: opts.maxSpreadCents } : {}),
  };
}

export interface ProbeCandidate {
  candidate: LiveCandidate;
  investigation: Investigation;
  order: { count: number; costCents: number };
  clientOrderId: string;
}

/**
 * Scans the open-market universe for live anomaly candidates, filters to those that are still
 * viable to enter and come back UNEXPLAINED from the investigator, ranks by anomalyScore, and
 * sizes a probe order for each of the top `maxBets`. Read-only end to end: never calls any
 * order-placement API.
 *
 * Candle/trade fetches use a RECENT window ending at `nowTs`, never the market's own
 * [openTs, closeTs] lifetime -- for an OPEN market, closeTs is in the future, and the
 * candlesticks endpoint only returns real data up to now (querying past `now` yields ~1 candle
 * at period=60, or a 400 from too many empty buckets at period=1). Sliding-window detection
 * (see candidate.ts / windows.ts) needs at least baselineSize + windowSize candles for a single
 * slice, so the lookback scales with the configured (or default) window/baseline plus a margin.
 */
export async function planProbe(deps: ProbeDeps, opts: ProbeOpts): Promise<ProbeCandidate[]> {
  const windowSize = opts.windowSize ?? 3;
  const baselineSize = opts.baselineSize ?? 5;
  const periodMin = opts.period; // minutes per candle
  const lookbackSec =
    Math.max(windowSize + baselineSize + 5, (windowSize + baselineSize) * 2) * periodMin * 60;
  const endTs = deps.nowTs;
  const viabilityParams = buildViabilityParams(opts);

  const markets = await deps.listOpenMarkets({
    minVolume: opts.minVolume,
    maxMarkets: opts.maxMarkets,
    ...(opts.categories && opts.categories.length > 0 ? { categories: opts.categories } : {}),
  });

  const kept: { candidate: LiveCandidate; investigation: Investigation }[] = [];
  let errors = 0;
  let insufficientHistory = 0;
  let pastEvent = 0;
  const candleCounts: number[] = [];

  // Funnel diagnostics only -- these counters do not influence which candidates are kept
  // or how they're ranked/sized; they exist purely to log where candidates drop off.
  let anomaliesDetected = 0;
  let viableCount = 0;
  const viabilityRejectReasons: Record<string, number> = {};
  let investigatedCount = 0;
  const verdictCounts: Record<Verdict, number> = { EXPLAINED: 0, UNEXPLAINED: 0, AMBIGUOUS: 0 };

  // Sequential loop with a per-market try/catch: an isolated fetch/detect failure (e.g. a
  // persistent 429 after retries) skips that one market and continues the scan rather than
  // aborting the whole plan via an unguarded Promise.all.
  for (const market of markets) {
    if (isEventPast(market.marketTicker, deps.nowTs)) {
      pastEvent++;
      continue;
    }
    try {
      // Never request candles/trades from before the market existed -- clamp per-market.
      const startTs = Math.max(endTs - lookbackSec, market.openTs);
      const [candles, trades] = await Promise.all([
        deps.getCandles(market.seriesTicker, market.marketTicker, startTs, endTs, opts.period),
        deps.getTrades(market.marketTicker, startTs, endTs),
      ]);

      candleCounts.push(candles.length);
      if (candles.length < windowSize + baselineSize) {
        insufficientHistory++;
        continue;
      }

      const candidate = detectCandidate(market, candles, trades, opts.windowSize, opts.baselineSize);
      if (!candidate) continue;
      anomaliesDetected++;

      const viability = isViable(candidate, deps.nowTs, viabilityParams);
      if (!viability.viable) {
        const reason = viability.reason ?? "unknown";
        viabilityRejectReasons[reason] = (viabilityRejectReasons[reason] ?? 0) + 1;
        continue;
      }
      viableCount++;

      const investigation = await deps.investigator.investigate(candidate);
      investigatedCount++;
      verdictCounts[investigation.verdict]++;
      console.error(
        `investigate ${candidate.market.marketTicker} dir=${candidate.direction} entry=${candidate.entryCents} -> ${investigation.verdict}`,
      );
      if (!keepCandidate(investigation)) continue;

      kept.push({ candidate, investigation });
    } catch (err) {
      errors++;
      console.error(`skip ${market.marketTicker}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
  }

  const analyzed = markets.length - pastEvent - errors - insufficientHistory;
  console.error(
    `Probe scan summary: ${analyzed} analyzed, ${pastEvent} past-event, ${insufficientHistory} insufficient-history, ${errors} errors (of ${markets.length} total)`,
  );

  kept.sort((a, b) => b.candidate.anomalyScore - a.candidate.anomalyScore);
  const maxBets = Math.min(opts.maxBets ?? HARD_MAX_ORDERS, HARD_MAX_ORDERS);
  const top = kept.slice(0, maxBets);

  const stats = candleStats(candleCounts);
  console.error(
    `Funnel: universe=${markets.length} | pastEvent=${pastEvent} errors=${errors} insufficientHistory=${insufficientHistory} analyzed=${analyzed} | ` +
      `anomalies=${anomaliesDetected} viable=${viableCount} investigated=${investigatedCount} | ` +
      `verdicts EXPLAINED=${verdictCounts.EXPLAINED} UNEXPLAINED=${verdictCounts.UNEXPLAINED} AMBIGUOUS=${verdictCounts.AMBIGUOUS} | kept=${top.length}`,
  );
  console.error(`candles/market: min=${stats.min} median=${stats.median} max=${stats.max}`);
  if (Object.keys(viabilityRejectReasons).length > 0) {
    const breakdown = Object.entries(viabilityRejectReasons)
      .map(([reason, count]) => `${reason}=${count}`)
      .join(", ");
    console.error(`viability drops: ${breakdown}`);
  }

  return top.map((k, i) => ({
    candidate: k.candidate,
    investigation: k.investigation,
    order: sizeOrder(k.candidate.entryCents),
    // Deterministic (no Math.random): ticker + nowTs + rank index is unique per planning run.
    clientOrderId: `probe-${k.candidate.market.marketTicker}-${deps.nowTs}-${i}`,
  }));
}

export interface OrderClient {
  getBalanceCents(): Promise<number>;
  placeLimitBuy(o: OrderRequest): Promise<{ orderId: string; status: string }>;
}

export interface ExecuteResult {
  ticker: string;
  clientOrderId: string;
  orderId: string;
  status: string;
}

/**
 * Places real orders for a previously-planned probe. ONLY call this in the --live --confirm
 * path. Re-enforces the hard caps independently of whatever produced `plan`, and checks account
 * balance, BEFORE placing a single order -- a violation aborts the entire batch.
 */
export async function executeProbe(
  orderClient: OrderClient,
  plan: ProbeCandidate[],
): Promise<ExecuteResult[]> {
  if (plan.length > HARD_MAX_ORDERS) {
    throw new Error(`probe plan has ${plan.length} orders, exceeds hard cap of ${HARD_MAX_ORDERS}`);
  }

  for (const p of plan) {
    if (!Number.isFinite(p.order.costCents) || p.order.count < 1 || p.order.costCents < 1) {
      throw new Error(
        `order for ${p.candidate.market.marketTicker} has invalid count/costCents (count=${p.order.count}, costCents=${p.order.costCents})`,
      );
    }
  }

  const totalCostCents = plan.reduce((sum, p) => sum + p.order.costCents, 0);
  if (totalCostCents > HARD_MAX_TOTAL_COST_CENTS) {
    throw new Error(
      `probe plan total cost ${totalCostCents}c exceeds hard cap of ${HARD_MAX_TOTAL_COST_CENTS}c`,
    );
  }

  for (const p of plan) {
    if (p.order.costCents > HARD_MAX_ORDER_COST_CENTS) {
      throw new Error(
        `order for ${p.candidate.market.marketTicker} costs ${p.order.costCents}c, exceeds hard cap of ${HARD_MAX_ORDER_COST_CENTS}c per order`,
      );
    }
  }

  const balanceCents = await orderClient.getBalanceCents();
  if (balanceCents < totalCostCents) {
    throw new Error(
      `account balance ${balanceCents}c is less than probe plan total cost ${totalCostCents}c`,
    );
  }

  const results: ExecuteResult[] = [];
  for (const p of plan) {
    const { orderId, status } = await orderClient.placeLimitBuy({
      ticker: p.candidate.market.marketTicker,
      side: p.candidate.direction,
      count: p.order.count,
      priceCents: p.candidate.entryCents,
      clientOrderId: p.clientOrderId,
      buyMaxCostCents: HARD_MAX_ORDER_COST_CENTS,
    });
    results.push({ ticker: p.candidate.market.marketTicker, clientOrderId: p.clientOrderId, orderId, status });
  }
  return results;
}
