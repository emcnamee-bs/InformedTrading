import Anthropic from "@anthropic-ai/sdk";
import { LiveCandidate } from "./candidate";
import { Investigation, Investigator, Verdict, PublicLean, EventStatus } from "./investigator";

const DEFAULT_MODEL = "claude-opus-4-8";
const MAX_TOKENS = 4096;

// Per-investigation wall-clock cap. A web_search call runs several server-side search
// rounds and can occasionally hang; without a bound, one stuck investigation freezes the
// entire market sweep (the SDK default timeout is 10 minutes). On timeout the SDK throws,
// which ClaudeInvestigator catches and fails safe to AMBIGUOUS -- so a timed-out candidate
// is skipped, never bet, and the sweep keeps moving.
const INVESTIGATOR_TIMEOUT_MS = 90_000;

/** Structured result an investigation runner must produce. */
export interface RunnerResult {
  verdict: Verdict;
  publicLean?: PublicLean;
  eventStatus?: EventStatus;
  rationale: string;
  sources: string[];
}

/**
 * Injectable investigation runner. The default (see `defaultRunner` below) makes a real
 * Anthropic API call with server-side web search enabled; tests inject a fake in its place so
 * they never touch the network or need ANTHROPIC_API_KEY.
 */
export type InvestigateRunner = (candidate: LiveCandidate) => Promise<RunnerResult>;

const FAIL_SAFE_PARSE_ERROR: Investigation = {
  verdict: "AMBIGUOUS",
  rationale: "could not parse investigator output",
  sources: [],
};

const FAIL_SAFE_RUNNER_ERROR: Investigation = {
  verdict: "AMBIGUOUS",
  rationale: "investigator error",
  sources: [],
};

function isVerdict(value: unknown): value is Verdict {
  return value === "EXPLAINED" || value === "UNEXPLAINED" || value === "AMBIGUOUS";
}

function isPublicLean(v: unknown): v is PublicLean {
  return v === "same" || v === "opposite" || v === "silent";
}
function isEventStatus(v: unknown): v is EventStatus {
  return v === "past" || v === "upcoming" || v === "unknown";
}

/**
 * Builds the user-turn prompt for a single candidate: the market/subject plus the fact that an
 * anomalous, statistically unusual price move was just detected, and asks the model to search
 * the public web for a plausible catalyst before rendering a verdict.
 */
export function buildPrompt(candidate: LiveCandidate): string {
  const m = candidate.market;
  return [
    `A live-market anomaly detector just flagged an unexplained, statistically anomalous price move ` +
      `in the Kalshi market "${m.marketTicker}" (series "${m.seriesTicker}", category "${m.category}").`,
    `Move direction: ${candidate.direction.toUpperCase()}. Current cost to enter: ${candidate.entryCents}c. ` +
      `Anomaly score (higher = more anomalous, not a probability): ${candidate.anomalyScore.toFixed(3)}.`,
    ``,
    `Search the public web/news for anything -- a news story, an official announcement, an economic ` +
      `data release, a regulatory filing, etc -- published recently that would plausibly explain a sudden ` +
      `price move in this market right now.`,
    ``,
    `Separate the FLAGGED signal from surrounding market activity. A public catalyst that explains the ` +
      `overall volume, or a price move in ONE direction, does NOT by itself explain a flagged position ` +
      `whose direction, one-sidedness, or timing runs OPPOSITE to -- or is simply unsupported by -- that ` +
      `public information. Judge whether the SPECIFIC flagged pattern (its direction and concentration), ` +
      `not merely the surrounding activity, is accounted for by public information.`,
    ``,
    `Assess it outcome by outcome, concentrating on the HIGHEST-CONVICTION outcomes (priced nearest ` +
      `certain). A public explanation for some outcomes does not offset the absence of one for the ` +
      `highest-conviction outcomes; if even one near-certain outcome has no specific public basis, the ` +
      `concentration is not fully accounted for.`,
    ``,
    `- EXPLAINED: a public catalyst specifically accounts for the flagged pattern (its direction included).`,
    `- UNEXPLAINED: nothing public accounts for the flagged pattern -- including cases where public info ` +
      `explains the volume but NOT the flagged direction/concentration.`,
    `- AMBIGUOUS: the evidence on the flagged pattern itself is genuinely weak/partial.`,
    ``,
    `Also report, separately from the verdict:`,
    `- "publicLean": "same" if public information points the SAME way as the flagged direction, ` +
      `"opposite" if public information points the OPPOSITE way (it makes the flagged side the less ` +
      `likely outcome), or "silent" if public information says nothing specific about the flagged direction.`,
    `- "eventStatus": "past" if the event this market resolves on has already occurred, "upcoming" ` +
      `if it has not yet occurred, or "unknown" if you cannot tell.`,
    ``,
    `After your reasoning and any searches, end your reply with a single JSON object on its own line, ` +
      `and nothing after it, in exactly this shape (no markdown fencing):`,
    `{"verdict":"EXPLAINED"|"UNEXPLAINED"|"AMBIGUOUS","publicLean":"same"|"opposite"|"silent","eventStatus":"past"|"upcoming"|"unknown","rationale":"...","sources":["url", ...]}`,
  ].join("\n");
}

/**
 * Extracts the last top-level JSON object appearing in `text` (the model is instructed to end
 * its reply with exactly one). Returns null if none is found or it doesn't parse.
 */
export function extractLastJsonObject(text: string): unknown | null {
  const lastOpen = text.lastIndexOf("{");
  const lastClose = text.lastIndexOf("}");
  if (lastOpen === -1 || lastClose === -1 || lastClose < lastOpen) return null;
  try {
    return JSON.parse(text.slice(lastOpen, lastClose + 1));
  } catch {
    return null;
  }
}

/**
 * Parse the model's trailing JSON into a RunnerResult. Throws if no valid verdict is present
 * (the caller fails safe to AMBIGUOUS). publicLean/eventStatus are optional: invalid/missing
 * values become undefined, which keepCandidate treats as not-followable.
 */
export function parseRunnerResult(text: string): RunnerResult {
  const parsed = extractLastJsonObject(text);
  if (!parsed || typeof parsed !== "object" || !isVerdict((parsed as Record<string, unknown>).verdict)) {
    throw new Error("investigator response did not contain a valid structured verdict");
  }
  const obj = parsed as {
    verdict: Verdict; publicLean?: unknown; eventStatus?: unknown; rationale?: unknown; sources?: unknown;
  };
  return {
    verdict: obj.verdict,
    publicLean: isPublicLean(obj.publicLean) ? obj.publicLean : undefined,
    eventStatus: isEventStatus(obj.eventStatus) ? obj.eventStatus : undefined,
    rationale: typeof obj.rationale === "string" ? obj.rationale : "",
    sources: Array.isArray(obj.sources) ? obj.sources.filter((s): s is string => typeof s === "string") : [],
  };
}

/**
 * Real Anthropic-backed runner: makes one `messages.create` call with the server-side web_search
 * tool enabled, then extracts the trailing structured verdict from the final text content.
 * Constructs the client lazily (only when actually invoked) so simply instantiating
 * `ClaudeInvestigator()` never requires ANTHROPIC_API_KEY or touches the network.
 */
export function makeDefaultRunner(model = process.env.CLAUDE_INVESTIGATOR_MODEL?.trim() || DEFAULT_MODEL): InvestigateRunner {
  return async (candidate: LiveCandidate): Promise<RunnerResult> => {
    // Bounded timeout so a slow/hung web_search can't freeze the sweep; streaming (per the
    // claude-api guidance for web_search / long calls) avoids non-streaming long-request pitfalls.
    const client = new Anthropic({ timeout: INVESTIGATOR_TIMEOUT_MS, maxRetries: 1 });
    const response = await client.messages
      .stream({
        model,
        max_tokens: MAX_TOKENS,
        tools: [{ type: "web_search_20260209", name: "web_search" }],
        messages: [{ role: "user", content: buildPrompt(candidate) }],
      })
      .finalMessage();

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    return parseRunnerResult(text);
  };
}

/**
 * Claude-backed explain-away investigator. Judges whether a live-market anomaly has a public
 * explanation by delegating to an injectable `runner` (default: a real Anthropic SDK call with
 * server-side web search). Fails safe to AMBIGUOUS -- never UNEXPLAINED -- on any runner error or
 * malformed/unparseable output, since `keepCandidate` (see ./investigator) only keeps
 * followable UNEXPLAINED verdicts for betting.
 */
export class ClaudeInvestigator implements Investigator {
  private readonly runner: InvestigateRunner;

  constructor(runner: InvestigateRunner = makeDefaultRunner()) {
    this.runner = runner;
  }

  async investigate(candidate: LiveCandidate): Promise<Investigation> {
    let result: RunnerResult;
    try {
      result = await this.runner(candidate);
    } catch {
      return FAIL_SAFE_RUNNER_ERROR;
    }

    if (!result || !isVerdict(result.verdict)) {
      return FAIL_SAFE_PARSE_ERROR;
    }

    return {
      verdict: result.verdict,
      publicLean: isPublicLean(result.publicLean) ? result.publicLean : undefined,
      eventStatus: isEventStatus(result.eventStatus) ? result.eventStatus : undefined,
      rationale: typeof result.rationale === "string" ? result.rationale : "",
      sources: Array.isArray(result.sources) ? result.sources.filter((s): s is string => typeof s === "string") : [],
    };
  }
}
