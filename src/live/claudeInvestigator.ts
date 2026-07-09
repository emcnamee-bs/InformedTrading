import Anthropic from "@anthropic-ai/sdk";
import { LiveCandidate } from "./candidate";
import { Investigation, Investigator, Verdict } from "./investigator";

const DEFAULT_MODEL = "claude-opus-4-8";
const MAX_TOKENS = 2048;

/** Structured result an investigation runner must produce. */
export interface RunnerResult {
  verdict: Verdict;
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
    `- If you find a clear public catalyst, the verdict is EXPLAINED.`,
    `- If a thorough search turns up nothing that explains the move, the verdict is UNEXPLAINED.`,
    `- If the evidence is weak, partial, or you are genuinely uncertain, the verdict is AMBIGUOUS.`,
    ``,
    `After your reasoning and any searches, end your reply with a single JSON object on its own line, ` +
      `and nothing after it, in exactly this shape (no markdown fencing):`,
    `{"verdict":"EXPLAINED"|"UNEXPLAINED"|"AMBIGUOUS","rationale":"...","sources":["url", ...]}`,
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
 * Real Anthropic-backed runner: makes one `messages.create` call with the server-side web_search
 * tool enabled, then extracts the trailing structured verdict from the final text content.
 * Constructs the client lazily (only when actually invoked) so simply instantiating
 * `ClaudeInvestigator()` never requires ANTHROPIC_API_KEY or touches the network.
 */
export function makeDefaultRunner(model = process.env.CLAUDE_INVESTIGATOR_MODEL?.trim() || DEFAULT_MODEL): InvestigateRunner {
  return async (candidate: LiveCandidate): Promise<RunnerResult> => {
    const client = new Anthropic();
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      tools: [{ type: "web_search_20260209", name: "web_search" }],
      messages: [{ role: "user", content: buildPrompt(candidate) }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const parsed = extractLastJsonObject(text);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !isVerdict((parsed as Record<string, unknown>).verdict)
    ) {
      throw new Error("investigator response did not contain a valid structured verdict");
    }
    const obj = parsed as { verdict: Verdict; rationale?: unknown; sources?: unknown };
    return {
      verdict: obj.verdict,
      rationale: typeof obj.rationale === "string" ? obj.rationale : "",
      sources: Array.isArray(obj.sources) ? obj.sources.filter((s): s is string => typeof s === "string") : [],
    };
  };
}

/**
 * Claude-backed explain-away investigator. Judges whether a live-market anomaly has a public
 * explanation by delegating to an injectable `runner` (default: a real Anthropic SDK call with
 * server-side web search). Fails safe to AMBIGUOUS -- never UNEXPLAINED -- on any runner error or
 * malformed/unparseable output, since `keepUnexplained` (see ./investigator) only keeps
 * UNEXPLAINED verdicts for betting.
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
      rationale: typeof result.rationale === "string" ? result.rationale : "",
      sources: Array.isArray(result.sources) ? result.sources.filter((s): s is string => typeof s === "string") : [],
    };
  }
}
