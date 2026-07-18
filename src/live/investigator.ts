import { LiveCandidate } from "./candidate";

export type Verdict = "EXPLAINED" | "UNEXPLAINED" | "AMBIGUOUS";
export type PublicLean = "same" | "opposite" | "silent";
export type EventStatus = "past" | "upcoming" | "unknown";

export interface Investigation {
  verdict: Verdict;
  // Which way public information points relative to the FLAGGED direction, and whether the
  // resolving event has already happened. Optional: absent on fail-safe investigations, which are
  // then correctly treated as not-followable by keepCandidate.
  publicLean?: PublicLean;
  eventStatus?: EventStatus;
  rationale: string;
  sources: string[];
}

export interface Investigator {
  investigate(c: LiveCandidate): Promise<Investigation>;
}

/**
 * Filter policy: keep only clearly-unexplained candidates for trading.
 * EXPLAINED and AMBIGUOUS verdicts are filtered out.
 */
export function keepUnexplained(inv: Investigation): boolean {
  return inv.verdict === "UNEXPLAINED";
}

/**
 * Follow policy: keep a candidate to bet only when the flagged move is genuinely unexplained AND
 * public information does not point the OPPOSITE way (don't follow a flag public info makes likely
 * to lose) AND the resolving event has not already happened. Missing publicLean/eventStatus (e.g.
 * fail-safe investigations) are treated as not-followable.
 */
export function keepCandidate(inv: Investigation): boolean {
  return inv.verdict === "UNEXPLAINED" && inv.publicLean === "silent" && inv.eventStatus !== "past";
}
