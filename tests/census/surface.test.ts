import { describe, it, expect } from "vitest";
import { retOnTraded, winRate, impliedFromBand, winRateVsImplied, marginal } from "../../src/census/surface";
import { CellRow } from "../../src/census/insiderDb";
import { isRipe, persistence } from "../../src/census/surface";
import { RawRow } from "../../src/census/insiderDb";

const cell = (o: Partial<CellRow> = {}): CellRow => ({
  cellKey: "k", category: "mentions", detector: "cusum+imbalance", sensitivity: "medium",
  direction: "yes", entryBand: "b60", timeBucket: "1d", scoreBucket: "med",
  n: 10, wins: 7, tradedCents: 10, pnlCents: 2, ...o,
});

describe("surface metrics", () => {
  it("retOnTraded = pnl/traded, 0 when no traded", () => {
    expect(retOnTraded({ pnlCents: 2, tradedCents: 10 })).toBeCloseTo(0.2);
    expect(retOnTraded({ pnlCents: 0, tradedCents: 0 })).toBe(0);
  });
  it("winRate = wins/n, 0 when n=0", () => {
    expect(winRate({ wins: 7, n: 10 })).toBeCloseTo(0.7);
    expect(winRate({ wins: 0, n: 0 })).toBe(0);
  });
  it("impliedFromBand parses b<NN> to a probability, bNA -> null", () => {
    expect(impliedFromBand("b60")).toBeCloseTo(0.6);
    expect(impliedFromBand("bNA")).toBeNull();
  });
  it("winRateVsImplied = winRate - impliedFromBand (null when band unparseable)", () => {
    expect(winRateVsImplied(cell({ wins: 7, n: 10, entryBand: "b60" }))).toBeCloseTo(0.1);
    expect(winRateVsImplied(cell({ entryBand: "bNA" }))).toBeNull();
  });
});

it("marginal collapses cells along one axis, aggregates, sorts by retOnTraded desc", () => {
  const cells = [
    cell({ category: "mentions", n: 10, wins: 6, tradedCents: 10, pnlCents: 1 }),
    cell({ category: "mentions", n: 10, wins: 8, tradedCents: 10, pnlCents: 3 }),
    cell({ category: "politics", n: 20, wins: 5, tradedCents: 20, pnlCents: -4 }),
  ];
  const m = marginal(cells, "category");
  expect(m).toHaveLength(2);
  expect(m[0]!.value).toBe("mentions"); // higher retOnTraded first
  expect(m[0]!.n).toBe(20);
  expect(m[0]!.tradedCents).toBe(20);
  expect(m[0]!.pnlCents).toBe(4);
  expect(m[0]!.retOnTraded).toBeCloseTo(0.2);
  expect(m[1]!.value).toBe("politics");
  expect(m[1]!.retOnTraded).toBeCloseTo(-0.2);
});

const raw = (settledAt: number, won: boolean, pnl: number): RawRow => ({
  ticker: "T", side: "yes", cellKey: "k", entryPriceCents: 50, count: 1 / 50,
  won, pnlCents: pnl, anomalyScore: 2, settledAt, settleSource: "market-result",
});

it("isRipe requires retOnTraded >= minRet AND n >= minSample", () => {
  expect(isRipe({ retOnTraded: 0.05, n: 600 })).toBe(true);
  expect(isRipe({ retOnTraded: 0.05, n: 100 })).toBe(false);
  expect(isRipe({ retOnTraded: 0.01, n: 600 })).toBe(false);
});
it("persistence requires positive ret in BOTH the recent and prior windows", () => {
  const NOW = 1_000_000;
  const rows = [
    raw(NOW - 10 * 3600, true, 2),   // recent, win
    raw(NOW - 100 * 3600, true, 2),  // prior, win
  ];
  const p = persistence(rows, NOW, 48 * 3600);
  expect(p.recentN).toBe(1); expect(p.priorN).toBe(1); expect(p.persistent).toBe(true);
  // a prior-window loss breaks persistence
  const p2 = persistence([raw(NOW - 10 * 3600, true, 2), raw(NOW - 100 * 3600, false, -1)], NOW, 48 * 3600);
  expect(p2.persistent).toBe(false);
});
