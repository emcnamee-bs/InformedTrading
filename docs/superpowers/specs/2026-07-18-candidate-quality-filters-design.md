# Candidate-Quality Filters — Design

**Date:** 2026-07-18
**Status:** Approved (brainstorming) → ready for implementation plan

## Background / motivation

The first hourly Culture/Mentions dry-run (2026-07-18) produced the pipeline's first-ever
keepable output — 3 UNEXPLAINED candidates — but reviewing them showed none was a bet worth
making, and each exposed a systematic gap:

- `KXWORLDNEWSMENTION-26JUL16-IRAN` (NO @ 49¢): the resolving broadcast **already aired** (July 16,
  two days before the scan). There is no informed flow to follow — the outcome is determined.
- `KXAOCMENTION-26JUL18-AFFO` (NO @ 20¢): the flag bets AOC will **not** say her signature word
  "affordability", but every public catalyst makes YES near-certain. The flagged direction
  **contradicts** public info — we should fade it, not follow it.
- `KXWCMENTION…FRAENG-DOLP` (NO @ 55¢): an idiosyncratic random-word market priced near a coin
  flip — inherent noise, no informed edge possible. (Not addressed by this spec; see Non-goals.)

Root cause: the investigator answers *"is the flagged move publicly explained?"* (verdict), but
`keepUnexplained` treats every UNEXPLAINED as followable. UNEXPLAINED currently collapses three
different situations: public is **silent** on the flagged direction (genuine → follow), public
**contradicts** it (→ fade), and the **event already happened** (→ skip).

Key finding that shapes the design: **Kalshi's structured date fields do not reveal a past event.**
For the Iran market (event July 16) every field — `close_time`, `expiration_time`,
`occurrence_datetime` — reads July 31 (the settlement window). The event date lives only in the
**ticker** (`-26JUL16-`). Empirically, 40/40 sampled Culture/Mentions tickers parse a clean
`YYMONDD` code, and that code is the event date.

## Approach (chosen: Hybrid "C" + additive investigator field "A")

Two filters. A cheap structural pre-filter for the past-event case (with the investigator as a
backstop for unparseable tickers), and an additive investigator field for the contradiction case
that leaves the validated verdict rubric untouched.

### Component 1 — Past-event pre-filter (structural)

New focused module `src/live/eventDate.ts`:

- `parseEventDate(ticker: string): Date | null` — extract the `YYMONDD` code via regex
  `/-(\d{2})([A-Z]{3})(\d{2})/` plus a 3-letter-month map (JAN..DEC → 1..12), building a UTC date.
  Returns `null` when there is no parseable code (unknown ticker format).
- `isEventPast(ticker: string, nowTs: number): boolean` — `true` **only** when `parseEventDate`
  succeeds **and** the parsed date is *strictly before* today's UTC date (compare date-only, not
  time). Same-day → `false` (the event may still be later today). Unparseable → `false` (keep;
  the investigator `eventStatus` backstop covers it).

Applied at the **top of the `planProbe` per-market loop, before the candle/trade fetch** — so a
past-event market costs zero candle, trade, or investigator calls. Counted in a new funnel bucket
`pastEvent`.

### Component 2 — Investigator `publicLean` + `eventStatus` (additive)

`src/live/investigator.ts`:
- Extend `Investigation` (and the runner's `RunnerResult`) with:
  - `publicLean: "same" | "opposite" | "silent"` — does public info point the **same** way as the
    flagged direction, the **opposite** way, or say **nothing** about it?
  - `eventStatus: "past" | "upcoming" | "unknown"` — has the resolving event already occurred?
- Replace `keepUnexplained` with `keepCandidate(inv: Investigation): boolean` =
  `inv.verdict === "UNEXPLAINED" && inv.publicLean === "silent" && inv.eventStatus !== "past"`.

`src/live/claudeInvestigator.ts`:
- The **validated verdict rubric text (the "Separate the FLAGGED signal…", "Assess it outcome by
  outcome…", and the three EXPLAINED/UNEXPLAINED/AMBIGUOUS definitions) stays byte-for-byte
  unchanged.**
- Add ONE small additive instruction asking the model to also report `publicLean` and
  `eventStatus`, and extend the trailing JSON shape to:
  `{"verdict":...,"publicLean":"same"|"opposite"|"silent","eventStatus":"past"|"upcoming"|"unknown","rationale":"...","sources":[...]}`.
- Parse the two new fields. Fail-safe defaults on missing/invalid: `publicLean` → any non-"silent"
  value (so the candidate is NOT kept), `eventStatus` → "unknown". The existing two fail-safes
  (runner error, unparseable output) still return AMBIGUOUS and thus drop the candidate.

Result: AOC → UNEXPLAINED + `opposite` → dropped. Iran → skipped by the pre-filter (and would be
`eventStatus:"past"` if it ever reached the investigator). A genuinely silent unexplained move →
UNEXPLAINED + `silent` + not-past → kept.

### Wiring — `src/live/probe.ts`

- Call `isEventPast(market.marketTicker, deps.nowTs)` at the top of the loop; if true, increment a
  new `pastEvent` counter and `continue` (before the candle/trade fetch).
- Swap `keepUnexplained` → `keepCandidate`.
- Extend the funnel line with `pastEvent=N`, and report how many investigated UNEXPLAINED were
  dropped for `opposite` lean vs kept — so the filters are observable. Because a `pastEvent` market
  is skipped before analysis, `analyzed` becomes `universe - pastEvent - errors -
  insufficientHistory` (pastEvent is a new subtracted bucket, counted before the candle fetch).

## Validation

- **Re-run both backtest harnesses** (`investigator-backtest/`, `investigator-backtest-cases/`).
  The verdict rubric wording is unchanged, so expect them to hold: POS 10/10 UNEXPLAINED, NEG 10/10
  EXPLAINED, sensitivity 10/10, specificity 6/6, **false-pos 0/6**. This confirms the additive
  `publicLean`/`eventStatus` instruction did not drift the verdicts. Hard gate: zero false
  positives on negatives.
- **Unit tests:**
  - `parseEventDate`/`isEventPast`: a strictly-past date → skip; today's date → keep; a future date
    → keep; an unparseable ticker → keep (null / false).
  - `keepCandidate` truth table: UNEXPLAINED+silent+not-past → true; UNEXPLAINED+opposite → false;
    UNEXPLAINED+past → false; UNEXPLAINED+silent+past → false; EXPLAINED/AMBIGUOUS → false.
  - Investigator field parsing: valid fields parsed through; missing/invalid `publicLean` →
    non-keepable default; missing `eventStatus` → "unknown"; existing AMBIGUOUS fail-safes intact.
  - Funnel: a past-event market increments `pastEvent` and is not fetched/analyzed.
- **Re-run the hourly Culture/Mentions scan** (`--section culture,mentions --min-volume 100
  --max-markets 1000 --period 60 --window 3 --baseline 6`, DRY-RUN). Expected: Iran counted under
  `pastEvent`; AOC investigated → UNEXPLAINED + `opposite` → dropped; report what genuinely
  survives. No orders placed.

## File structure
- Create: `src/live/eventDate.ts` (+ `tests/live/eventDate.test.ts`)
- Modify: `src/live/investigator.ts` (types + `keepCandidate`)
- Modify: `src/live/claudeInvestigator.ts` (additive prompt + field parsing + defaults)
- Modify: `src/live/probe.ts` (pre-filter call, `keepCandidate`, funnel `pastEvent`)
- Modify: `tests/live/{investigator,claudeInvestigator,probe}.test.ts`

## Global constraints (carried from the project)
- Money safety invariant: no order without `--live --confirm`; all runs here DRY-RUN.
- The validated verdict rubric text must not change; new fields are strictly additive.
- No leading/conclusory language in the prompt.
- `npx tsc --noEmit` clean and all tests green after each task; stage only each task's own files.

## Non-goals / deferred
- Idiosyncratic-random-word markets (the "Dolphins" noise case) — not filtered here; revisit only
  if it proves a recurring problem (YAGNI).
- Track B (sibling-outcome / concentration awareness) remains a separate future design.

## Success criteria
- A past-event market (parseable ticker date strictly before today) is skipped before any candle or
  investigator call and reported as `pastEvent`.
- An UNEXPLAINED candidate whose flagged direction contradicts a near-certain public outcome is
  dropped (`publicLean:"opposite"`), not kept.
- Both backtest harnesses still pass (0 false-pos); the hourly re-run drops Iran and AOC and shows
  the surviving candidate set — all DRY-RUN.
