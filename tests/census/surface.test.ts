import { describe, it, expect } from "vitest";
import { retOnTraded, winRate, impliedFromBand, winRateVsImplied } from "../../src/census/surface";
import { CellRow } from "../../src/census/insiderDb";

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
