# Investigator Upgrade + Hourly-Candle Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the validated investigator prompt/rubric upgrade to production (Track 1), then instrument the probe funnel and run hourly-candle detection on Culture/Mentions (Track 2).

**Architecture:** Track 1 is a prompt-only change to `src/live/claudeInvestigator.ts`, certified by re-running two dossier-based backtest harnesses before porting the language into production. Track 2 adds explicit funnel counters to `src/live/probe.ts` (distinguishing "too few candles to analyze" from "analyzed, no anomaly") plus a pure candle-stats helper, then executes a DRY-RUN hourly scan.

**Tech Stack:** TypeScript (Node ≥18), vitest, `tsx`, `@anthropic-ai/sdk` (streaming + `web_search_20260209`, `claude-opus-4-8`), Kalshi trade-api.

## Global Constraints

- Money safety is invariant: NO code path may place a real order without both `--live` AND `--confirm`. All runs in this plan are DRY-RUN. Do not touch order-placement code.
- Investigator prompt additions must be **verbatim** from the spec (which lifted them from `INVESTIGATOR_UPGRADE_CONTEXT.md` §2), transcribed in the codebase's ASCII style (`--` not `—`). Do NOT add leading/conclusory language ("this looks like insider", "no public basis exists") — it artificially inflates detection (handoff §3).
- `MAX_TOKENS` in `claudeInvestigator.ts` must be `4096`.
- Track 1 hard acceptance gate: **zero** false positives on the negative controls (no negative may flip to UNEXPLAINED). Sensitivity must reproduce; a material drop is investigated, not auto-accepted.
- `npx tsc --noEmit` must stay clean and all existing tests green (207 at plan start) after every code task.
- Stage ONLY the files each task names in its commit. Never `git add -A` (a prior session swept stray files into a commit). Never stage `Context Dump/`.
- Detection insufficient-history threshold is exactly `candles.length < windowSize + baselineSize` (matches `slidingWindows`, which yields a slice only when `candles.length >= windowSize + baselineSize`).

---

### Task 1: Housekeeping — gitignore `Context Dump/`, commit backtest assets

**Files:**
- Modify: `.gitignore`
- Commit (existing, untracked): `investigator-backtest/`, `investigator-backtest-cases/`, `INVESTIGATOR_UPGRADE_CONTEXT.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a clean working tree where `Context Dump/` is ignored and the Jul-10 evaluation assets are tracked (Task 2 runs those harnesses).

- [ ] **Step 1: Add `Context Dump/` to `.gitignore`**

Append this line to `.gitignore` (keep existing contents; the folder is 439 MB of reference PDFs that must never be committed):

```
Context Dump/
```

- [ ] **Step 2: Verify `Context Dump/` is now ignored and untracked**

Run: `git status --porcelain | grep -c "Context Dump"`
Expected: `0` (the folder no longer appears as untracked).

- [ ] **Step 3: Commit the gitignore change plus the backtest assets**

Stage explicitly (NOT `-A`), then commit:

```bash
git add .gitignore "investigator-backtest" "investigator-backtest-cases" INVESTIGATOR_UPGRADE_CONTEXT.md
git commit -m "chore: gitignore Context Dump/, track investigator backtest assets

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Verify the tree is clean of the target files**

Run: `git status --porcelain | grep -E "investigator-backtest|INVESTIGATOR_UPGRADE|Context Dump" | wc -l`
Expected: `0` (all tracked or ignored; nothing stray left).

---

### Task 2: Re-validate the rubric language on both harnesses (gate before porting)

This task runs the two dossier-based harnesses (web search DISABLED, so the model cannot peek at resolved outcomes) to confirm the validated rubric still discriminates with the current model **before** we port its language into production. It is a validation gate — no production code changes here.

**Files:**
- Run only: `investigator-backtest/runBacktest.ts`, `investigator-backtest-cases/runCases.ts`
- Reads: `ANTHROPIC_API_KEY` from the repo `.env` (also present in `~/Downloads/ClaudeSandbox/.env`).

**Interfaces:**
- Consumes: the tracked backtest assets from Task 1.
- Produces: a PASS/FAIL verdict against the hard acceptance gate, gating Task 3.

- [ ] **Step 1: Run the concentration + negative-control harness (10 runs/unit, N hardcoded)**

```bash
set -a; source .env; set +a
node_modules/.bin/tsx investigator-backtest/runBacktest.ts 2>&1 | tail -6
```
Expected final lines:
```
POSITIVE detection (UNEXPLAINED): 10/10 ...
NEGATIVE specificity (EXPLAINED): 10/10 ...
```

- [ ] **Step 2: Run the historical case suite (5 pos + 3 neg, 2 runs each)**

```bash
set -a; source .env; set +a
RUNS_PER_CASE=2 node_modules/.bin/tsx investigator-backtest-cases/runCases.ts 2>&1 | tail -12
```
Expected final lines:
```
Sensitivity (pos UNEXPLAINED): 10/10
Specificity (neg EXPLAINED): 6/6 | false-pos: 0/6
```

- [ ] **Step 3: Apply the hard acceptance gate**

- PASS requires: **false-pos = 0/6** (no negative flipped to UNEXPLAINED) AND no negative in Step 1 flipped (NEGATIVE specificity stays 10/10).
- Sensitivity should reproduce (pos 10/10 in both). If a positive shows minor stochastic wobble (e.g. 9/10), record it and proceed. If ANY negative flips to UNEXPLAINED, STOP — do not proceed to Task 3; report the drift to the human (the validated language no longer holds with the current model, which changes the whole premise).

- [ ] **Step 4: Record the result in the progress ledger**

Note the two harnesses' final counts in the run report / ledger (no commit — these are evidence, and the harnesses write their own `SUMMARY.md`/`runs/` which are already tracked).

---

### Task 3: Apply the validated prompt language + `MAX_TOKENS` to production

**Files:**
- Modify: `src/live/claudeInvestigator.ts` (`MAX_TOKENS` at line 6; `buildPrompt` at lines 50-70)
- Test: `tests/live/claudeInvestigator.test.ts`

**Interfaces:**
- Consumes: the PASS gate from Task 2.
- Produces: production `buildPrompt` carrying the validated rubric (asserted by the new unit test); `MAX_TOKENS === 4096`. `buildPrompt(candidate: LiveCandidate): string` signature is unchanged.

- [ ] **Step 1: Write the failing unit tests for the new rubric language**

Add to `tests/live/claudeInvestigator.test.ts`. First extend the existing import:

```typescript
import { ClaudeInvestigator, buildPrompt } from "../../src/live/claudeInvestigator";
```

Then append this describe block:

```typescript
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
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run tests/live/claudeInvestigator.test.ts`
Expected: FAIL — the three new assertions fail (`toContain` not satisfied by the current prompt).

- [ ] **Step 3: Bump `MAX_TOKENS` to 4096**

In `src/live/claudeInvestigator.ts`, change line 6:

```typescript
const MAX_TOKENS = 4096;
```

- [ ] **Step 4: Replace `buildPrompt` with the validated-rubric version**

Replace the entire `buildPrompt` function body's returned array (lines 50-70) so the function reads exactly:

```typescript
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
    `After your reasoning and any searches, end your reply with a single JSON object on its own line, ` +
      `and nothing after it, in exactly this shape (no markdown fencing):`,
    `{"verdict":"EXPLAINED"|"UNEXPLAINED"|"AMBIGUOUS","rationale":"...","sources":["url", ...]}`,
  ].join("\n");
}
```

- [ ] **Step 5: Run the investigator tests + full suite + typecheck**

Run: `npx vitest run tests/live/claudeInvestigator.test.ts && npx vitest run && npx tsc --noEmit`
Expected: investigator file PASS (8 tests → now more); full suite green; `tsc` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add src/live/claudeInvestigator.ts tests/live/claudeInvestigator.test.ts
git commit -m "feat(investigator): apply validated rubric upgrade + MAX_TOKENS 4096

Ports the 2026-07-10-validated prompt changes into production buildPrompt:
separate-flagged-signal + per-outcome/highest-conviction + direction-aware
verdict definitions. Fixes the over-caution that returned AMBIGUOUS on genuine
informed patterns (silently dropped by keepUnexplained). Re-validated on both
backtest harnesses (0 false positives) before porting. Sibling-outcome DATA that
activates the per-outcome rubric is deferred to Track B.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Funnel instrumentation — `insufficientHistory` counter + candle stats

**Files:**
- Modify: `src/live/probe.ts` (funnel counters at lines 118-127; loop at 132-167; summary/funnel output at 169-178)
- Test: `tests/live/probe.test.ts`

**Interfaces:**
- Consumes: existing `planProbe(deps, opts)`, `windowSize`/`baselineSize` locals (`opts.windowSize ?? 3`, `opts.baselineSize ?? 5`).
- Produces: exported `candleStats(counts: number[]): { min: number; median: number; max: number }`; a new funnel line distinguishing `errors`, `insufficientHistory`, and `analyzed`, plus a `candles/market: min/median/max` line.

- [ ] **Step 1: Write the failing test for `candleStats`**

Add to `tests/live/probe.test.ts`. Extend the import to include `candleStats`:

```typescript
import {
  sizeOrder,
  planProbe,
  executeProbe,
  ProbeDeps,
  ProbeOpts,
  ProbeCandidate,
  OrderClient,
  candleStats,
} from "../../src/live/probe";
```

Then add:

```typescript
describe("candleStats", () => {
  it("returns zeros for an empty array", () => {
    expect(candleStats([])).toEqual({ min: 0, median: 0, max: 0 });
  });
  it("computes min/median/max for an odd-length array", () => {
    expect(candleStats([5, 1, 9])).toEqual({ min: 1, median: 5, max: 9 });
  });
  it("computes a rounded median for an even-length array", () => {
    expect(candleStats([1, 2, 3, 10])).toEqual({ min: 1, median: 3, max: 10 });
  });
});
```

- [ ] **Step 2: Write the failing test for the `insufficientHistory` counter**

Add to `tests/live/probe.test.ts` (uses existing `makeMarket`, `buildSurgeData`, `candle`, `makeDeps`, `alwaysUnexplained`, `baseOpts` — note `baseOpts` has no window/baseline, so the threshold is the defaults `3 + 5 = 8`):

```typescript
describe("planProbe funnel instrumentation", () => {
  it("counts a too-few-candles market as insufficientHistory, not a silent skip", async () => {
    const markets = [makeMarket("ENOUGH"), makeMarket("TOOFEW")];
    const data = new Map([
      ["ENOUGH", buildSurgeData("ENOUGH", 0.9)], // 11 candles >= 8 -> analyzed
      ["TOOFEW", { candles: Array.from({ length: 4 }, (_, i) => candle(i, 50, 5, 100)), trades: [] }], // 4 < 8
    ]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await planProbe(makeDeps(markets, data, alwaysUnexplained()), baseOpts);
    const funnel = spy.mock.calls.map((c) => c.join(" ")).find((s) => s.includes("Funnel:")) ?? "";
    spy.mockRestore();
    expect(funnel).toContain("universe=2");
    expect(funnel).toContain("insufficientHistory=1");
    expect(funnel).toContain("analyzed=1");
  });
});
```

- [ ] **Step 3: Run both new tests to verify they fail**

Run: `npx vitest run tests/live/probe.test.ts`
Expected: FAIL — `candleStats` is not exported (import error / undefined), and the funnel string does not yet contain `universe=`/`insufficientHistory=`/`analyzed=`.

- [ ] **Step 4: Add the `candleStats` helper**

In `src/live/probe.ts`, add this exported function near the other top-level helpers (e.g. just above `export interface ProbeDeps`):

```typescript
/** min / median / max of a numeric array; zeros for an empty array. Median rounded to an int. */
export function candleStats(counts: number[]): { min: number; median: number; max: number } {
  if (counts.length === 0) return { min: 0, median: 0, max: 0 };
  const sorted = [...counts].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
  return { min: sorted[0]!, median, max: sorted[sorted.length - 1]! };
}
```

- [ ] **Step 5: Rename `skipped`→`errors` and add the new counters**

In `src/live/probe.ts`, change the counter declaration at line 119 from:

```typescript
  let skipped = 0;
```
to:
```typescript
  let errors = 0;
  let insufficientHistory = 0;
  const candleCounts: number[] = [];
```

- [ ] **Step 6: Count candle sufficiency inside the loop**

In the `try` block, immediately after the `const [candles, trades] = await Promise.all([...]);` (line 136-139) and before `const candidate = detectCandidate(...)` (line 141), insert:

```typescript
      candleCounts.push(candles.length);
      if (candles.length < windowSize + baselineSize) {
        insufficientHistory++;
        continue;
      }
```

Then in the `catch` block (line 162-165), change `skipped++;` to `errors++;` (leave the `console.error("skip ...")` message as-is).

- [ ] **Step 7: Update the summary + funnel output**

Replace lines 169-178 inclusive (the `Probe scan summary` line through the funnel `console.error`, which spans the existing `kept.sort`/`maxBets`/`top` lines) with the following single block:

```typescript
  const analyzed = markets.length - errors - insufficientHistory;
  console.error(
    `Probe scan summary: ${analyzed} analyzed, ${insufficientHistory} insufficient-history, ${errors} errors (of ${markets.length} total)`,
  );

  kept.sort((a, b) => b.candidate.anomalyScore - a.candidate.anomalyScore);
  const maxBets = Math.min(opts.maxBets ?? HARD_MAX_ORDERS, HARD_MAX_ORDERS);
  const top = kept.slice(0, maxBets);

  const stats = candleStats(candleCounts);
  console.error(
    `Funnel: universe=${markets.length} | errors=${errors} insufficientHistory=${insufficientHistory} analyzed=${analyzed} | ` +
      `anomalies=${anomaliesDetected} viable=${viableCount} investigated=${investigatedCount} | ` +
      `verdicts EXPLAINED=${verdictCounts.EXPLAINED} UNEXPLAINED=${verdictCounts.UNEXPLAINED} AMBIGUOUS=${verdictCounts.AMBIGUOUS} | kept=${top.length}`,
  );
  console.error(`candles/market: min=${stats.min} median=${stats.median} max=${stats.max}`);
```

Note: the `kept.sort`/`maxBets`/`top` lines are already inside the replaced 169-178 range and are reproduced in the block above (so `top.length` is available for the funnel line) — there is no separate copy to delete. Leave the `viabilityRejectReasons` breakdown block (lines 179+) that follows unchanged.

- [ ] **Step 8: Run the probe tests + full suite + typecheck**

Run: `npx vitest run tests/live/probe.test.ts && npx vitest run && npx tsc --noEmit`
Expected: probe tests PASS (incl. the 2 new describes); full suite green; `tsc` clean.

- [ ] **Step 9: Commit**

```bash
git add src/live/probe.ts tests/live/probe.test.ts
git commit -m "feat(probe): funnel instrumentation — insufficientHistory + candle stats

Splits the old silent 'scanned - anomalies' into universe / errors /
insufficientHistory / analyzed, and reports candles-per-market min/median/max.
Closes the blind spot where a too-few-candles market (detectCandidate -> null)
was indistinguishable from analyzed-but-no-anomaly. Adds candleStats() helper.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Run the hourly Culture/Mentions dry-run and report

**Files:**
- Run only: `src/live/cli.ts` via `npm run probe` (DRY-RUN — no order placement).

**Interfaces:**
- Consumes: the instrumented `planProbe` (Task 4) and the upgraded investigator (Task 3).
- Produces: a funnel report (coverage + any candidates) for review — the payoff run and the basis for tuning window/baseline.

- [ ] **Step 1: Launch the hourly scan (DRY-RUN)**

```bash
set -a; source .env; set +a
REQUESTS_PER_SECOND=3 npm run probe -- \
  --section culture,mentions --min-volume 100 --max-markets 1000 \
  --period 60 --window 3 --baseline 6 \
  --min-return 5 --horizon-days 31 --max-bets 10
```
This places NO orders (no `--live --confirm`). Expect a multi-minute run.

- [ ] **Step 2: Read and report the funnel**

Confirm the run printed the new funnel shape, e.g.:
```
Funnel: universe=.. | errors=.. insufficientHistory=.. analyzed=.. | anomalies=.. viable=.. investigated=.. | verdicts ... | kept=..
candles/market: min=.. median=.. max=..
```
Report to the human: how many markets were analyzable vs `insufficientHistory` (the coverage answer), the candle min/median/max, the anomaly/viable/investigated counts, verdict split, and any kept candidates. Do NOT place orders.

- [ ] **Step 3: Recommend the next window/baseline (no code change)**

Based on `insufficientHistory` vs `analyzed` and the candle median: if `insufficientHistory` dominates, note that a smaller window/baseline or the deferred adaptive-resolution track is warranted; if coverage is healthy but `anomalies=0`, note the detector ran and found nothing (a real signal, not a data gap). This closes the plan; deeper tuning or Track B is a separate cycle.

---

## Notes for the executor
- Tasks 2 and 5 are validation/execution gates, not TDD code tasks — their "test" is the harness/scan output matching the stated expected lines.
- Track B (feed sibling-outcome data so the per-outcome rubric activates) is explicitly OUT OF SCOPE here; do not begin it.
