# Spec — Multi-case investigator backtest (5 historical informed-betting cases)

**Date:** 2026-07-10 · **Location:** `InsiderTradeFollower/investigator-backtest-cases/` (new;
existing project files untouched) · **Runs on:** host (macOS), no container. · **Sibling:**
`investigator-backtest/` (single Love-Island unit + negative control) — this suite reuses its
design (curated pre-cutoff corpus, web_search disabled, verdict-distribution scoring).

## Purpose
Measure how the `InsiderTradeFollower` explain-away investigator performs against the five
confirmed/alleged Kalshi informed-betting cases documented in
`~/Downloads/ClaudeSandbox/AGENT_CONTEXT_Kalshi_Informed_Betting.md`. Every case is a
**labeled positive**: the correct verdict is `UNEXPLAINED` (no public catalyst accounts for the
flagged pattern ⇒ consistent with informed betting).

## The five cases (all under `cases/`)

| Case | Cutoff | Real detection pathway |
|---|---|---|
| `case-1-editor` — YouTube editor, near-perfect win rate on channel-metric markets [CONFIRMED] | 2025-09-20T00:00:00Z | **Price/behavior anomaly** (win-rate) + relationship |
| `case-2-candidate` — candidate trading his own candidacy [CONFIRMED] | 2025-05-20T00:00:00Z | **Social-media evidence** (not price) |
| `case-3-three-candidates` — three candidates, Rule 5.17(z) [CONFIRMED] | 2026-01-15T00:00:00Z (approx; exact dates not public) | **Relationship/name match** (not price) |
| `case-4-santos` — Santos SOTU attendance, KXATTENDSOTU-GSAN [ALLEGED; CFTC investigation confirmed] | 2026-02-24T22:00:00Z | **Volume-concentration anomaly** (>35% of volume, one actor) |
| `case-5-staffers` — campaign staffer on own campaign's race [DOCUMENTED PROGRAM] | 2026-07-01T00:00:00Z | **FEC name match** (not price) |

Each case dir holds `case.json` (`name`, `cutoff_iso`, `anomaly` = the flagged signal a detector
would surface, `expected`, `notes`) and `dossier.md` (curated facts-only pre-cutoff public
corpus).

## Blind input
The investigator sees only the flagged anomaly (from `case.json`) plus the pre-cutoff dossier. It
is never told the case was later investigated, sanctioned, or how any market resolved. Dossiers
follow the sibling suite's rules: facts only, every item basis-labeled and pre-cutoff, no leading
language, no resolution/enforcement outcome. The relationship signal itself (editor role, FEC
match, self-trading candidate, Santos's public attendance confirmation) IS included — presented
as neutral observed fact, since a detector would surface it.

## Cutoff enforcement
Same design pivot as the sibling suite: **curated corpus with web_search DISABLED** (live search
leaks resolved outcomes). The investigator reasons only over the dossier + pre-cutoff general
knowledge. Cases 4 and 5 postdate the model's Jan-2026 training cutoff, so their outcomes are
strictly unknowable to it; cases 1-3 occurred in 2025 but their enforcement disclosure came via
the 2026-02-25 CFTC advisory (post-training-cutoff), so leakage risk from weights is low —
residual risk is noted rather than eliminated.

## Santos price data (real)
`cases/case-4-santos/dossier.md` embeds **real candlestick history** for `KXATTENDSOTU-GSAN`
(33 daily + hourly candles through the cutoff) pulled from Kalshi's public no-auth endpoint
`GET https://api.elections.kalshi.com/trade-api/v2/historical/markets/KXATTENDSOTU-GSAN/candlesticks`.
The data independently corroborates the documented narrative (YES ~13c → ~77c surge on Feb 22
around Santos's public confirmation; ~183k/~176k daily volume vs ~7-27k baseline). Narrative
items whose primary timestamps could not be re-verified are labeled documented-narrative. The
cutoff (2026-02-24 22:00 UTC) is just before the pre-speech price collapse, so the collapse and
the "airport" post are excluded.

## Adapted investigator
`resolvedInvestigator.ts` — self-contained adaptation of `src/live/claudeInvestigator.ts` (same
Anthropic SDK / `claude-opus-4-8` / streaming / trailing-JSON `{verdict,rationale,sources}`
machinery, same general explain-away framing and EXPLAINED/UNEXPLAINED/AMBIGUOUS semantics), with
web_search removed and the case anomaly + dossier injected. Exports `investigateCase(caseDir)`.

## Scoring
`UNEXPLAINED` = correct detection. Per case: verdict distribution over `RUNS_PER_CASE` fresh
stateless runs (default 2). Overall: **detection rate = UNEXPLAINED verdicts / total runs**. Full
reasoning transcripts saved per run so the *process* can be evaluated, not just the label.

**Honest caveat — this suite maps coverage, not just accuracy.** Cases 2, 3, and 5 were detected
in reality via relationship/social-media/name-match signals, not price anomalies. An explain-away
investigator pointed at a flagged pattern can still assess them (the dossier surfaces the
relationship as the flagged signal), but a miss on those cases indicates a coverage boundary of
price-anomaly-driven pipelines rather than a reasoning failure alone. Case 1 and especially
case 4 are the fair price/behavior-anomaly tests.

## Auth / run
`ANTHROPIC_API_KEY` read from the environment (source: `~/Downloads/ClaudeSandbox/.env`). Run:
```
cd ~/Downloads/InsiderTradeFollower && node_modules/.bin/tsx investigator-backtest-cases/runCases.ts
```
Env: `RUNS_PER_CASE` (default 2) · `CASES=case-4-santos[,...]` to run a subset ·
`CLAUDE_INVESTIGATOR_MODEL` to override the model (default `claude-opus-4-8`).

## Outputs
`cases/<case>/runs/run-NN.md` (full transcripts) · `SUMMARY.md` (per-case distributions +
overall detection rate + example prompt).
