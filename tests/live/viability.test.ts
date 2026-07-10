import { describe, it, expect } from "vitest";
import { isViable, DEFAULT_VIABILITY, ViabilityParams } from "../../src/live/viability";
import { LiveCandidate } from "../../src/live/candidate";
import { feePerContract } from "../../src/expectancy/fees";

describe("isViable", () => {
  const baseTime = 1000000000; // unix seconds
  const baseLiveCandidate = (overrides?: Partial<LiveCandidate>): LiveCandidate => ({
    market: {
      marketTicker: "TEST001",
      seriesTicker: "TEST",
      category: "test",
      openTs: baseTime - 86400,
      closeTs: baseTime + 86400 * 7, // 7 days in future
      liquidityVolume: 1000,
      yesBidCents: 50,
      yesAskCents: 52,
    },
    direction: "yes",
    anomalyScore: 0.5,
    entryCents: 52, // yesAsk
    ...overrides,
  });

  const netReturn = (entryCents: number): number => {
    const cost = entryCents / 100 + feePerContract(entryCents);
    return (1 - cost) / cost;
  };

  it("passes for a viable candidate with sufficient return", () => {
    const candidate = baseLiveCandidate({ entryCents: 52 });
    const result = isViable(candidate, baseTime);
    expect(netReturn(52)).toBeGreaterThan(DEFAULT_VIABILITY.minReturn);
    expect(result.viable).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("fails when resolution is already closed (horizon <= 0)", () => {
    const candidate = baseLiveCandidate({
      market: {
        ...baseLiveCandidate().market,
        closeTs: baseTime, // closes at now
      },
    });
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(false);
    expect(result.reason).toBe("already closed");
  });

  it("fails when resolution is in the past", () => {
    const candidate = baseLiveCandidate({
      market: {
        ...baseLiveCandidate().market,
        closeTs: baseTime - 1000, // closed in past
      },
    });
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(false);
    expect(result.reason).toBe("already closed");
  });

  it("fails when resolution is beyond horizon", () => {
    const thirtyTwoDays = baseTime + 32 * 86400;
    const candidate = baseLiveCandidate({
      market: {
        ...baseLiveCandidate().market,
        closeTs: thirtyTwoDays,
      },
    });
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(false);
    expect(result.reason).toBe("beyond horizon");
  });

  it("accepts resolution at exact horizon boundary", () => {
    const thirtyOneDays = baseTime + 31 * 86400;
    const candidate = baseLiveCandidate({
      market: {
        ...baseLiveCandidate().market,
        closeTs: thirtyOneDays,
      },
    });
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(true);
  });

  it("fails when entry price is 0 (degenerate)", () => {
    const candidate = baseLiveCandidate({ entryCents: 0 });
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(false);
    expect(result.reason).toBe("degenerate entry price");
  });

  it("fails when entry price is 100 (degenerate)", () => {
    const candidate = baseLiveCandidate({ entryCents: 100 });
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(false);
    expect(result.reason).toBe("degenerate entry price");
  });

  it("fails when entry price is negative (degenerate)", () => {
    const candidate = baseLiveCandidate({ entryCents: -5 });
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(false);
    expect(result.reason).toBe("degenerate entry price");
  });

  it("fails when entry price is NaN (degenerate)", () => {
    const candidate = baseLiveCandidate({ entryCents: NaN });
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(false);
    expect(result.reason).toBe("degenerate entry price");
  });

  it("fails when entry price is Infinity (degenerate)", () => {
    const candidate = baseLiveCandidate({ entryCents: Infinity });
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(false);
    expect(result.reason).toBe("degenerate entry price");
  });

  it("fails when spread is too wide", () => {
    const candidate = baseLiveCandidate({
      market: {
        ...baseLiveCandidate().market,
        yesBidCents: 50,
        yesAskCents: 59, // spread = 9, exceeds default max of 8
      },
    });
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(false);
    expect(result.reason).toBe("spread too wide");
  });

  it("fails when spread is NaN", () => {
    const candidate = baseLiveCandidate({
      market: {
        ...baseLiveCandidate().market,
        yesBidCents: NaN,
        yesAskCents: 52,
      },
    });
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(false);
    expect(result.reason).toBe("spread too wide");
  });

  it("fails when spread is Infinity", () => {
    const candidate = baseLiveCandidate({
      market: {
        ...baseLiveCandidate().market,
        yesBidCents: 50,
        yesAskCents: Infinity,
      },
    });
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(false);
    expect(result.reason).toBe("spread too wide");
  });

  it("accepts spread at exact maximum boundary", () => {
    const candidate = baseLiveCandidate({
      market: {
        ...baseLiveCandidate().market,
        yesBidCents: 50,
        yesAskCents: 58, // spread = 8, exactly at default max
      },
    });
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(true);
  });

  it("accepts an entry price of 85c: net-of-fee return is well above the 5% minimum", () => {
    // cost = 0.85 + feePerContract(85) ~= 0.85 + 0.01 = 0.86 -> ret = (1-0.86)/0.86 ~= 16.3%
    const candidate = baseLiveCandidate({
      market: { ...baseLiveCandidate().market, yesBidCents: 84, yesAskCents: 85 },
      entryCents: 85,
    });
    const ret = netReturn(85);
    expect(ret).toBeGreaterThan(0.05);
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(true);
  });

  it("rejects an entry price of 98c: net-of-fee return is far below the 5% minimum", () => {
    const candidate = baseLiveCandidate({
      market: { ...baseLiveCandidate().market, yesBidCents: 97, yesAskCents: 98 },
      entryCents: 98,
    });
    const ret = netReturn(98);
    expect(ret).toBeLessThan(0.05);
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(false);
    expect(result.reason).toMatch(/^return .* below .*/);
  });

  it("rejects an entry price just under break-even (96c) as below the return minimum", () => {
    const candidate = baseLiveCandidate({
      market: { ...baseLiveCandidate().market, yesBidCents: 95, yesAskCents: 96 },
      entryCents: 96,
    });
    const ret = netReturn(96);
    expect(ret).toBeLessThan(0.05);
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(false);
    expect(result.reason).toMatch(/^return .* below .*/);
  });

  it("respects a custom (higher) minReturn param", () => {
    const customParams: ViabilityParams = {
      maxHorizonDays: 7,
      minReturn: 0.5, // 50% -- the default-viable 85c candidate (~16% return) no longer clears this
      maxSpreadCents: 5,
    };
    const candidate = baseLiveCandidate({
      market: { ...baseLiveCandidate().market, yesBidCents: 84, yesAskCents: 85 },
      entryCents: 85,
    });
    expect(netReturn(85)).toBeLessThan(0.5);
    const result = isViable(candidate, baseTime, customParams);
    expect(result.viable).toBe(false);
    expect(result.reason).toMatch(/^return .* below .*/);
  });

  it("respects a custom (lower) minReturn param that a high entry price now clears", () => {
    const customParams: ViabilityParams = {
      maxHorizonDays: 7,
      minReturn: 0.01, // 1%
      maxSpreadCents: 5,
    };
    const candidate = baseLiveCandidate({
      market: { ...baseLiveCandidate().market, yesBidCents: 89, yesAskCents: 90 },
      entryCents: 90,
    });
    expect(netReturn(90)).toBeGreaterThan(0.01);
    const result = isViable(candidate, baseTime, customParams);
    expect(result.viable).toBe(true);
  });
});
