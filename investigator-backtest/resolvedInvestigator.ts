// Adaptation of src/live/claudeInvestigator.ts for a RESOLVED market over a CURATED PRE-CUTOFF
// CORPUS (web_search disabled). The prompt mirrors the original claudeInvestigator.buildPrompt as
// closely as possible — same EXPLAINED/UNEXPLAINED/AMBIGUOUS definitions and {verdict,rationale,
// sources} shape — with only the minimal changes needed: resolved market, temporal cutoff, and
// "review the provided public info" in place of "search the public web". No leading interpretation.
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";

export const CUTOFF_ISO = "2026-07-03T20:00:00Z"; // 12:00 noon PST (UTC-8)
const MODEL = process.env.CLAUDE_INVESTIGATOR_MODEL?.trim() || "claude-opus-4-8";
const MAX_TOKENS = 4096;
const TIMEOUT_MS = 180_000;

export function buildResolvedPrompt(snapshotPath: string, corpusPath: string): string {
  const snap = JSON.parse(readFileSync(snapshotPath, "utf-8"));
  const corpus = readFileSync(corpusPath, "utf-8");
  const rows = snap.snapshot
    .map((s: any) => `  - ${s.name}: ${s.price_at_cutoff}c  (cumulative volume to date: ${s.cum_volume_to_cutoff})`)
    .join("\n");
  // Mirrors the original investigator's framing/verdict semantics (src/live/claudeInvestigator.ts).
  return [
    `A market-surveillance anomaly detector just flagged an unexplained, statistically anomalous`,
    `concentration in the Kalshi elimination event "${snap.event}" (Love Island USA — Season 8, Week 5).`,
    `Each remaining contestant has a YES market ("Will <contestant> be eliminated this week?"). The`,
    `moment under investigation is ${snap.cutoff_iso} (12:00 noon PST, 2026-07-03); this week's`,
    `elimination has NOT been revealed yet at that moment. As of that moment the YES prices`,
    `(probability of being eliminated), highest first, are:`,
    rows,
    ``,
    `Review the public information available as of that moment (provided in the dossier below) for`,
    `anything -- the show's format/rules, aired episodes, reported news, a public vote/ranking, betting`,
    `coverage, etc. -- that would plausibly explain this concentration.`,
    ``,
    `Assess it OUTCOME BY OUTCOME, concentrating on the market's HIGHEST-CONVICTION outcomes (those`,
    `priced nearest to certain). For each such outcome ask: does the public record SPECIFICALLY justify`,
    `THAT outcome being priced near-certain? A public explanation for some outcomes does not offset the`,
    `absence of one for the highest-conviction outcomes -- if even one near-certain outcome has no`,
    `specific public basis, the concentration is not fully accounted for by public information.`,
    ``,
    `- EXPLAINED: the public record specifically justifies the near-certainty of the highest-conviction`,
    `  outcomes (the concentration is publicly grounded).`,
    `- UNEXPLAINED: one or more of the highest-conviction outcomes are NOT justified by the public`,
    `  record (a thorough review finds nothing specifically supporting those top prices), even if some`,
    `  other, lower-priced outcomes are partially explainable.`,
    `- AMBIGUOUS: the evidence on the highest-conviction outcomes themselves is genuinely mixed/partial.`,
    ``,
    `Constraint: reason ONLY from the dossier below plus general knowledge that was already true before`,
    `the cutoff. You have no web access and no knowledge of the actual result; do not guess it.`,
    ``,
    `================= BEGIN PRE-CUTOFF DOSSIER =================`,
    corpus,
    `================== END PRE-CUTOFF DOSSIER ==================`,
    ``,
    `After your reasoning, end your reply with a single JSON object on its own line, and nothing after`,
    `it, in exactly this shape (no markdown fencing):`,
    `{"verdict":"EXPLAINED"|"UNEXPLAINED"|"AMBIGUOUS","rationale":"...","sources":["dossier section or fact you relied on", ...]}`,
  ].join("\n");
}

export function extractLastJson(text: string): any | null {
  const end = text.lastIndexOf("}");
  if (end === -1) return null;
  let depth = 0;
  for (let i = end; i >= 0; i--) {
    if (text[i] === "}") depth++;
    else if (text[i] === "{") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(i, end + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

export interface OnceResult { fullText: string; parsed: any | null; }

export async function investigateOnce(snapshotPath: string, corpusPath: string): Promise<OnceResult> {
  const client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 });
  const prompt = buildResolvedPrompt(snapshotPath, corpusPath);
  const msg = await client.messages
    .stream({ model: MODEL, max_tokens: MAX_TOKENS, messages: [{ role: "user", content: prompt }] })
    .finalMessage();
  const fullText = (msg.content as any[])
    .filter((b) => b.type === "text").map((b: any) => b.text).join("\n");
  return { fullText, parsed: extractLastJson(fullText) };
}
