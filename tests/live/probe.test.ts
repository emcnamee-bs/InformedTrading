import { describe, it, expect, vi } from "vitest";
import {
  sizeOrder,
  planProbe,
  executeProbe,
  ProbeDeps,
  ProbeOpts,
  ProbeCandidate,
  OrderClient,
} from "../../src/live/probe";
import { detectCandidate } from "../../src/live/candidate";
import { Investigator, Investigation, Verdict } from "../../src/live/investigator";
import { LiveMarket, Candle, Trade, Side } from "../../src/kalshi/types";
import { OrderRequest } from "../../src/kalshi/orderClient";

const NOW_TS = 1_800_000_000;

// ---------- sizeOrder ----------

describe("sizeOrder", () => {
  it("sizeOrder(62) -> {count:1, costCents:62}", () => {
    expect(sizeOrder(62)).toEqual({ count: 1, costCents: 62 });
  });

  it("sizeOrder(20) -> {count:5, costCents:100}", () => {
    expect(sizeOrder(20)).toEqual({ count: 5, costCents: 100 });
  });

  it("sizeOrder(40) -> {count:2, costCents:80}", () => {
    expect(sizeOrder(40)).toEqual({ count: 2, costCents: 80 });
  });

  it("never returns a cost above 100 cents for any entry within the viable range", () => {
    for (let entry = 5; entry <= 95; entry++) {
      const { count, costCents } = sizeOrder(entry);
      expect(count).toBeGreaterThanOrEqual(1);
      expect(costCents).toBeLessThanOrEqual(100);
    }
  });

  it("rejects non-finite/non-positive entryCents with a zero-count order", () => {
    expect(sizeOrder(0)).toEqual({ count: 0, costCents: 0 });
    expect(sizeOrder(-5)).toEqual({ count: 0, costCents: 0 });
    expect(sizeOrder(NaN)).toEqual({ count: 0, costCents: 0 });
    expect(sizeOrder(Infinity)).toEqual({ count: 0, costCents: 0 });
  });
});

// ---------- planProbe fixtures ----------

const candle = (ts: number, close: number, vol: number, oi: number): Candle => ({
  marketTicker: "M", seriesTicker: "S", endPeriodTs: ts, periodMinutes: 1,
  price: { open: close, high: close, low: close, close, mean: close },
  yesBid: { open: close - 1, high: close - 1, low: close - 1, close: close - 1 },
  yesAsk: { open: close + 1, high: close + 1, low: close + 1, close: close + 1 },
  volume: vol, openInterest: oi,
});

/** A clear informed-looking upswing (flat baseline + confirmed surge), same shape as
 * candidate.test.ts, with a tunable yes/no trade split so different markets can be given
 * genuinely different (not hand-computed) anomaly scores. */
function buildSurgeData(ticker: string, yesFraction: number): { candles: Candle[]; trades: Trade[] } {
  const flat = Array.from({ length: 8 }, (_, i) => candle(i, 50, 5, 100));
  const surge = [candle(8, 62, 80, 130), candle(9, 74, 80, 160), candle(10, 86, 80, 190)];
  const candles = [...flat, ...surge];
  const perCandle = 80;
  const trades: Trade[] = surge.flatMap((c, i) => {
    const yesCount = Math.round(perCandle * yesFraction);
    const noCount = perCandle - yesCount;
    const out: Trade[] = [];
    if (yesCount > 0) {
      out.push({ tradeId: `${ticker}-y${i}`, ticker, yesPriceCents: c.price.close, count: yesCount, takerSide: "yes", createdTs: c.endPeriodTs });
    }
    if (noCount > 0) {
      out.push({ tradeId: `${ticker}-n${i}`, ticker, yesPriceCents: c.price.close, count: noCount, takerSide: "no", createdTs: c.endPeriodTs });
    }
    return out;
  });
  return { candles, trades };
}

function makeMarket(ticker: string, overrides: Partial<LiveMarket> = {}): LiveMarket {
  return {
    marketTicker: ticker,
    seriesTicker: "SER",
    category: "SER",
    openTs: NOW_TS - 100_000,
    closeTs: NOW_TS + 10 * 86400,
    liquidityVolume: 5_000,
    yesBidCents: 60,
    yesAskCents: 62,
    ...overrides,
  };
}

function makeDeps(
  markets: LiveMarket[],
  dataByTicker: Map<string, { candles: Candle[]; trades: Trade[] }>,
  investigator: Investigator,
): ProbeDeps {
  return {
    listOpenMarkets: async () => markets,
    getCandles: async (_series, ticker) => dataByTicker.get(ticker)?.candles ?? [],
    getTrades: async (ticker) => dataByTicker.get(ticker)?.trades ?? [],
    investigator,
    nowTs: NOW_TS,
  };
}

const baseOpts: ProbeOpts = { minVolume: 1000, maxMarkets: 300, period: 1, maxBets: 10 };

function alwaysUnexplained(seen: string[] = []): Investigator {
  return {
    async investigate(c) {
      seen.push(c.market.marketTicker);
      return { verdict: "UNEXPLAINED", rationale: `unexplained: ${c.market.marketTicker}`, sources: ["src"] };
    },
  };
}

// ---------- planProbe ----------

describe("planProbe", () => {
  it("ranks kept candidates by anomalyScore desc and truncates to maxBets, matching ground-truth detectCandidate scores", async () => {
    const fixtures = [
      { ticker: "MKT-VHIGH", yesFraction: 1.0 },
      { ticker: "MKT-HIGH", yesFraction: 0.9 },
      { ticker: "MKT-MED", yesFraction: 0.8 },
      { ticker: "MKT-LOW", yesFraction: 0.7 },
    ];
    const markets = fixtures.map((f) => makeMarket(f.ticker));
    const dataByTicker = new Map(fixtures.map((f) => [f.ticker, buildSurgeData(f.ticker, f.yesFraction)]));

    // Ground truth: run the same detector directly to know the real expected ranking
    // instead of hand-deriving anomaly-score math.
    const groundTruth = fixtures
      .map((f) => {
        const { candles, trades } = dataByTicker.get(f.ticker)!;
        const c = detectCandidate(markets.find((m) => m.marketTicker === f.ticker)!, candles, trades);
        expect(c).not.toBeNull();
        return { ticker: f.ticker, score: c!.anomalyScore };
      })
      .sort((a, b) => b.score - a.score);

    const deps = makeDeps(markets, dataByTicker, alwaysUnexplained());
    const plan = await planProbe(deps, { ...baseOpts, maxBets: 3 });

    expect(plan).toHaveLength(3);
    expect(plan.map((p) => p.candidate.market.marketTicker)).toEqual(groundTruth.slice(0, 3).map((g) => g.ticker));
    // strictly non-increasing
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i - 1]!.candidate.anomalyScore).toBeGreaterThanOrEqual(plan[i]!.candidate.anomalyScore);
    }
  });

  it("filters out candidates that fail viability (e.g. already closed) before ever investigating them", async () => {
    const closedTicker = "MKT-CLOSED";
    const okTicker = "MKT-OK";
    const markets = [
      makeMarket(closedTicker, { closeTs: NOW_TS - 1 }), // already closed
      makeMarket(okTicker),
    ];
    const dataByTicker = new Map([
      [closedTicker, buildSurgeData(closedTicker, 1.0)],
      [okTicker, buildSurgeData(okTicker, 1.0)],
    ]);
    const seen: string[] = [];
    const deps = makeDeps(markets, dataByTicker, alwaysUnexplained(seen));

    const plan = await planProbe(deps, baseOpts);

    expect(plan.map((p) => p.candidate.market.marketTicker)).toEqual([okTicker]);
    expect(seen).toEqual([okTicker]); // investigator never called for the unviable market
  });

  it("filters out EXPLAINED/AMBIGUOUS verdicts via keepUnexplained", async () => {
    const explainedTicker = "MKT-EXPLAINED";
    const unexplainedTicker = "MKT-UNEXPLAINED";
    const markets = [makeMarket(explainedTicker), makeMarket(unexplainedTicker)];
    const dataByTicker = new Map([
      [explainedTicker, buildSurgeData(explainedTicker, 1.0)],
      [unexplainedTicker, buildSurgeData(unexplainedTicker, 1.0)],
    ]);
    const investigator: Investigator = {
      async investigate(c): Promise<Investigation> {
        const verdict: Verdict = c.market.marketTicker === explainedTicker ? "EXPLAINED" : "UNEXPLAINED";
        return { verdict, rationale: "r", sources: [] };
      },
    };
    const deps = makeDeps(markets, dataByTicker, investigator);

    const plan = await planProbe(deps, baseOpts);

    expect(plan.map((p) => p.candidate.market.marketTicker)).toEqual([unexplainedTicker]);
  });

  // NOTE on "planning never places orders": this is a STRUCTURAL guarantee, not something a
  // runtime spy could meaningfully falsify -- `ProbeDeps` (see src/live/probe.ts) has no
  // order-client field at all, so `planProbe` has no way to reach an `OrderClient` even if it
  // wanted to. Order placement only happens in `executeProbe`, whose spending/count caps are
  // exercised by the "executeProbe" test suite below. What IS worth asserting here is that
  // planning actually produces the expected plan.
  it("produces the expected plan for a viable, unexplained candidate", async () => {
    const ticker = "MKT-PLAN-ONLY";
    const markets = [makeMarket(ticker)];
    const dataByTicker = new Map([[ticker, buildSurgeData(ticker, 1.0)]]);
    const deps = makeDeps(markets, dataByTicker, alwaysUnexplained());

    const plan = await planProbe(deps, baseOpts);

    expect(plan.length).toBeGreaterThan(0);
    expect(plan[0]!.candidate.market.marketTicker).toBe(ticker);
  });

  it("skips a market whose getCandles throws and still returns candidates from the good markets", async () => {
    const badTicker = "MKT-BAD";
    const goodTicker = "MKT-GOOD";
    const markets = [makeMarket(badTicker), makeMarket(goodTicker)];
    const dataByTicker = new Map([[goodTicker, buildSurgeData(goodTicker, 1.0)]]);
    const deps: ProbeDeps = {
      listOpenMarkets: async () => markets,
      getCandles: async (_series, ticker) => {
        if (ticker === badTicker) throw new Error("Kalshi HTTP 429 (persistent)");
        return dataByTicker.get(ticker)?.candles ?? [];
      },
      getTrades: async (ticker) => dataByTicker.get(ticker)?.trades ?? [],
      investigator: alwaysUnexplained(),
      nowTs: NOW_TS,
    };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const plan = await planProbe(deps, baseOpts);

    expect(plan.map((p) => p.candidate.market.marketTicker)).toEqual([goodTicker]);
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes(`skip ${badTicker}`))).toBe(true);
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes("1 scanned, 1 skipped"))).toBe(true);
    errSpy.mockRestore();
  });

  it("skips a market whose getTrades throws without aborting the whole plan", async () => {
    const badTicker = "MKT-BAD-TRADES";
    const goodTicker = "MKT-GOOD-2";
    const markets = [makeMarket(badTicker), makeMarket(goodTicker)];
    const dataByTicker = new Map([
      [badTicker, buildSurgeData(badTicker, 1.0)],
      [goodTicker, buildSurgeData(goodTicker, 1.0)],
    ]);
    const deps: ProbeDeps = {
      listOpenMarkets: async () => markets,
      getCandles: async (_series, ticker) => dataByTicker.get(ticker)?.candles ?? [],
      getTrades: async (ticker) => {
        if (ticker === badTicker) throw new Error("network error");
        return dataByTicker.get(ticker)?.trades ?? [];
      },
      investigator: alwaysUnexplained(),
      nowTs: NOW_TS,
    };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const plan = await planProbe(deps, baseOpts);

    expect(plan.map((p) => p.candidate.market.marketTicker)).toEqual([goodTicker]);
    errSpy.mockRestore();
  });

  it("logs a Funnel summary line to stderr and still returns unchanged behavior (1 kept of 2 markets)", async () => {
    const anomalyTicker = "MKT-FUNNEL-ANOMALY";
    const flatTicker = "MKT-FUNNEL-FLAT";
    const markets = [makeMarket(anomalyTicker), makeMarket(flatTicker)];
    // Flat/no-surge candles for flatTicker mean detectCandidate returns null (no anomaly).
    const flatCandles = Array.from({ length: 11 }, (_, i) => candle(i, 50, 5, 100));
    const dataByTicker = new Map([
      [anomalyTicker, buildSurgeData(anomalyTicker, 1.0)],
      [flatTicker, { candles: flatCandles, trades: [] }],
    ]);
    const deps = makeDeps(markets, dataByTicker, alwaysUnexplained());
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const plan = await planProbe(deps, baseOpts);

    // Behavior is unchanged: exactly the one UNEXPLAINED anomaly is kept.
    expect(plan.map((p) => p.candidate.market.marketTicker)).toEqual([anomalyTicker]);

    const lines = errSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.startsWith("Funnel:"))).toBe(true);
    expect(lines.some((l) => l.includes(`investigate ${anomalyTicker}`))).toBe(true);
    errSpy.mockRestore();
  });

  it("forwards windowSize/baselineSize opts through to detectCandidate", async () => {
    const ticker = "MKT-WINDOW-FORWARD";
    const markets = [makeMarket(ticker)];
    const dataByTicker = new Map([[ticker, buildSurgeData(ticker, 1.0)]]); // 11 candles total
    const deps = makeDeps(markets, dataByTicker, alwaysUnexplained());

    // Sanity: with default window/baseline sizes (3/5), this market yields a candidate.
    const defaultPlan = await planProbe(deps, baseOpts);
    expect(defaultPlan.map((p) => p.candidate.market.marketTicker)).toEqual([ticker]);

    // With a baselineSize larger than the available candle history, slidingWindows (see
    // src/replay/windows.ts) produces zero slices, so detectCandidate must return null for
    // this market -- this can only happen if planProbe actually forwards opts.baselineSize
    // through to detectCandidate instead of relying on its own default.
    const starvedPlan = await planProbe(deps, { ...baseOpts, baselineSize: 20 });
    expect(starvedPlan).toEqual([]);
  });

  it("fetches a bounded recent candle/trade window ending at nowTs, never the market's future closeTs", async () => {
    // A market that just opened, with a closeTs far in the future -- the classic OPEN-market
    // shape that broke the old openTs->closeTs fetch (closeTs in the future returns ~1 candle
    // or a 400). endTs must be nowTs and startTs must be a bounded lookback, never closeTs.
    const ticker = "MKT-RECENT-WINDOW";
    const openTs = NOW_TS - 100_000;
    const closeTs = NOW_TS + 365 * 86400; // far future
    const markets = [makeMarket(ticker, { openTs, closeTs })];
    const dataByTicker = new Map([[ticker, buildSurgeData(ticker, 1.0)]]);

    const candlesCalls: { startTs: number; endTs: number }[] = [];
    const tradesCalls: { minTs?: number; maxTs?: number }[] = [];
    const deps: ProbeDeps = {
      listOpenMarkets: async () => markets,
      getCandles: async (_series, _ticker, startTs, endTs) => {
        candlesCalls.push({ startTs, endTs });
        return dataByTicker.get(ticker)!.candles;
      },
      getTrades: async (_ticker, minTs, maxTs) => {
        tradesCalls.push({ minTs, maxTs });
        return dataByTicker.get(ticker)!.trades;
      },
      investigator: alwaysUnexplained(),
      nowTs: NOW_TS,
    };

    await planProbe(deps, baseOpts); // baseOpts.period = 1, default window=3/baseline=5

    const expectedLookbackSec = Math.max(3 + 5 + 5, (3 + 5) * 2) * baseOpts.period * 60;
    const expectedStartTs = NOW_TS - expectedLookbackSec;

    expect(candlesCalls).toHaveLength(1);
    expect(candlesCalls[0]!.endTs).toBe(NOW_TS);
    expect(candlesCalls[0]!.endTs).not.toBe(closeTs);
    expect(candlesCalls[0]!.startTs).toBe(expectedStartTs);
    expect(candlesCalls[0]!.startTs).toBeGreaterThan(openTs);

    expect(tradesCalls).toHaveLength(1);
    expect(tradesCalls[0]!.maxTs).toBe(NOW_TS);
    expect(tradesCalls[0]!.minTs).toBe(expectedStartTs);
  });

  it("clamps the lookback start to the market's openTs when the market is younger than the full lookback window", async () => {
    const ticker = "MKT-YOUNG";
    const openTs = NOW_TS - 60; // market opened only 60s ago
    const closeTs = NOW_TS + 365 * 86400;
    const markets = [makeMarket(ticker, { openTs, closeTs })];
    const dataByTicker = new Map([[ticker, buildSurgeData(ticker, 1.0)]]);

    const candlesCalls: { startTs: number; endTs: number }[] = [];
    const deps: ProbeDeps = {
      listOpenMarkets: async () => markets,
      getCandles: async (_series, _ticker, startTs, endTs) => {
        candlesCalls.push({ startTs, endTs });
        return dataByTicker.get(ticker)!.candles;
      },
      getTrades: async () => dataByTicker.get(ticker)!.trades,
      investigator: alwaysUnexplained(),
      nowTs: NOW_TS,
    };

    await planProbe(deps, baseOpts);

    expect(candlesCalls[0]!.startTs).toBe(openTs); // clamped, not the unbounded lookback
    expect(candlesCalls[0]!.endTs).toBe(NOW_TS);
  });

  it("scales the lookback window with windowSize/baselineSize opts instead of a fixed constant", async () => {
    const ticker = "MKT-SCALED-LOOKBACK";
    const markets = [makeMarket(ticker)];
    const dataByTicker = new Map([[ticker, buildSurgeData(ticker, 1.0)]]);

    const candlesCalls: { startTs: number; endTs: number }[] = [];
    const deps: ProbeDeps = {
      listOpenMarkets: async () => markets,
      getCandles: async (_series, _ticker, startTs, endTs) => {
        candlesCalls.push({ startTs, endTs });
        return dataByTicker.get(ticker)!.candles;
      },
      getTrades: async () => dataByTicker.get(ticker)!.trades,
      investigator: alwaysUnexplained(),
      nowTs: NOW_TS,
    };

    await planProbe(deps, { ...baseOpts, windowSize: 10, baselineSize: 20 });

    const expectedLookbackSec = Math.max(10 + 20 + 5, (10 + 20) * 2) * baseOpts.period * 60;
    expect(candlesCalls[0]!.startTs).toBe(NOW_TS - expectedLookbackSec);
  });

  it("produces deterministic clientOrderIds (no randomness) across repeated runs with the same nowTs", async () => {
    const ticker = "MKT-DETERMINISTIC";
    const markets = [makeMarket(ticker)];
    const dataByTicker = new Map([[ticker, buildSurgeData(ticker, 1.0)]]);
    const deps = makeDeps(markets, dataByTicker, alwaysUnexplained());

    const plan1 = await planProbe(deps, baseOpts);
    const plan2 = await planProbe(deps, baseOpts);

    expect(plan1.map((p) => p.clientOrderId)).toEqual(plan2.map((p) => p.clientOrderId));
    expect(plan1[0]!.clientOrderId).toContain(`probe-${ticker}-${NOW_TS}`);
  });
});

// ---------- executeProbe ----------

function makeProbeCandidate(
  ticker: string,
  costCents: number,
  count: number,
  opts: { entryCents?: number; direction?: Side } = {},
): ProbeCandidate {
  const entryCents = opts.entryCents ?? 50;
  return {
    candidate: {
      market: makeMarket(ticker),
      direction: opts.direction ?? "yes",
      anomalyScore: 1,
      entryCents,
    },
    investigation: { verdict: "UNEXPLAINED", rationale: "r", sources: [] },
    order: { count, costCents },
    clientOrderId: `probe-${ticker}-${NOW_TS}`,
  };
}

function fakeOrderClient(balanceCents: number) {
  const balanceCalls: number[] = [];
  const placeCalls: OrderRequest[] = [];
  const client: OrderClient = {
    getBalanceCents: async () => {
      balanceCalls.push(Date.now());
      return balanceCents;
    },
    placeLimitBuy: async (o: OrderRequest) => {
      placeCalls.push(o);
      return { orderId: `ORD-${o.clientOrderId}`, status: "resting" };
    },
  };
  return { client, balanceCalls, placeCalls };
}

describe("executeProbe", () => {
  it("rejects a plan of 12 orders (>10) and never calls balance or place", async () => {
    const plan = Array.from({ length: 12 }, (_, i) => makeProbeCandidate(`T${i}`, 80, 1));
    const { client, balanceCalls, placeCalls } = fakeOrderClient(100_000);

    await expect(executeProbe(client, plan)).rejects.toThrow(/10/);
    expect(balanceCalls).toHaveLength(0);
    expect(placeCalls).toHaveLength(0);
  });

  it("rejects when any single order's cost exceeds 100 cents and never places any order", async () => {
    const plan = [makeProbeCandidate("T1", 50, 1), makeProbeCandidate("T2", 150, 1)];
    const { client, balanceCalls, placeCalls } = fakeOrderClient(100_000);

    await expect(executeProbe(client, plan)).rejects.toThrow(/100/);
    expect(balanceCalls).toHaveLength(0);
    expect(placeCalls).toHaveLength(0);
  });

  it("aborts before placing any order when balance < total cost", async () => {
    const plan = [makeProbeCandidate("T1", 100, 2), makeProbeCandidate("T2", 100, 2), makeProbeCandidate("T3", 100, 2)];
    // total = 300c; balance is less
    const { client, placeCalls } = fakeOrderClient(200);

    await expect(executeProbe(client, plan)).rejects.toThrow(/balance/i);
    expect(placeCalls).toHaveLength(0);
  });

  it("never lets total cost exceed 1000 cents ($10), even at the boundary of the per-order and count caps", async () => {
    // 10 orders at 100c each = 1000c exactly: allowed.
    const okPlan = Array.from({ length: 10 }, (_, i) => makeProbeCandidate(`OK${i}`, 100, 1));
    const { client: okClient, placeCalls: okPlaceCalls } = fakeOrderClient(100_000);
    const okResults = await executeProbe(okClient, okPlan);
    expect(okResults).toHaveLength(10);
    expect(okPlaceCalls).toHaveLength(10);
    const okTotal = okPlan.reduce((s, p) => s + p.order.costCents, 0);
    expect(okTotal).toBeLessThanOrEqual(1000);
  });

  it("rejects a plan containing a non-finite costCents order and never places any order", async () => {
    const plan = [makeProbeCandidate("T1", 50, 1), makeProbeCandidate("T2", NaN, 1)];
    const { client, balanceCalls, placeCalls } = fakeOrderClient(100_000);

    await expect(executeProbe(client, plan)).rejects.toThrow();
    expect(balanceCalls).toHaveLength(0);
    expect(placeCalls).toHaveLength(0);
  });

  it("rejects a plan containing a zero-count order and never places any order", async () => {
    const plan = [makeProbeCandidate("T1", 50, 1), makeProbeCandidate("T2", 0, 0)];
    const { client, balanceCalls, placeCalls } = fakeOrderClient(100_000);

    await expect(executeProbe(client, plan)).rejects.toThrow();
    expect(balanceCalls).toHaveLength(0);
    expect(placeCalls).toHaveLength(0);
  });

  it("places every order via placeLimitBuy with the sized order fields, after confirming balance, and returns orderId/status", async () => {
    const plan = [
      makeProbeCandidate("T-YES", 62, 1, { entryCents: 62, direction: "yes" }),
      makeProbeCandidate("T-NO", 80, 2, { entryCents: 40, direction: "no" }),
    ];
    const { client, balanceCalls, placeCalls } = fakeOrderClient(1000);

    const results = await executeProbe(client, plan);

    expect(balanceCalls).toHaveLength(1);
    expect(placeCalls).toHaveLength(2);
    expect(placeCalls[0]).toEqual({
      ticker: "T-YES",
      side: "yes",
      count: 1,
      priceCents: 62,
      clientOrderId: plan[0]!.clientOrderId,
      buyMaxCostCents: 100,
    });
    expect(placeCalls[1]).toEqual({
      ticker: "T-NO",
      side: "no",
      count: 2,
      priceCents: 40,
      clientOrderId: plan[1]!.clientOrderId,
      buyMaxCostCents: 100,
    });
    expect(results).toEqual([
      { ticker: "T-YES", clientOrderId: plan[0]!.clientOrderId, orderId: `ORD-${plan[0]!.clientOrderId}`, status: "resting" },
      { ticker: "T-NO", clientOrderId: plan[1]!.clientOrderId, orderId: `ORD-${plan[1]!.clientOrderId}`, status: "resting" },
    ]);
  });
});
