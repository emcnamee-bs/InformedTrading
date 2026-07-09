import { describe, it, expect } from "vitest";
import { isViable, DEFAULT_VIABILITY, ViabilityParams } from "../../src/live/viability";
import { LiveCandidate } from "../../src/live/candidate";

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

  it("passes for a viable candidate", () => {
    const candidate = baseLiveCandidate();
    const result = isViable(candidate, baseTime);
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

  it("fails when entry price is below minimum", () => {
    const candidate = baseLiveCandidate({ entryCents: 4 });
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(false);
    expect(result.reason).toBe("entry price out of range");
  });

  it("fails when entry price is above maximum", () => {
    const candidate = baseLiveCandidate({ entryCents: 96 });
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(false);
    expect(result.reason).toBe("entry price out of range");
  });

  it("fails when entry price is NaN", () => {
    const candidate = baseLiveCandidate({ entryCents: NaN });
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(false);
    expect(result.reason).toBe("entry price out of range");
  });

  it("fails when entry price is Infinity", () => {
    const candidate = baseLiveCandidate({ entryCents: Infinity });
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(false);
    expect(result.reason).toBe("entry price out of range");
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

  it("respects custom viability params", () => {
    const customParams: ViabilityParams = {
      maxHorizonDays: 7,
      minEntryCents: 10,
      maxEntryCents: 90,
      maxSpreadCents: 5,
    };
    const candidate = baseLiveCandidate({ entryCents: 9 }); // Below custom min
    const result = isViable(candidate, baseTime, customParams);
    expect(result.viable).toBe(false);
    expect(result.reason).toBe("entry price out of range");
  });

  it("accepts entry price at exact minimum boundary", () => {
    const candidate = baseLiveCandidate({ entryCents: 5 });
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(true);
  });

  it("accepts entry price at exact maximum boundary", () => {
    const candidate = baseLiveCandidate({ entryCents: 95 });
    const result = isViable(candidate, baseTime);
    expect(result.viable).toBe(true);
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
});
