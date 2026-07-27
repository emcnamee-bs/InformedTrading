# SUMMARY — Explain-away investigator vs. historical cases (positives + negative controls)

**Design:** each case = a flagged anomaly + a curated facts-only pre-cutoff dossier (web_search
DISABLED, so nothing post-cutoff leaks). POSITIVES (expected UNEXPLAINED) are real confirmed/
alleged informed-betting cases; NEGATIVE CONTROLS (expected EXPLAINED) are constructed cases where
a genuine public catalyst accounts for the flagged pattern. 2 fresh stateless run(s) per case.

## case-1-editor — "YouTube channel-metric markets — editor with near-perfect win rate"
- Cutoff: 2025-09-20T00:00:00Z · Expected: UNEXPLAINED (labeled positive)
- Flagged anomaly: A single Kalshi account shows a near-perfect win rate across a narrow set of related low-odds event contracts tied to one major YouTube channel's content and video-performance metrics, repeatedly entering cheap YES positions shortly before the resolving videos were released and winning. Win-rate surveillance flagged the account's run as statistically anomalous for contracts priced at those odds. Public professional records identify the account holder as a video editor working for that same channel.
- Notes: Labeled positive: confirmed by the CFTC's 2026-02-25 enforcement advisory (trader identified in press as a MrBeast editor; $20,397.58 in disgorgement+fine, 2-year suspension). Caught by a genuine statistical anomaly (near-perfect win rate on low-odds narrow markets) plus the structural information relationship. Closest case in the suite to a pure price/behavior detection. Platform caveat: CFTC describes it on KalshiEX; some press describes Polymarket bets; the transferable pattern is editor-with-advance-content-knowledge. Cutoff set before Kalshi's investigation/enforcement became public.
- UNEXPLAINED: 2
Order: UNEXPLAINED, UNEXPLAINED
**Correct (verdict == UNEXPLAINED): 2/2**

## case-2-candidate — "Candidate trading contracts on his own candidacy (May 2025)"
- Cutoff: 2025-05-20T00:00:00Z · Expected: UNEXPLAINED (labeled positive)
- Flagged anomaly: An account holding positions in a thin Kalshi market tied to a specific election race belongs to a declared candidate in that same race. The candidate posted social-media videos publicly depicting/discussing his own trading of contracts tied to his candidacy. The position is in a market whose outcome the account holder can directly influence as a participant in the resolving event.
- Notes: Labeled positive: confirmed by the CFTC's 2026-02-25 enforcement advisory ($2,246.36 disgorgement+fine, 5-year suspension; the trader admitted violating exchange rules). IMPORTANT: this case was detected via social-media videos (a relationship/public-evidence signal), NOT a price anomaly — Kalshi compliance contacted him the same day the videos surfaced. An explain-away investigator built for price anomalies may not naturally flag it; it is included to map coverage of relationship-flagged cases.
- UNEXPLAINED: 2
Order: UNEXPLAINED, UNEXPLAINED
**Correct (verdict == UNEXPLAINED): 2/2**

## case-3-three-candidates — "Three candidates trading markets on their own elections (Rule 5.17(z))"
- Cutoff: 2026-01-15T00:00:00Z · Expected: UNEXPLAINED (labeled positive)
- Flagged anomaly: Relationship screening flagged accounts trading in three separate small Kalshi election markets: in each, the account holder is a declared candidate in the very race the market references, holding directional positions on an outcome the holder participates in deciding. The three races are otherwise unrelated; the common pattern is decision-maker self-trading in thin single-race markets.
- Notes: Labeled positive: three candidates were sanctioned for trading markets tied to their own elections in violation of Kalshi Exchange Rule 5.17(z) (source confidence medium-high; reported via Kalshi enforcement coverage). Like case 2, this was detected via the candidate-account relationship (name/identity matching), NOT a price anomaly; exact dates are not public, so the cutoff is approximate (set before the enforcement reporting became public). Included to map coverage of relationship-flagged cases.
- UNEXPLAINED: 2
Order: UNEXPLAINED, UNEXPLAINED
**Correct (verdict == UNEXPLAINED): 2/2**

## case-4-santos — "SOTU attendance market — George Santos (KXATTENDSOTU-GSAN)"
- Cutoff: 2026-02-24T22:00:00Z · Expected: UNEXPLAINED (labeled positive)
- Flagged anomaly: In the Kalshi market KXATTENDSOTU-GSAN ("Will George Santos attend the 2026 State of the Union?"), surveillance flagged concentrated one-sided NO accumulation: trading tied to a single actor accounted for over 35% of the market's volume on the day before the address, within roughly $7.8M wagered across the event on Feb 24, while the YES price held in the 65-75c range. Daily volume in this single-name market jumped from a ~7k-27k contract baseline to ~183k (Feb 22-23 UTC) and ~176k (Feb 23-24 UTC) contracts. The concentrated position profits only if Santos does NOT attend, and the market's resolution is controlled by a single individual.
- Notes: Labeled positive: Kalshi surveillance detected the concentrated position, froze the account, and referred the matter to the CFTC (CFTC investigation confirmed; profit/deception remain allegations). This is the one case in the suite that WAS caught primarily via a price/volume/concentration anomaly, and it has the best public odds chart: the dossier's price table is real candlestick data pulled from Kalshi's public historical API. Cutoff is set just before the pre-speech 'watching from an airport' post and price collapse.
- UNEXPLAINED: 2
Order: UNEXPLAINED, UNEXPLAINED
**Correct (verdict == UNEXPLAINED): 2/2**

## case-5-staffers — "Campaign staffer trading a market on their own campaign's race (2026 cycle)"
- Cutoff: 2026-07-01T00:00:00Z · Expected: UNEXPLAINED (labeled positive)
- Flagged anomaly: An account holds a concentrated one-sided position in a thin Kalshi market on a specific 2026 congressional race. The account holder's name matches a person listed as a paid staffer in FEC disbursement filings for one of the campaigns in that same race. The position was accumulated steadily over several weeks without corresponding public polling releases or race news, and is one-sided in favor of the staffer's own campaign's candidate.
- Notes: Labeled positive (documented program, 2026): Kalshi actively cross-references campaign-staffer names from FEC filings against user logs and blocks matches from trading their campaign's markets — and at least one operative traded on a race despite the monitoring, showing the program is imperfect. Detection is via name-matching FEC records (a relationship signal), NOT a price anomaly; staffer cases are precisely the gap where price-based detection must carry the load. Included to map coverage. Cutoff set before the program's imperfections were publicly reported (NPR 2026-07-09).
- UNEXPLAINED: 2
Order: UNEXPLAINED, UNEXPLAINED
**Correct (verdict == UNEXPLAINED): 2/2**

## case-6-neg-newsmove — "NEGATIVE CONTROL — earnings market move that followed a public data release"
- Cutoff: 2026-04-24T15:30:00Z · Expected: EXPLAINED (NEGATIVE control)
- Flagged anomaly: A thin single-name Kalshi market ('Will Company X report Q1 revenue above $2.0B?') showed a sharp one-sided YES jump from ~30c to ~86c with a concentrated volume spike inside a ~90-minute window, well above the market's prior baseline.
- Notes: NEGATIVE CONTROL (constructed test stimulus, not a real case). The flagged jump is a public-news-driven move: it began immediately AFTER Company X's scheduled, public quarterly earnings release, which beat the threshold. Correct verdict is EXPLAINED (the move FOLLOWED public information; low leakage). Purpose: verify the investigator does not over-flag a legitimate news-driven move as informed betting.
- EXPLAINED: 2
Order: EXPLAINED, EXPLAINED
**Correct (verdict == EXPLAINED): 2/2**

## case-7-neg-consensus — "NEGATIVE CONTROL — election market tracking a public polling consensus"
- Cutoff: 2026-06-15T00:00:00Z · Expected: EXPLAINED (NEGATIVE control)
- Flagged anomaly: A concentrated, one-sided position pushed a thin Kalshi market on a single local election to ~90% for one candidate over several days, with most volume on that side.
- Notes: NEGATIVE CONTROL (constructed). The ~90% concentration matches a long-standing, widely-reported PUBLIC polling/forecast consensus; the position simply tracks public analysis, with no insider relationship and no contradiction of public statements. Correct verdict is EXPLAINED (superior/ordinary public analysis, not informed betting). Purpose: verify the investigator does not flag skilled trading on public information.
- EXPLAINED: 2
Order: EXPLAINED, EXPLAINED
**Correct (verdict == EXPLAINED): 2/2**

## case-8-neg-datafeed — "NEGATIVE CONTROL — chart-ranking market tracking a public data feed"
- Cutoff: 2026-05-11T00:00:00Z · Expected: EXPLAINED (NEGATIVE control)
- Flagged anomaly: A Kalshi market ('Will Song X be #1 on next week's official streaming chart?') concentrated to ~92% YES with steady one-sided buying several days before the official chart's release.
- Notes: NEGATIVE CONTROL (constructed). A widely-followed PUBLIC midweek chart tracker already published projections showing Song X #1 by a wide margin days before the official chart; the concentration reflects that public data feed, not private information. Correct verdict is EXPLAINED. Purpose: verify the investigator does not flag concentration that is grounded in an already-public data source (the same 'public precursor feed' pattern that made most real culture-market candidates explainable).
- EXPLAINED: 2
Order: EXPLAINED, EXPLAINED
**Correct (verdict == EXPLAINED): 2/2**

## Overall
**Sensitivity — positives correctly flagged UNEXPLAINED: 10/10**
**Specificity — negative controls correctly EXPLAINED: 6/6**
**False positives on negative controls (UNEXPLAINED): 0/6** (remainder = AMBIGUOUS; see per-case)

Read: high sensitivity WITH high specificity = genuine discrimination. High UNEXPLAINED on the
negatives would mean the rubric over-flags. Positives 2/3/5 were relationship/social-media
detected in reality (the dossier surfaces that relationship), so they measure relationship
judgement, not price detection.

## Example prompt (case-1-editor)
```
A market-surveillance anomaly detector just flagged the following statistically anomalous
trading pattern on Kalshi (case: "YouTube channel-metric markets — editor with near-perfect win rate"):

  A single Kalshi account shows a near-perfect win rate across a narrow set of related low-odds event contracts tied to one major YouTube channel's content and video-performance metrics, repeatedly entering cheap YES positions shortly before the resolving videos were released and winning. Win-rate surveillance flagged the account's run as statistically anomalous for contracts priced at those odds. Public professional records identify the account holder as a video editor working for that same channel.

The moment under investigation is 2025-09-20T00:00:00Z. The market(s) involved had NOT resolved
at that moment.

Review the public information available as of that moment (provided in the dossier below) for
anything -- a news story, an official announcement, a public statement, a scheduled event, an
economic or data release, public odds/betting coverage, etc. -- that would plausibly explain
this flagged pattern as ordinary trading on public information.

Separate the FLAGGED signal from surrounding market activity. A public catalyst that explains the
overall volume, or a price move in ONE direction, does NOT by itself explain a flagged position
whose direction, one-sidedness, or timing runs OPPOSITE to -- or is simply unsupported by -- that
public information. Judge whether the SPECIFIC flagged pattern (its direction and concentration),
not merely the surrounding activity, is accounted for by public information.

- If a public catalyst specifically accounts for the flagged pattern (its direction included), the verdict is EXPLAINED.
- If nothing public accounts for the flagged pattern -- including cases where public info explains the volume but not the flagged direction/concentration -- the verdict is UNEXPLAINED.
- If the evidence is weak, partial, or you are genuinely uncertain, the verdict is AMBIGUOUS.

Constraint: reason ONLY from the dossier below plus general knowledge that was already true
before the cutoff. You have no web access and no knowledge of how the market(s) resolved or of
anything that happened after the cutoff; do not guess.

================= BEGIN PRE-CUTOFF DOSSIER =================
# Pre-cutoff public dossier — YouTube channel-metric markets, as of 2025-09-20 00:00 UTC

**Curation method:** Every item was public before the cutoff. Basis labeled per item: **(P)
published** = publicly available before the cutoff; **(D) detector observation** = the flagged
trading pattern itself, as a surveillance system would surface it from market data. This dossier
is FACTS ONLY. Nothing post-cutoff and no statement of any investigation outcome is included.

---

## 1. The markets

*(P) Public market listings.*
- Event contracts exist on the content and performance metrics of major YouTube channels — e.g.
  whether a specific video is released in a window, what a video will contain or feature, and
  view-count thresholds within fixed periods after release.
- These are small, narrow, single-name markets: modest volume, thin order books, a handful of
  active traders per contract.
- Contracts on unlikely-seeming outcomes (specific content details, aggressive view thresholds)
  trade at low YES prices (roughly 5-25c).

## 2. The channel

*(P) General public knowledge.*
- The channel in question is among the largest on YouTube, publishing high-production videos on a
  roughly weekly cadence to well over 100 million subscribers.
- Video topics, stunts, guests, and release timing are planned by a production team and are not
  announced in advance beyond occasional public teasers by the channel's owner.
- Video performance (views in the first days) varies substantially by topic and is the subject of
  public fan speculation and analytics-site tracking (e.g. Social Blade).

## 3. The flagged trading pattern

*(D) Detector observation from market data over Aug-Sept 2025.*
- One account repeatedly bought low-priced YES contracts in these channel-metric markets shortly
  before the resolving videos were released.
- Across the account's positions in this narrow set of related markets during the window, the
  account's contracts resolved in its favor with a near-perfect win rate, including multiple
  contracts entered below 25c.
- The positions were established before the resolving information (video content/release/early
  performance) became public in each instance.

## 4. The account holder's public footprint

*(P) Public professional records (employment/credit listings) before the cutoff.*
- The account holder is publicly identifiable as a video editor who works on content for the same
  channel the contracts reference.

## 5. Base rates

*(P) Definitional.*
- A contract trading at 10-25c implies the market assigns roughly a 10-25% probability to YES; a
  long run of such contracts all resolving YES is improbable under market-implied odds unless the
  buyer has systematically better information or judgment than the market.
- Public fan speculation about upcoming videos exists (subreddits, fan accounts), of varying
  accuracy; occasional official teasers precede some videos.

---
**Not included:** anything from after 2025-09-20; any statement about an investigation, sanction,
or how the flagged account was later handled.

================== END PRE-CUTOFF DOSSIER ==================

After your reasoning, end your reply with a single JSON object on its own line, and nothing after
it, in exactly this shape (no markdown fencing):
{"verdict":"EXPLAINED"|"UNEXPLAINED"|"AMBIGUOUS","rationale":"...","sources":["dossier section or fact you relied on", ...]}
```