# Spec — Investigator effectiveness backtest (resolved-market labeled positive)

**Date:** 2026-07-10 · **Location:** `InsiderTradeFollower/investigator-backtest/` (new; existing
project files untouched) · **Runs on:** host (macOS), no container.

## Purpose
Measure how effectively `InsiderTradeFollower`'s explain-away investigator detects insider trading,
using a resolved Kalshi market as a **labeled-positive** ground-truth unit.

## Baseline test unit
`KXLIUSAELIMINATIONW-26JUL03` — Love Island USA Season 8, Week 5 elimination. Treated as a known
insider-trading example: the 5 contestants who were eliminated (Caleb, Jen, Jaiden, Gal, Amora) were
already priced 86–94¢ to be eliminated **as of the cutoff**, before the public reveal.

## Blind input
The investigator sees only the **price snapshot as of the cutoff** (`snapshot.json`): every
contestant's YES price + cumulative volume up to the cutoff. It is NEVER told who was actually
eliminated. Being priced high ≠ confirmed — the investigator must reason about whether *public
pre-cutoff information* justifies the concentration.

## The critical cutoff — enforced by a curated corpus (design pivot)
**Only information public before `2026-07-03T20:00:00Z` (12:00 noon PST, UTC−8).**

A first attempt used live `web_search` with an auto-void audit. It failed: for a resolved
reality-TV market, search returns the actual result as the top hits, so the model *saw* the answer
regardless of instructions (proven — see `runs/` history in git). Enforcement was therefore changed
to a **curated pre-cutoff corpus with live search DISABLED**:
- A human-verified dossier (`corpus.md`) of strictly pre-cutoff public material (show format, villa
  drama aired through July 2, public betting-market context), each item dated; nothing from July 3+
  and no statement of the result.
- The investigator runs with **no web access** and may reason ONLY over the dossier + general
  pre-cutoff knowledge.
- **Hard guarantee:** the model's training cutoff is January 2026 and this season aired afterward,
  so it cannot know the July 2026 outcome from any source other than the dossier we control.
- **Tradeoff (accepted):** this tests the investigator's *reasoning over correct-era information*,
  not its live search ability. Curator bias is the main residual risk — mitigated by including the
  aired drama honestly (which mostly implicates *different* islanders than the market concentrated
  on) and documenting every item's date/basis in `corpus.md`.

## Adapted investigator
`resolvedInvestigator.ts` — a self-contained adaptation of `src/live/claudeInvestigator.ts`: same
Anthropic-SDK / Opus / streaming / trailing-JSON verdict machinery, but `web_search` is removed and
the fixed pre-cutoff dossier is injected into the prompt. Captures the **full reasoning transcript**,
not just the JSON.

## Scoring
Verdict `UNEXPLAINED` = **correct detection** (no public explanation ⇒ consistent with informed
betting). `EXPLAINED` = investigator found a public catalyst. `AMBIGUOUS` = uncertain. Run **10 fresh
(stateless) times**; report the verdict distribution + surface every run's full reasoning, searches,
and (for EXPLAINED) the cited public reason, so the *process* can be evaluated, not just the label.

## Auth / run
`ANTHROPIC_API_KEY` read from `~/Downloads/ClaudeSandbox/.env`. Run:
`node_modules/.bin/tsx investigator-backtest/runBacktest.ts`.

## Outputs
`runs/run-01.md … run-10.md` (clean), `runs/voided-*.md` (discarded), `SUMMARY.md` (distribution +
per-run one-liners + the shared prompt).
