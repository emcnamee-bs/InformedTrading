import { describe, it, expect } from "vitest";
import {
  Investigation,
  Investigator,
  Verdict,
  keepCandidate,
} from "../../src/live/investigator";
import { LiveCandidate } from "../../src/live/candidate";

/**
 * Fake investigator for testing: returns a verdict based on configuration.
 * Used to test the keepCandidate filter logic in isolation.
 */
class FakeInvestigator implements Investigator {
  constructor(private verdict: Verdict) {}

  async investigate(c: LiveCandidate): Promise<Investigation> {
    return {
      verdict: this.verdict,
      rationale: `Test rationale for verdict: ${this.verdict}`,
      sources: ["test-source"],
    };
  }
}

describe("Investigator interface", () => {
  it("FakeInvestigator implements the interface correctly", async () => {
    const unexplainedInvestigator = new FakeInvestigator("UNEXPLAINED");
    const explainedInvestigator = new FakeInvestigator("EXPLAINED");
    const ambiguousInvestigator = new FakeInvestigator("AMBIGUOUS");

    // Create a minimal test candidate
    const candidate: LiveCandidate = {
      market: {
        marketTicker: "test-market",
        seriesTicker: "test-series",
        category: "test",
        openTs: 0,
        closeTs: 1000,
        liquidityVolume: 1000,
        yesAskCents: 50,
        yesBidCents: 49,
      },
      direction: "yes",
      anomalyScore: 0.5,
      entryCents: 50,
    };

    const unexplainedResult = await unexplainedInvestigator.investigate(candidate);
    const explainedResult = await explainedInvestigator.investigate(candidate);
    const ambiguousResult = await ambiguousInvestigator.investigate(candidate);

    expect(unexplainedResult.verdict).toBe("UNEXPLAINED");
    expect(explainedResult.verdict).toBe("EXPLAINED");
    expect(ambiguousResult.verdict).toBe("AMBIGUOUS");
  });
});

describe("keepCandidate", () => {
  const base: Investigation = { verdict: "UNEXPLAINED", publicLean: "silent", eventStatus: "upcoming", rationale: "", sources: [] };
  it("keeps UNEXPLAINED + silent + not-past", () => {
    expect(keepCandidate(base)).toBe(true);
  });
  it("drops when public info leans opposite the flag", () => {
    expect(keepCandidate({ ...base, publicLean: "opposite" })).toBe(false);
  });
  it("drops when the event already happened", () => {
    expect(keepCandidate({ ...base, eventStatus: "past" })).toBe(false);
  });
  it("drops when publicLean is missing (fail-safe default)", () => {
    expect(keepCandidate({ verdict: "UNEXPLAINED", rationale: "", sources: [] })).toBe(false);
  });
  it("drops EXPLAINED and AMBIGUOUS regardless", () => {
    expect(keepCandidate({ ...base, verdict: "EXPLAINED" })).toBe(false);
    expect(keepCandidate({ ...base, verdict: "AMBIGUOUS" })).toBe(false);
  });
});
