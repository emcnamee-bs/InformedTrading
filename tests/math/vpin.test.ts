import { describe, it, expect } from "vitest";
import { vpin } from "../../src/math/vpin";
import { Trade } from "../../src/kalshi/types";

const t = (takerSide: "yes" | "no", count: number): Trade => ({
  tradeId: Math.random().toString(36), ticker: "T", yesPriceCents: 50,
  count, takerSide, createdTs: 0,
});

describe("vpin", () => {
  it("abstains (null) when there is not enough volume to fill the buckets", () => {
    expect(vpin([t("yes", 5)], 10, 2)).toBeNull();
  });
  it("is ~1 for fully one-sided flow", () => {
    const trades = [t("yes", 10), t("yes", 10), t("yes", 10), t("yes", 10)];
    expect(vpin(trades, 10, 2)).toBeCloseTo(1, 6);
  });
  it("is ~0 for perfectly balanced buckets", () => {
    const trades = [t("yes", 5), t("no", 5), t("yes", 5), t("no", 5)];
    expect(vpin(trades, 10, 2)).toBeCloseTo(0, 6);
  });
});
