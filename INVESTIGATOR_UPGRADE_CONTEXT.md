# Investigator Upgrade — Context & Handoff

**Audience:** an agent about to edit this repo's real-time "explain-away" investigator
(`src/live/claudeInvestigator.ts`, `src/live/investigator.ts`). This file summarizes what a
2026-07-10 evaluation established and gives you concrete, validated changes to make. Read it before
touching the investigator.

---

## 0. TL;DR — what to change and why

Two **prompt/rubric** changes to the investigator were designed and empirically validated. They are
prompt-only (no model, SDK, or architecture change) and both are safe (they raised detection with
**zero** new false positives against negative controls):

1. **Judge per-outcome, focused on the highest-conviction outcomes.** For a multi-outcome/event-level
   concentration, decide whether the *specific highest-priced outcomes* are publicly justified. Do
   NOT let a partial public explanation for *some* outcomes drag the whole verdict to AMBIGUOUS.
2. **Separate the flagged signal from surrounding activity.** A public catalyst that explains the
   *volume* or the move in *one direction* does NOT explain a flagged position whose *direction,
   one-sidedness, or timing* contradicts — or is unsupported by — that public information.

**Measured effect** (see §4): on labeled cases these took detection from 0/10 → 10/10 (Love Island
concentration test) and fixed the one real price-anomaly case (Santos) from 1/2 → 2/2, while
negative controls stayed **6/6 EXPLAINED, 0 false positives**. That combination = genuine
discrimination, not "always cries insider."

---

## 1. The investigator as it exists now

- `src/live/investigator.ts`: `Verdict = "EXPLAINED" | "UNEXPLAINED" | "AMBIGUOUS"`. **`keepUnexplained()`
  keeps ONLY `UNEXPLAINED`** for trading — so `AMBIGUOUS` and `EXPLAINED` are both filtered out.
  ⚠️ **Consequence:** the AMBIGUOUS↔UNEXPLAINED boundary is decision-critical. An over-cautious
  investigator that returns AMBIGUOUS on a genuine insider pattern **silently misses it** (it never
  gets kept/bet). Both changes in §0 exist to fix exactly this over-caution without over-flagging.
- `src/live/claudeInvestigator.ts`: `buildPrompt(candidate)` frames "a detector flagged a
  statistically anomalous move; search the public web for a catalyst," then three verdict bullets +
  a trailing `{verdict,rationale,sources}` JSON. Runner = Anthropic SDK, server-side
  `web_search_20260209`, `claude-opus-4-8`, streaming, fail-safe to AMBIGUOUS on any error.
- **`MAX_TOKENS = 2048`** in the runner. This is tight; truncated replies fail JSON parse → AMBIGUOUS.
  Recommend raising to ~4096 (the validated harness used 4096). Small, safe win.
- **Keep live `web_search` for the production (live-market) investigator.** The leakage problem in §5
  is specific to *resolved-market backtesting*, not live use.

## 2. The exact prompt language to add (liftable)

Insert into `buildPrompt`, after the "search for a catalyst" instruction and before/around the
verdict bullets. Wording that was validated:

> Separate the FLAGGED signal from surrounding market activity. A public catalyst that explains the
> overall volume, or a price move in ONE direction, does NOT by itself explain a flagged position
> whose direction, one-sidedness, or timing runs OPPOSITE to — or is simply unsupported by — that
> public information. Judge whether the SPECIFIC flagged pattern (its direction and concentration),
> not merely the surrounding activity, is accounted for by public information.

And revise the verdict definitions to:

> - EXPLAINED: a public catalyst specifically accounts for the flagged pattern (its direction included).
> - UNEXPLAINED: nothing public accounts for the flagged pattern — including cases where public info
>   explains the volume but NOT the flagged direction/concentration.
> - AMBIGUOUS: the evidence on the flagged pattern itself is genuinely weak/partial.

For event-level / multi-outcome markets (fields of mutually-related contracts), also add the
per-outcome instruction:

> Assess it outcome by outcome, concentrating on the HIGHEST-CONVICTION outcomes (priced nearest
> certain). A public explanation for some outcomes does not offset the absence of one for the
> highest-conviction outcomes; if even one near-certain outcome has no specific public basis, the
> concentration is not fully accounted for.

## 3. Hard rules when editing the investigator (learned the hard way)

- **Do NOT add leading language** that tells the model what to conclude ("this looks like insider,"
  "no public basis exists"). That inflates detection artificially — an early corpus with such
  phrasing produced a fake 10/10 that collapsed to 0/10 once neutralized. Keep the prompt neutral;
  let the model reason.
- **Keep observation separate from conclusion.** The investigator states the anomaly + whether public
  info explains it; it must not assert "confirmed insider trading" from price alone.
- **Any prompt change must be re-validated against BOTH positives and negative controls** (§6). A
  change that raises UNEXPLAINED on positives is only good if negatives stay EXPLAINED.

## 4. Evidence base (why to trust §0)

Two harnesses, dossier-based (web disabled, model can't peek), Opus, fresh stateless runs:

- **Concentration test** (Love Island USA Wk5, a genuine informed-betting example — the correct 5
  eliminees sat 86–94% pre-reveal on a field the public record did NOT single out):
  - Neutral prompt, before per-outcome fix: **0/10 UNEXPLAINED** (10/10 AMBIGUOUS) — reasoning was
    right ("highest prices Gal/Jen have no public basis; drama-implicated names priced safe") but the
    verdict over-collapsed to AMBIGUOUS.
  - After per-outcome fix: **10/10 UNEXPLAINED**, negative control (same market + a genuine public
    ranking) **10/10 EXPLAINED**. Discrimination confirmed.
- **Historical case suite** (5 real confirmed/alleged cases + 3 constructed negative controls),
  after both fixes: **sensitivity 10/10, specificity 6/6, false-positives 0/6**. The one real
  price-anomaly positive (George Santos SOTU, real Kalshi candlesticks) went **1/2 → 2/2** from the
  "separate flagged signal" fix, with no cost to the negatives.

## 5. Methodology pitfalls (that shaped the above)

- **Live web search leaks the answer for resolved markets.** Searching a resolved event returns the
  outcome as top hits; the model then can't be blind. For *backtesting/eval*, use a curated
  pre-cutoff dossier with `web_search` DISABLED (the model's Jan-2026 training cutoff + no web = it
  cannot know a later outcome). For *live* production use, web search is correct.
- **The verdict threshold is the product**, not the analysis. In every failing case the model's prose
  reasoning was already correct; the gap was labeling a "suspicious residual" AMBIGUOUS instead of
  UNEXPLAINED. §2's wording closes that gap principledly.

## 6. How to re-validate after you edit (do this before claiming an improvement)

Two ready harnesses (host macOS, uses repo `node_modules/.bin/tsx`, reads `ANTHROPIC_API_KEY` from
`~/Downloads/ClaudeSandbox/.env`). They copy the investigator's SDK/verdict mechanics — if you change
`buildPrompt` in production, mirror the change into the harness `resolvedInvestigator.ts` prompts and
re-run:

- **Concentration + negative control:** `investigator-backtest/` →
  `RUNS...=... node_modules/.bin/tsx investigator-backtest/runBacktest.ts`. Expect POS 10/10
  UNEXPLAINED, NEG 10/10 EXPLAINED.
- **Historical case suite (5 pos + 3 neg):** `investigator-backtest-cases/` →
  `RUNS_PER_CASE=2 node_modules/.bin/tsx investigator-backtest-cases/runCases.ts`. Expect
  sensitivity 10/10, specificity 6/6, false-pos 0/6. `SUMMARY.md` reports it.
- **Acceptance bar for a prompt change:** sensitivity must not drop AND specificity must stay ≥ prior
  (no new false positives on the negative controls). If a change raises detection but flips any
  negative to UNEXPLAINED, it is over-flagging — revert.

## 7. Scope / caveats (do not over-claim)

- The historical-suite positives for candidate/staffer/editor cases pass largely because the dossier
  **surfaces the insider relationship** (name-match, role). Those measure relationship *judgement*,
  not price *detection*. The genuinely price-detective positive is Santos.
- Negative controls in the case suite are **constructed** stimuli (clearly labeled), not real
  markets. They validate the discrimination logic; a stronger future test uses real Kalshi markets
  that moved on public news as negatives, and more runs/case (n was 2).
- Domain guardrail (from the case research): "informed" ≠ automatically "illegal" (CFTC Rule 180.1 is
  not a parity rule). Frame outputs as "possible informed betting / possible Exchange-Rule
  violation," never "confirmed insider trading."

## 8. Domain quick-reference (for the investigator's own reasoning)

Validated statistical fingerprints of informed betting on Kalshi (single-name/narrow markets show
the most visible informed impact): pre-news price move (ILS ≈ fraction of the move before first
public mention), concentrated one-sided volume, abnormally large trades vs. liquidity, a plausible
insider relationship (decision-maker / employee / affiliate), and the winning side contradicting the
subject's public statements. Full library + sources: `~/Downloads/ClaudeSandbox/
AGENT_CONTEXT_Kalshi_Informed_Betting.md` and `Kalshi_Informed_Betting_Detection_Research.md`.
