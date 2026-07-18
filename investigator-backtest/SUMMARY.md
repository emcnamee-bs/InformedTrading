# SUMMARY — Investigator effectiveness backtest (facts-only + negative control)

**Test unit:** KXLIUSAELIMINATIONW-26JUL03 (Love Island USA Wk5). Same snapshot for both units;
only the dossier differs. web_search DISABLED; model training cutoff Jan-2026 (season aired later),
so the outcome is unknowable except via the dossier. Cutoff 2026-07-03T20:00:00Z. 10 fresh runs per unit.

## POSITIVE — facts-only real pre-cutoff record (expect UNEXPLAINED)
- UNEXPLAINED: 10
Order: UNEXPLAINED, UNEXPLAINED, UNEXPLAINED, UNEXPLAINED, UNEXPLAINED, UNEXPLAINED, UNEXPLAINED, UNEXPLAINED, UNEXPLAINED, UNEXPLAINED
**Detection (UNEXPLAINED): 10/10**

## NEGATIVE CONTROL — identical + genuine public explanation (expect EXPLAINED)
- EXPLAINED: 10
Order: EXPLAINED, EXPLAINED, EXPLAINED, EXPLAINED, EXPLAINED, EXPLAINED, EXPLAINED, EXPLAINED, EXPLAINED, EXPLAINED
**Specificity (EXPLAINED): 10/10**

## Discrimination
The investigator DISCRIMINATES:
it flags insider on the real record (10/10 UNEXPLAINED) yet correctly clears the
concentration when a public catalyst is present (10/10 EXPLAINED). A high UNEXPLAINED
rate on BOTH would have meant it just always cries insider.

## The POSITIVE prompt
```
A market-surveillance anomaly detector just flagged an unexplained, statistically anomalous
concentration in the Kalshi elimination event "KXLIUSAELIMINATIONW-26JUL03" (Love Island USA — Season 8, Week 5).
Each remaining contestant has a YES market ("Will <contestant> be eliminated this week?"). The
moment under investigation is 2026-07-03T20:00:00Z (noon PST) (12:00 noon PST, 2026-07-03); this week's
elimination has NOT been revealed yet at that moment. As of that moment the YES prices
(probability of being eliminated), highest first, are:
  - Gal: 94c  (cumulative volume to date: 99246)
  - Amora: 93c  (cumulative volume to date: 57582)
  - Jaiden: 92c  (cumulative volume to date: 71202)
  - Jen: 91c  (cumulative volume to date: 68120)
  - Caleb: 86c  (cumulative volume to date: 133006)
  - Kenzie: 7c  (cumulative volume to date: 104407)
  - Dylan: 4c  (cumulative volume to date: 61167)
  - Sincere: 3c  (cumulative volume to date: 99448)
  - Parmida: 2c  (cumulative volume to date: 37285)
  - Corbin: 2c  (cumulative volume to date: 36842)
  - Melanie: 2c  (cumulative volume to date: 41858)
  - Carl: 2c  (cumulative volume to date: 3714)
  - Aniya: 2c  (cumulative volume to date: 25844)
  - Tierra: 2c  (cumulative volume to date: 50518)
  - Bryce: 1c  (cumulative volume to date: 7173)
  - Trinity: 1c  (cumulative volume to date: 7992)
  - Kayda: 1c  (cumulative volume to date: 2402)
  - Zach: 1c  (cumulative volume to date: 18980)
  - KC: 1c  (cumulative volume to date: 57465)

Review the public information available as of that moment (provided in the dossier below) for
anything -- the show's format/rules, aired episodes, reported news, a public vote/ranking, betting
coverage, etc. -- that would plausibly explain this concentration.

Assess it OUTCOME BY OUTCOME, concentrating on the market's HIGHEST-CONVICTION outcomes (those
priced nearest to certain). For each such outcome ask: does the public record SPECIFICALLY justify
THAT outcome being priced near-certain? A public explanation for some outcomes does not offset the
absence of one for the highest-conviction outcomes -- if even one near-certain outcome has no
specific public basis, the concentration is not fully accounted for by public information.

- EXPLAINED: the public record specifically justifies the near-certainty of the highest-conviction
  outcomes (the concentration is publicly grounded).
- UNEXPLAINED: one or more of the highest-conviction outcomes are NOT justified by the public
  record (a thorough review finds nothing specifically supporting those top prices), even if some
  other, lower-priced outcomes are partially explainable.
- AMBIGUOUS: the evidence on the highest-conviction outcomes themselves is genuinely mixed/partial.

Constraint: reason ONLY from the dossier below plus general knowledge that was already true before
the cutoff. You have no web access and no knowledge of the actual result; do not guess it.

================= BEGIN PRE-CUTOFF DOSSIER =================
# Pre-cutoff public dossier (POSITIVE unit) — Love Island USA S8 Wk5, as of 2026-07-03 12:00 PST (20:00 UTC)

**Curation method:** Every item is public before the cutoff. Basis labeled per item: **(P) published**
= article verifiably dated before the cutoff; **(A) aired** = content broadcast before the cutoff
(public by broadcast). Nothing from July 3+ and no statement of the Week-5 result is included. This
dossier is FACTS ONLY — it contains no interpretation of who is "vulnerable" beyond what the sources
literally state. The model has a Jan-2026 training cutoff (season aired later), so absent this
dossier it has no knowledge of the outcome.

---

## 1. Elimination format
*(P) Peacock, "How to Vote During Love Island USA Season 8," updated 2026-06-10.*
- Islanders are dumped two ways: (a) **America's vote via the official app**, and (b) **recouplings**
  (an islander left single is dumped).
- App voting "directly influences outcomes, including rankings, eliminations, dates, and Bombshell
  arrivals." Viewers can save vulnerable contestants; a couple "may spiral after learning America
  ranked them toward the bottom." Voting windows open during episodes; results are revealed on-air.

## 2. Aired villa events through July 2 (Movie Night)
*(A) Season 8 "Movie Night" episodes (Ep. 25 aired ~2026-06-30/07-01; Ep. 26 aired 2026-07-02).
On-air events only.*
- Six couples remained heading into the week.
- Movie Night montages exposed: Sincere telling Casa Amor's **Amora** that with more time he'd have
  chosen her over **Melanie** (Melanie broke down; the two were shown sleeping separately). **Kenzie**
  telling **Corbin** she thought of him while kissing **Caleb**, plus a secret Kenzie–Corbin kiss;
  **Caleb** said he felt "blindsided." **Caleb & Jaiden's** connection was described on-air as having
  "somewhat plateaued." Corbin was shown dismissing his coupling and insulting villa women; Kayda
  challenged him.

## 3. Public prediction-market context
*(A/P) Public knowledge before the cutoff.*
- These questions trade as public per-islander Kalshi markets ("Will <islander> be eliminated this
  week?"), mirrored on Coinbase — a live public probability exists.
- Betting/analysis outlets publish weekly Love Island elimination odds and vulnerability write-ups;
  bettors openly discuss who looks vulnerable. This is a public information channel.

## 4. General reality-TV base rates
- Eliminations commonly hit the newly single, the freshly exposed in drama, or couples signaled low
  in America's ranking. Multiple simultaneous dumpings occur at mid/late-season culls.

---
**Not included:** any July 3+ article; any statement of the Week-5 result; the July 3 episode; any
post-cutoff app ranking.

================== END PRE-CUTOFF DOSSIER ==================

After your reasoning, end your reply with a single JSON object on its own line, and nothing after
it, in exactly this shape (no markdown fencing):
{"verdict":"EXPLAINED"|"UNEXPLAINED"|"AMBIGUOUS","rationale":"...","sources":["dossier section or fact you relied on", ...]}
```