import { LiveCandidate } from "./candidate";

export type Verdict = "EXPLAINED" | "UNEXPLAINED" | "AMBIGUOUS";

export interface Investigation {
  verdict: Verdict;
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
