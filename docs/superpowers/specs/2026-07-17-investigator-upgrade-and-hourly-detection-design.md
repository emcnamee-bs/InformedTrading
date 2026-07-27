# Investigator Upgrade + Hourly-Candle Detection — Design

**Date:** 2026-07-17
**Status:** Approved (brainstorming) → ready for implementation plan

Two complementary tracks, executed in order. Track 1 fixes *verdict quality* (why real
candidates were being silently discarded as AMBIGUOUS); Track 2 fixes *detection reach* (why
so few anomalies were found at all). A third track (B) is explicitly deferred.

---

## Background / motivation

Live dry-runs consistently found ~0–1 anomalies per 1,000 markets, and the anomalies that were
found died at the investigator (e.g. a 500-market scan's one anomaly → AMBIGUOUS → discarded).
Two independent root causes were established:

1. **Investigator over-caution.** A 2026-07-10 evaluation (`INVESTIGATOR_UPGRADE_CONTEXT.md`,
   `investigator-backtest/`, `investigator-backtest-cases/`) proved the investigator returns
   AMBIGUOUS on genuine informed-betting patterns whose prose reasoning was already correct — the
   verdict threshold, not the analysis, was the gap. Two prompt/rubric changes fixed this with
   **zero** new false positives on negative controls. The changes were designed and validated but
   **never applied to production** (`src/live/claudeInvestigator.ts` still has the old prompt).

2. **Detection-resolution mismatch.** Almost all open Kalshi markets are very young (~0.4–0.5 days
   when sampled) because Kalshi constantly rotates in fresh event markets. Daily candles are
   therefore useless (~1 candle/market) and the 1-min window was too sparse for thin markets. The
   fit for a young-but-active market is **hourly** candles with a small window — you measure a
   young market's anomaly in *hours*, not days.

`keepUnexplained()` keeps ONLY `UNEXPLAINED` verdicts for trading, so the AMBIGUOUS↔UNEXPLAINED
boundary is decision-critical: an over-cautious AMBIGUOUS silently loses a real signal.

---

## Track 1 — Apply the validated investigator upgrade (prompt-only)

### Scope decision: A1
Ship the **full validated prompt language** (both rubric changes) to production now, plus the
token bump. Only the *sibling-outcome data* that makes the per-outcome rubric actionable is
deferred (that is Track B). Rationale: production's prompt then equals the wording the backtests
actually proved, so re-validation is apples-to-apples; the per-outcome sentence is benign on a
single live market ("assess this one outcome").

### Changes — `src/live/claudeInvestigator.ts`
1. **`MAX_TOKENS` 2048 → 4096.** Truncated replies currently fail JSON parse → fail-safe
   AMBIGUOUS; 4096 was the validated harness value.
2. **Add to `buildPrompt`, the "separate flagged signal" paragraph** (verbatim, handoff §2):
   > Separate the FLAGGED signal from surrounding market activity. A public catalyst that explains
   > the overall volume, or a price move in ONE direction, does NOT by itself explain a flagged
   > position whose direction, one-sidedness, or timing runs OPPOSITE to — or is simply unsupported
   > by — that public information. Judge whether the SPECIFIC flagged pattern (its direction and
   > concentration), not merely the surrounding activity, is accounted for by public information.
3. **Add the per-outcome paragraph** (verbatim, handoff §2):
   > Assess it outcome by outcome, concentrating on the HIGHEST-CONVICTION outcomes (priced nearest
   > certain). A public explanation for some outcomes does not offset the absence of one for the
   > highest-conviction outcomes; if even one near-certain outcome has no specific public basis, the
   > concentration is not fully accounted for.
4. **Revise the verdict definitions** to (verbatim, handoff §2):
   > - EXPLAINED: a public catalyst specifically accounts for the flagged pattern (its direction included).
   > - UNEXPLAINED: nothing public accounts for the flagged pattern — including cases where public info
   >   explains the volume but NOT the flagged direction/concentration.
   > - AMBIGUOUS: the evidence on the flagged pattern itself is genuinely weak/partial.

Keep everything else as-is: streaming + 90s timeout, `web_search_20260209`, `claude-opus-4-8`,
fail-safe to AMBIGUOUS. Do NOT add leading/conclusory language ("this looks like insider") — the
handoff §3 shows that inflates detection artificially.

### Validation (the reason the harnesses exist)
The harnesses are dossier-based with **web search disabled** — they certify the *rubric wording*
produces correct discrimination without the model peeking at a resolved outcome. Production carries
the identical wording (live web search is the intended production mode, not a backtest mode).

Re-run **both** harnesses to confirm they still reproduce with the current model (guards against
drift since 2026-07-10):
- `investigator-backtest/` → **POS 10/10 UNEXPLAINED, NEG 10/10 EXPLAINED**.
- `investigator-backtest-cases/` → **sensitivity 10/10, specificity 6/6, false-pos 0/6**.

Harnesses read `ANTHROPIC_API_KEY` from `~/Downloads/ClaudeSandbox/.env`; if absent, point them at
the repo's key via the environment. No production `.env` change.

**Hard acceptance gate:**
- Zero false positives on negative controls (no negative may flip to UNEXPLAINED). This is
  non-negotiable — a flip means over-flagging; stop and revert.
- Sensitivity must reproduce. Minor stochastic wobble on the positives is investigated, not
  auto-accepted.

### Tests
- Unit test asserting `buildPrompt(candidate)` output contains the new rubric language (a stable
  substring from each of the three additions), so a later edit cannot silently drop it.
- Existing 207 tests stay green; `tsc --noEmit` clean.

---

## Track 2 — Hourly-candle detection + funnel instrumentation

### Funnel instrumentation — `src/live/probe.ts`
Today a market with too few candles returns `detectCandidate → null` and is silently absorbed into
`scanned − anomalies`, so every `anomalies=0` is ambiguous ("nothing there" vs "couldn't look").
Close it by counting insufficient-history markets explicitly.

- Add an `insufficientHistory` counter: a market whose fetched candle count `< windowSize +
  baselineSize` is counted here and NOT passed to `detectCandidate`.
- `analyzed = universe − errors − insufficientHistory`. Anomaly rate is reported over `analyzed`.
- Report a candle-count summary (min / median / max candles per market) to expose the age/coverage
  reality directly.

New funnel line shape:
```
Funnel: universe=X | errors=E insufficientHistory=Z analyzed=N
        anomalies=A viable=V investigated=I | verdicts EXPLAINED=.. UNEXPLAINED=.. AMBIGUOUS=.. | kept=K
        candles/market: min=.. median=.. max=..
```
`errors` is the current network/429 `skipped` counter, renamed for clarity.

### The run
```
--period 60 --window 3 --baseline 6 --section culture,mentions --min-volume 100 --max-markets 1000
```
Needs 9 hourly candles → analyzes markets roughly ≥9h old. DRY-RUN (no `--live --confirm`). Read
the funnel; tune `window`/`baseline` from the real coverage numbers.

### Explicitly NOT in scope (YAGNI)
No adaptive per-market resolution selection. The instrumentation above is precisely what tells us
whether coverage is bad enough to justify building it. If `insufficientHistory` dominates, adaptive
resolution becomes its own future track.

---

## Housekeeping
- Add `Context Dump/` to `.gitignore` (439 MB of reference PDFs — never commit).
- **Commit** `investigator-backtest/`, `investigator-backtest-cases/`, and
  `INVESTIGATOR_UPGRADE_CONTEXT.md` (currently untracked; valuable evaluation assets).

---

## Sequencing
1. **Track 1** — apply prompt changes → re-validate on both harnesses → unit test → commit.
2. **Track 2** — funnel instrumentation → hourly run → report → iterate on sizing.

## Deferred — Track B (committed, separate design later)
Feed the candidate's **sibling outcomes** (the other markets in the same Kalshi event) into the
live investigator so the per-outcome/concentration rubric has a field to judge — the strongest
informed-flow fingerprint (the Love Island concentration case). Touches the detection/data-flow
layer, not just the prompt, so it earns its own brainstorming + spec.

## Success criteria
- Track 1: production investigator carries the validated rubric; both harnesses reproduce their
  validated numbers (0 false positives is the hard gate); unit test locks the language in.
- Track 2: the funnel distinguishes "too fresh to analyze" from "analyzed, no anomaly", and the
  hourly Culture/Mentions run reports real coverage + any candidates — all DRY-RUN, no orders.
- No path places a real order without `--live --confirm` (unchanged invariant).
