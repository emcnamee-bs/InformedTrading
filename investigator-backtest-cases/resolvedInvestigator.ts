// Adaptation of src/live/claudeInvestigator.ts for RESOLVED historical informed-betting CASES
// over CURATED PRE-CUTOFF DOSSIERS (web_search disabled). The prompt mirrors the original
// claudeInvestigator.buildPrompt as closely as possible — same general explain-away framing, same
// EXPLAINED/UNEXPLAINED/AMBIGUOUS definitions and {verdict,rationale,sources} shape — with only
// the minimal changes needed: the flagged anomaly comes from the case file, a temporal cutoff is
// imposed, and "review the provided public info" replaces "search the public web". No leading
// interpretation is added anywhere.
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MODEL = process.env.CLAUDE_INVESTIGATOR_MODEL?.trim() || "claude-opus-4-8";
const MAX_TOKENS = 4096;
const TIMEOUT_MS = 180_000;

export interface CaseSpec {
  name: string;
  cutoff_iso: string;
  anomaly: string;
  expected: string;
  notes?: string;
}

export function loadCase(caseDir: string): { spec: CaseSpec; dossier: string } {
  const spec = JSON.parse(readFileSync(join(caseDir, "case.json"), "utf-8")) as CaseSpec;
  const dossier = readFileSync(join(caseDir, "dossier.md"), "utf-8");
  return { spec, dossier };
}

// Mirrors the original investigator's framing/verdict semantics (src/live/claudeInvestigator.ts).
export function buildCasePrompt(caseDir: string): string {
  const { spec, dossier } = loadCase(caseDir);
  return [
    `A market-surveillance anomaly detector just flagged the following statistically anomalous`,
    `trading pattern on Kalshi (case: "${spec.name}"):`,
    ``,
    `  ${spec.anomaly}`,
    ``,
    `The moment under investigation is ${spec.cutoff_iso}. The market(s) involved had NOT resolved`,
    `at that moment.`,
    ``,
    `Review the public information available as of that moment (provided in the dossier below) for`,
    `anything -- a news story, an official announcement, a public statement, a scheduled event, an`,
    `economic or data release, public odds/betting coverage, etc. -- that would plausibly explain`,
    `this flagged pattern as ordinary trading on public information.`,
    ``,
    `Separate the FLAGGED signal from surrounding market activity. A public catalyst that explains the`,
    `overall volume, or a price move in ONE direction, does NOT by itself explain a flagged position`,
    `whose direction, one-sidedness, or timing runs OPPOSITE to -- or is simply unsupported by -- that`,
    `public information. Judge whether the SPECIFIC flagged pattern (its direction and concentration),`,
    `not merely the surrounding activity, is accounted for by public information.`,
    ``,
    `- If a public catalyst specifically accounts for the flagged pattern (its direction included), the verdict is EXPLAINED.`,
    `- If nothing public accounts for the flagged pattern -- including cases where public info explains the volume but not the flagged direction/concentration -- the verdict is UNEXPLAINED.`,
    `- If the evidence is weak, partial, or you are genuinely uncertain, the verdict is AMBIGUOUS.`,
    ``,
    `Constraint: reason ONLY from the dossier below plus general knowledge that was already true`,
    `before the cutoff. You have no web access and no knowledge of how the market(s) resolved or of`,
    `anything that happened after the cutoff; do not guess.`,
    ``,
    `================= BEGIN PRE-CUTOFF DOSSIER =================`,
    dossier,
    `================== END PRE-CUTOFF DOSSIER ==================`,
    ``,
    `Also report, separately from the verdict:`,
    `- "publicLean": "same" if public information points the SAME way as the flagged direction, ` +
      `"opposite" if public information points the OPPOSITE way (it makes the flagged side the less ` +
      `likely outcome), or "silent" if public information says nothing specific about the flagged direction.`,
    `- "eventStatus": "past" if the event this market resolves on has already occurred, "upcoming" ` +
      `if it has not yet occurred, or "unknown" if you cannot tell.`,
    ``,
    `After your reasoning, end your reply with a single JSON object on its own line, and nothing after`,
    `it, in exactly this shape (no markdown fencing):`,
    `{"verdict":"EXPLAINED"|"UNEXPLAINED"|"AMBIGUOUS","publicLean":"same"|"opposite"|"silent","eventStatus":"past"|"upcoming"|"unknown","rationale":"...","sources":["dossier section or fact you relied on", ...]}`,
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

export async function investigateCase(caseDir: string): Promise<OnceResult> {
  const client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 });
  const prompt = buildCasePrompt(caseDir);
  const msg = await client.messages
    .stream({ model: MODEL, max_tokens: MAX_TOKENS, messages: [{ role: "user", content: prompt }] })
    .finalMessage();
  const fullText = (msg.content as any[])
    .filter((b) => b.type === "text").map((b: any) => b.text).join("\n");
  return { fullText, parsed: extractLastJson(fullText) };
}
