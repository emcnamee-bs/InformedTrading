import { describe, it, expect } from "vitest";
import { ClaudeInvestigator, buildPrompt, parseRunnerResult } from "../../src/live/claudeInvestigator";
import { LiveCandidate } from "../../src/live/candidate";

/**
 * All tests here inject a fake runner -- no real Anthropic client is ever constructed, so
 * these tests never touch the network and never need ANTHROPIC_API_KEY.
 */
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

describe("ClaudeInvestigator", () => {
  it("maps a fake runner returning UNEXPLAINED to an UNEXPLAINED Investigation", async () => {
    const investigator = new ClaudeInvestigator(async () => ({
      verdict: "UNEXPLAINED",
      rationale: "Thorough search found no public catalyst for this move.",
      sources: ["https://example.com/a"],
    }));

    const result = await investigator.investigate(candidate);

    expect(result.verdict).toBe("UNEXPLAINED");
    expect(result.rationale).toBe("Thorough search found no public catalyst for this move.");
    expect(result.sources).toEqual(["https://example.com/a"]);
  });

  it("maps a fake runner returning EXPLAINED to an EXPLAINED Investigation", async () => {
    const investigator = new ClaudeInvestigator(async () => ({
      verdict: "EXPLAINED",
      rationale: "Found a news article explaining the move.",
      sources: ["https://news.example.com/article"],
    }));

    const result = await investigator.investigate(candidate);

    expect(result.verdict).toBe("EXPLAINED");
  });

  it("fails safe to AMBIGUOUS when the runner throws", async () => {
    const investigator = new ClaudeInvestigator(async () => {
      throw new Error("simulated network failure");
    });

    const result = await investigator.investigate(candidate);

    expect(result.verdict).toBe("AMBIGUOUS");
    expect(result.sources).toEqual([]);
  });

  it("fails safe to AMBIGUOUS when the runner returns an invalid verdict shape", async () => {
    const investigator = new ClaudeInvestigator(async () => ({
      // Simulates a malformed / unparseable model response.
      verdict: "MAYBE" as unknown as "UNEXPLAINED",
      rationale: "",
      sources: [],
    }));

    const result = await investigator.investigate(candidate);

    expect(result.verdict).toBe("AMBIGUOUS");
  });

  it("defaults to the real Anthropic-backed runner when none is injected (construction only, no invocation)", () => {
    // Constructing without a runner must not throw or require ANTHROPIC_API_KEY --
    // the real SDK call only happens lazily inside investigate().
    expect(() => new ClaudeInvestigator()).not.toThrow();
  });
});

describe("buildPrompt (validated rubric)", () => {
  const candidate = {
    market: {
      marketTicker: "M", seriesTicker: "S", category: "C",
      openTs: 0, closeTs: 0, liquidityVolume: 100, yesBidCents: 55, yesAskCents: 58,
    },
    direction: "yes", entryCents: 58, anomalyScore: 3.2,
  } as unknown as LiveCandidate;

  it("includes the 'separate the flagged signal' rubric", () => {
    expect(buildPrompt(candidate)).toContain("Separate the FLAGGED signal from surrounding market activity");
  });

  it("includes the per-outcome highest-conviction rubric", () => {
    expect(buildPrompt(candidate)).toContain("concentrating on the HIGHEST-CONVICTION outcomes");
  });

  it("uses the revised, direction-aware verdict definitions", () => {
    const p = buildPrompt(candidate);
    expect(p).toContain("EXPLAINED: a public catalyst specifically accounts for the flagged pattern");
    expect(p).toContain("explains the volume but NOT the flagged direction/concentration");
  });
});

describe("buildPrompt (additive fields, rubric unchanged)", () => {
  const candidate = {
    market: { marketTicker: "M", seriesTicker: "S", category: "C", openTs: 0, closeTs: 0, liquidityVolume: 100, yesBidCents: 55, yesAskCents: 58 },
    direction: "no", entryCents: 20, anomalyScore: 2,
  } as any;
  it("asks for publicLean and eventStatus", () => {
    const p = buildPrompt(candidate);
    expect(p).toContain('"publicLean"');
    expect(p).toContain('"eventStatus"');
  });
  it("leaves the validated verdict rubric intact", () => {
    const p = buildPrompt(candidate);
    expect(p).toContain("Separate the FLAGGED signal from surrounding market activity");
    expect(p).toContain("concentrating on the HIGHEST-CONVICTION outcomes");
  });
});

describe("parseRunnerResult", () => {
  it("parses verdict + publicLean + eventStatus", () => {
    const r = parseRunnerResult('reasoning...\n{"verdict":"UNEXPLAINED","publicLean":"silent","eventStatus":"upcoming","rationale":"x","sources":["u"]}');
    expect(r.verdict).toBe("UNEXPLAINED");
    expect(r.publicLean).toBe("silent");
    expect(r.eventStatus).toBe("upcoming");
  });
  it("leaves publicLean/eventStatus undefined when missing or invalid", () => {
    const r = parseRunnerResult('{"verdict":"EXPLAINED","publicLean":"bogus","rationale":"","sources":[]}');
    expect(r.publicLean).toBeUndefined();
    expect(r.eventStatus).toBeUndefined();
  });
  it("throws when no valid verdict is present", () => {
    expect(() => parseRunnerResult('no json here')).toThrow();
  });
});
