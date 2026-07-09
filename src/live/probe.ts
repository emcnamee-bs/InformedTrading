import { LiveMarket, Candle, Trade } from "../kalshi/types";
import { LiveCandidate, detectCandidate } from "./candidate";
import { isViable, ViabilityParams } from "./viability";
import { Investigator, Investigation, keepUnexplained } from "./investigator";
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
 * degenerate entryCents > 100 case (never reached given viability's maxEntryCents <= 95).
 */
export function sizeOrder(entryCents: number): { count: number; costCents: number } {
  let count = Math.max(1, Math.floor(100 / entryCents));
  while (count > 1 && count * entryCents > HARD_MAX_ORDER_COST_CENTS) count--;
  return { count, costCents: count * entryCents };
}

export interface ProbeDeps {
  listOpenMarkets: (opts: { minVolume?: number; maxMarkets?: number }) => Promise<LiveMarket[]>;
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
  viability?: ViabilityParams;
}

export interface ProbeCandidate {
  candidate: LiveCandidate;
  investigation: Investigation;
  order: { count: number; costCents: number };
  clientOrderId: string;
}

// Sliding-window detection (see candidate.ts / windows.ts) needs at least baselineSize(5) +
// windowSize(3) = 8 candles for a single slice; fetch a generous margin above that so the
// latest window always has a full baseline to compare against.
const LOOKBACK_PERIODS = 30;

/**
 * Scans the open-market universe for live anomaly candidates, filters to those that are still
 * viable to enter and come back UNEXPLAINED from the investigator, ranks by anomalyScore, and
 * sizes a probe order for each of the top `maxBets`. Read-only end to end: never calls any
 * order-placement API.
 */
export async function planProbe(deps: ProbeDeps, opts: ProbeOpts): Promise<ProbeCandidate[]> {
  const periodSeconds = opts.period * 60;
  const endTs = deps.nowTs;
  const startTs = endTs - LOOKBACK_PERIODS * periodSeconds;

  const markets = await deps.listOpenMarkets({ minVolume: opts.minVolume, maxMarkets: opts.maxMarkets });

  const kept: { candidate: LiveCandidate; investigation: Investigation }[] = [];

  for (const market of markets) {
    const [candles, trades] = await Promise.all([
      deps.getCandles(market.seriesTicker, market.marketTicker, startTs, endTs, opts.period),
      deps.getTrades(market.marketTicker, startTs, endTs),
    ]);

    const candidate = detectCandidate(market, candles, trades);
    if (!candidate) continue;

    const viability = isViable(candidate, deps.nowTs, opts.viability);
    if (!viability.viable) continue;

    const investigation = await deps.investigator.investigate(candidate);
    if (!keepUnexplained(investigation)) continue;

    kept.push({ candidate, investigation });
  }

  kept.sort((a, b) => b.candidate.anomalyScore - a.candidate.anomalyScore);
  const maxBets = Math.min(opts.maxBets ?? HARD_MAX_ORDERS, HARD_MAX_ORDERS);
  const top = kept.slice(0, maxBets);

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
