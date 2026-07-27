# Candidate-Quality Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the pipeline keeping bets that aren't worth making — markets whose event already happened (past-event pre-filter) and flags that contradict a near-certain public outcome (investigator `publicLean`).

**Architecture:** A cheap structural pre-filter parses the `YYMONDD` event date from the ticker and skips past-event markets before any API call. The investigator gains two additive, OPTIONAL output fields (`publicLean`, `eventStatus`) while its validated verdict rubric stays byte-for-byte unchanged; a new `keepCandidate` policy keeps only `UNEXPLAINED && publicLean==="silent" && eventStatus!=="past"`.

**Tech Stack:** TypeScript (Node ≥18), vitest, `tsx`, `@anthropic-ai/sdk` (streaming + `web_search_20260209`, `claude-opus-4-8`).

## Global Constraints

- Money safety invariant: NO code path may place a real order without both `--live` AND `--confirm`. All runs here are DRY-RUN. Do not touch order-placement code.
- The validated investigator verdict rubric text (the "Separate the FLAGGED signal…", "Assess it outcome by outcome…", and the three EXPLAINED/UNEXPLAINED/AMBIGUOUS definition lines) must NOT change. The new fields are strictly additive. No leading/conclusory language.
- `publicLean`/`eventStatus` are OPTIONAL on `Investigation` (`?`), so missing values are the safe default (not keepable / unknown).
- `npx tsc --noEmit` stays clean and all existing tests green after every code task.
- Stage ONLY the files each task names. Never `git add -A`.
- Past-event threshold: skip only when the parsed event date is STRICTLY before today's UTC date. Same-day, future, or unparseable → keep.

---

### Task 1: `eventDate.ts` — parse ticker event date + `isEventPast`

**Files:**
- Create: `src/live/eventDate.ts`
- Test: `tests/live/eventDate.test.ts`

**Interfaces:**
- Produces: `parseEventDate(ticker: string): Date | null` and `isEventPast(ticker: string, nowTs: number): boolean` (nowTs is unix SECONDS, matching `deps.nowTs`).

- [ ] **Step 1: Write the failing tests**

Create `tests/live/eventDate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseEventDate, isEventPast } from "../../src/live/eventDate";

// Fixed "today" = 2026-07-18 12:00 UTC, expressed in unix seconds.
const NOW = Math.floor(Date.UTC(2026, 6, 18, 12, 0, 0) / 1000);

describe("parseEventDate", () => {
  it("parses the YYMONDD code from a mention ticker", () => {
    expect(parseEventDate("KXWORLDNEWSMENTION-26JUL16-IRAN")?.getTime()).toBe(Date.UTC(2026, 6, 16));
  });
  it("returns null when there is no date code", () => {
    expect(parseEventDate("KXNOCODEHERE-FOO")).toBeNull();
  });
  it("returns null for an invalid month token", () => {
    expect(parseEventDate("KXX-26XYZ16-A")).toBeNull();
  });
});

describe("isEventPast", () => {
  it("is true when the event date is strictly before today (UTC)", () => {
    expect(isEventPast("KXWORLDNEWSMENTION-26JUL16-IRAN", NOW)).toBe(true);
  });
  it("is false for a same-day event", () => {
    expect(isEventPast("KXAOCMENTION-26JUL18-AFFO", NOW)).toBe(false);
  });
  it("is false for a future event", () => {
    expect(isEventPast("KXMLBMENTION-26JUL20STLLAA-WILD", NOW)).toBe(false);
  });
  it("is false when the ticker has no parseable date (investigator backstops it)", () => {
    expect(isEventPast("KXNOCODEHERE-FOO", NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/live/eventDate.test.ts`
Expected: FAIL — module `../../src/live/eventDate` not found.

- [ ] **Step 3: Implement `src/live/eventDate.ts`**

```typescript
const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/**
 * Parse the YYMONDD event-date code embedded in a Kalshi mention/event ticker
 * (e.g. "KXWORLDNEWSMENTION-26JUL16-IRAN" -> 2026-07-16 UTC). Kalshi's structured date fields
 * (close_time/expiration/occurrence) reflect the settlement window, NOT the event, so the ticker
 * code is the only reliable event-date signal. Returns null when no parseable code is present.
 * Assumes 20YY.
 */
export function parseEventDate(ticker: string): Date | null {
  const m = /-(\d{2})([A-Z]{3})(\d{2})/.exec(ticker);
  if (!m) return null;
  const month = MONTHS[m[2]!];
  if (month === undefined) return null;
  return new Date(Date.UTC(2000 + Number(m[1]), month, Number(m[3])));
}

/**
 * True only when the ticker's event date is STRICTLY before today's UTC date. Same-day (the event
 * may still be later today), future, or unparseable tickers return false (keep; the investigator
 * `eventStatus` field is the backstop for unparseable past events). `nowTs` is unix seconds.
 */
export function isEventPast(ticker: string, nowTs: number): boolean {
  const eventDate = parseEventDate(ticker);
  if (!eventDate) return false;
  const now = new Date(nowTs * 1000);
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return eventDate.getTime() < todayUTC;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/live/eventDate.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/live/eventDate.ts tests/live/eventDate.test.ts
git commit -m "feat(live): parse ticker event date + isEventPast past-event filter"
```

---

### Task 2: Investigator types + `keepCandidate`

**Files:**
- Modify: `src/live/investigator.ts`
- Test: `tests/live/investigator.test.ts`

**Interfaces:**
- Produces: `PublicLean = "same"|"opposite"|"silent"`, `EventStatus = "past"|"upcoming"|"unknown"`; `Investigation` gains optional `publicLean?: PublicLean` and `eventStatus?: EventStatus`; `keepCandidate(inv: Investigation): boolean`.
- Note: `keepUnexplained` STAYS for now (probe.ts still imports it until Task 4).

- [ ] **Step 1: Write the failing tests**

Check whether `tests/live/investigator.test.ts` exists; if not, create it with this import header, else append the describe block. Header:

```typescript
import { describe, it, expect } from "vitest";
import { keepCandidate, Investigation } from "../../src/live/investigator";
```

Add:

```typescript
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/live/investigator.test.ts`
Expected: FAIL — `keepCandidate` not exported.

- [ ] **Step 3: Implement the types + `keepCandidate`**

Replace the contents of `src/live/investigator.ts` with:

```typescript
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/live/investigator.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean (existing `keepUnexplained` users unaffected; new fields are optional).

- [ ] **Step 5: Commit**

```bash
git add src/live/investigator.ts tests/live/investigator.test.ts
git commit -m "feat(investigator): add publicLean/eventStatus + keepCandidate policy"
```

---

### Task 3: Claude investigator — additive prompt + field parsing

**Files:**
- Modify: `src/live/claudeInvestigator.ts`
- Test: `tests/live/claudeInvestigator.test.ts`

**Interfaces:**
- Consumes: `PublicLean`, `EventStatus`, `Investigation` from Task 2.
- Produces: exported `parseRunnerResult(text: string): RunnerResult` (throws on missing/invalid verdict); `RunnerResult` gains optional `publicLean?`/`eventStatus?`; `buildPrompt` asks for the two fields; `ClaudeInvestigator.investigate` passes them through.

- [ ] **Step 1: Write the failing tests**

Append to `tests/live/claudeInvestigator.test.ts` (extend the existing import to add `parseRunnerResult`; it already imports `buildPrompt`):

```typescript
import { buildPrompt, parseRunnerResult } from "../../src/live/claudeInvestigator";

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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/live/claudeInvestigator.test.ts`
Expected: FAIL — `parseRunnerResult` not exported; buildPrompt lacks the field asks.

- [ ] **Step 3: Update the import and `RunnerResult`**

In `src/live/claudeInvestigator.ts`, extend the type import at the top:

```typescript
import { Investigation, Investigator, Verdict, PublicLean, EventStatus } from "./investigator";
```

Extend the `RunnerResult` interface to add the two optional fields:

```typescript
export interface RunnerResult {
  verdict: Verdict;
  publicLean?: PublicLean;
  eventStatus?: EventStatus;
  rationale: string;
  sources: string[];
}
```

- [ ] **Step 4: Add the additive prompt instruction + JSON shape**

In `buildPrompt`, replace the tail of the returned array — from the `AMBIGUOUS` definition line through the JSON-shape line (currently lines 76-80) — with:

```typescript
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
```

- [ ] **Step 5: Add type guards + extract `parseRunnerResult`**

Add these two guards next to the existing `isVerdict` function:

```typescript
function isPublicLean(v: unknown): v is PublicLean {
  return v === "same" || v === "opposite" || v === "silent";
}
function isEventStatus(v: unknown): v is EventStatus {
  return v === "past" || v === "upcoming" || v === "unknown";
}
```

Add an exported `parseRunnerResult` (place it just after `extractLastJsonObject`):

```typescript
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
```

- [ ] **Step 6: Use `parseRunnerResult` in the runner and pass fields through**

In `makeDefaultRunner`, replace the block from `const parsed = extractLastJsonObject(text);` through the `return { verdict, rationale, sources };` (currently lines 124-137) with:

```typescript
    return parseRunnerResult(text);
```

In `ClaudeInvestigator.investigate`, replace the success `return { ... }` (currently lines 167-171) with one that carries the new fields:

```typescript
    return {
      verdict: result.verdict,
      publicLean: result.publicLean,
      eventStatus: result.eventStatus,
      rationale: typeof result.rationale === "string" ? result.rationale : "",
      sources: Array.isArray(result.sources) ? result.sources.filter((s): s is string => typeof s === "string") : [],
    };
```

Leave the two `FAIL_SAFE_*` constants unchanged — they are AMBIGUOUS and omit the optional fields, which is the correct not-followable default.

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run tests/live/claudeInvestigator.test.ts && npx tsc --noEmit`
Expected: PASS (new + existing tests); tsc clean.

- [ ] **Step 8: Commit**

```bash
git add src/live/claudeInvestigator.ts tests/live/claudeInvestigator.test.ts
git commit -m "feat(investigator): emit + parse publicLean/eventStatus (additive, rubric unchanged)"
```

---

### Task 4: Wire the filters into `probe.ts`

**Files:**
- Modify: `src/live/probe.ts`, `src/live/investigator.ts` (remove now-unused `keepUnexplained`)
- Test: `tests/live/probe.test.ts`, `tests/live/investigator.test.ts` (drop the `keepUnexplained` test if present)

**Interfaces:**
- Consumes: `isEventPast` (Task 1), `keepCandidate` (Task 2), investigator fields (Task 3).

- [ ] **Step 1: Write the failing tests**

In `tests/live/probe.test.ts`, first make the existing fake investigators followable under the new policy — update `alwaysUnexplained` (and any other fake that returns `UNEXPLAINED` expecting a keep) to include the fields. Change its returned object to:

```typescript
      return { verdict: "UNEXPLAINED", publicLean: "silent", eventStatus: "upcoming", rationale: `unexplained: ${c.market.marketTicker}`, sources: ["src"] };
```

Then add:

```typescript
describe("planProbe candidate-quality filters", () => {
  it("skips a past-event market before fetching candles and counts it as pastEvent", async () => {
    // ticker date 26JAN01 is strictly before NOW_TS's date, so it must be skipped.
    const past = makeMarket("KXX-26JAN01-A");
    let fetched = false;
    const deps: ProbeDeps = {
      listOpenMarkets: async () => [past],
      getCandles: async () => { fetched = true; return []; },
      getTrades: async () => { fetched = true; return []; },
      investigator: alwaysUnexplained(),
      nowTs: NOW_TS,
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const plan = await planProbe(deps, baseOpts);
    const funnel = spy.mock.calls.map((c) => c.join(" ")).find((s) => s.includes("Funnel:")) ?? "";
    spy.mockRestore();
    expect(fetched).toBe(false);
    expect(plan).toHaveLength(0);
    expect(funnel).toContain("pastEvent=1");
  });

  it("drops an UNEXPLAINED candidate whose public info leans opposite", async () => {
    // NOW_TS (1_800_000_000) is ~Jan 2027, so use a clearly-future date so the pre-filter keeps it.
    const markets = [makeMarket("KXX-27DEC31-A")];
    const data = new Map([["KXX-27DEC31-A", buildSurgeData("KXX-27DEC31-A", 1.0)]]);
    const opposite: Investigator = {
      async investigate(c) {
        return { verdict: "UNEXPLAINED", publicLean: "opposite", eventStatus: "upcoming", rationale: "", sources: [] };
      },
    };
    const plan = await planProbe(makeDeps(markets, data, opposite), baseOpts);
    expect(plan).toHaveLength(0);
  });
});
```

(Note: `makeMarket`/`baseOpts`/`NOW_TS` already exist in this file; `Investigator` is already imported.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/live/probe.test.ts`
Expected: FAIL — no `pastEvent` in the funnel; the opposite-lean candidate is still kept (probe still uses `keepUnexplained`).

- [ ] **Step 3: Update imports in `probe.ts`**

Change the investigator import (line 4) to drop `keepUnexplained` and add `keepCandidate`, and add the eventDate import:

```typescript
import { Investigator, Investigation, Verdict, keepCandidate } from "./investigator";
import { isEventPast } from "./eventDate";
```

- [ ] **Step 4: Add the `pastEvent` counter**

Next to `let errors = 0;` (line 129), add:

```typescript
  let pastEvent = 0;
```

- [ ] **Step 5: Add the past-event pre-filter at the top of the loop**

Change the loop opening (line 144) from `for (const market of markets) {` / `try {` to insert the pre-filter BEFORE the `try`:

```typescript
  for (const market of markets) {
    if (isEventPast(market.marketTicker, deps.nowTs)) {
      pastEvent++;
      continue;
    }
    try {
```

- [ ] **Step 6: Swap the keep policy**

Change line 177 from `if (!keepUnexplained(investigation)) continue;` to:

```typescript
      if (!keepCandidate(investigation)) continue;
```

- [ ] **Step 7: Update the funnel accounting + output**

Change the `analyzed` line (187) to subtract `pastEvent`:

```typescript
  const analyzed = markets.length - pastEvent - errors - insufficientHistory;
```

Change the summary `console.error` (188-190) to:

```typescript
  console.error(
    `Probe scan summary: ${analyzed} analyzed, ${pastEvent} past-event, ${insufficientHistory} insufficient-history, ${errors} errors (of ${markets.length} total)`,
  );
```

Change the Funnel `console.error` (197-201) so the first group includes `pastEvent`:

```typescript
  console.error(
    `Funnel: universe=${markets.length} | pastEvent=${pastEvent} errors=${errors} insufficientHistory=${insufficientHistory} analyzed=${analyzed} | ` +
      `anomalies=${anomaliesDetected} viable=${viableCount} investigated=${investigatedCount} | ` +
      `verdicts EXPLAINED=${verdictCounts.EXPLAINED} UNEXPLAINED=${verdictCounts.UNEXPLAINED} AMBIGUOUS=${verdictCounts.AMBIGUOUS} | kept=${top.length}`,
  );
```

- [ ] **Step 8: Remove the now-unused `keepUnexplained`**

In `src/live/investigator.ts`, delete the `keepUnexplained` function and its doc comment (nothing imports it after Step 3). In `tests/live/investigator.test.ts`, delete any `keepUnexplained` test if one exists.

- [ ] **Step 9: Run tests + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green; `tsc` clean. Confirm no remaining `keepUnexplained` reference: `grep -rn keepUnexplained src tests` returns nothing.

- [ ] **Step 10: Commit**

```bash
git add src/live/probe.ts src/live/investigator.ts tests/live/probe.test.ts tests/live/investigator.test.ts
git commit -m "feat(probe): past-event pre-filter + keepCandidate + pastEvent funnel bucket"
```

---

### Task 5: Re-validate the investigator on both backtest harnesses

Mirror the additive `publicLean`/`eventStatus` instruction into both harness prompts (so the harnesses exercise the same field-asking as production), then re-run both and confirm the added instruction did not drift the verdicts. Validation gate — real Anthropic calls.

**Files:**
- Modify: `investigator-backtest/resolvedInvestigator.ts`, `investigator-backtest-cases/resolvedInvestigator.ts` (add the same two-field ask + JSON shape used in Task 3; their result parsing reads only `verdict`, so extra fields are ignored)
- Run: `investigator-backtest/runBacktest.ts`, `investigator-backtest-cases/runCases.ts`

**Interfaces:**
- Consumes: the production prompt wording from Task 3 (mirror it).
- Produces: a PASS/FAIL gate for the whole change.

- [ ] **Step 1: Mirror the additive instruction into both harness prompts**

In each `resolvedInvestigator.ts`, locate the prompt's verdict-definition/JSON tail and insert the same `"publicLean"`/`"eventStatus"` instruction lines and updated JSON shape from Task 3, Step 4 — WITHOUT altering any existing verdict-rubric wording. Do not change their result parsing (it reads `verdict` only).

- [ ] **Step 2: Run the concentration + negative-control harness**

```bash
set -a; source .env; set +a
node_modules/.bin/tsx investigator-backtest/runBacktest.ts 2>&1 | tail -4
```
Expected: `POSITIVE detection (UNEXPLAINED): 10/10` and `NEGATIVE specificity (EXPLAINED): 10/10`.

- [ ] **Step 3: Run the historical case suite**

```bash
set -a; source .env; set +a
RUNS_PER_CASE=2 node_modules/.bin/tsx investigator-backtest-cases/runCases.ts 2>&1 | tail -4
```
Expected: `Sensitivity (pos UNEXPLAINED): 10/10` and `Specificity (neg EXPLAINED): 6/6 | false-pos: 0/6`.

- [ ] **Step 4: Apply the hard gate**

PASS requires false-pos = 0/6 AND negative specificity 10/10 in Step 2 (no negative flipped to UNEXPLAINED). Sensitivity should reproduce; a minor positive wobble is recorded, not blocking. If ANY negative flips to UNEXPLAINED, STOP — the added instruction drifted the verdict; report to the human before proceeding.

- [ ] **Step 5: Commit the mirrored harness prompts**

```bash
git add investigator-backtest/resolvedInvestigator.ts investigator-backtest-cases/resolvedInvestigator.ts
git commit -m "test(investigator): mirror publicLean/eventStatus ask into backtest harnesses; verdicts hold (0 false-pos)"
```

---

### Task 6: Re-run the hourly Culture/Mentions dry-run

**Files:**
- Run only: `src/live/cli.ts` via `npm run probe` (DRY-RUN — no order placement).

**Interfaces:**
- Consumes: everything above.
- Produces: a funnel report proving the filters work; no commit.

- [ ] **Step 1: Launch the scan (DRY-RUN)**

```bash
set -a; source .env; set +a
REQUESTS_PER_SECOND=3 npm run probe -- \
  --section culture,mentions --min-volume 100 --max-markets 1000 \
  --period 60 --window 3 --baseline 6 \
  --min-return 5 --horizon-days 31 --max-bets 10
```
Places NO orders. Expect a multi-minute run.

- [ ] **Step 2: Read and report the funnel**

Confirm the funnel now shows `pastEvent=N` and report every count (`universe / pastEvent / errors / insufficientHistory / analyzed / anomalies / viable / investigated / verdicts / kept`) plus each kept candidate. Sanity checks: markets whose event date is strictly past are counted under `pastEvent`; any investigated candidate whose flagged direction contradicts a near-certain public outcome shows `publicLean:"opposite"` in the dry-run detail and is NOT kept. Report the surviving candidate set to the human. Do NOT place orders.

---

## Notes for the executor
- Tasks 5 and 6 are validation/execution gates (real API calls), not TDD code tasks — their "test" is the harness/scan output matching the stated expected lines.
- Track B (sibling-outcome / concentration awareness) and the idiosyncratic-random-word ("Dolphins") noise case remain OUT OF SCOPE.
