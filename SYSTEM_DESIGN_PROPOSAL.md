# System Design Proposal — Insider-Flow Follower for Kalshi

**Version:** 0.3 (Phase-1 as-built sync, 2026-07-09)
**Date:** 2026-07-04 (v0.1) · 2026-07-09 (v0.2, v0.3)
**Author:** Claude (for Eamon)
**Stack:** TypeScript / Node.js
**Capital assumption:** $1k–$10k live bankroll
**X API budget:** $1.00 per candidate bet (~200 post reads at $0.005/read, pay-per-use pricing)

---

## 0. What changed in v0.2 (the core pivot)

A fresh-review pass surfaced ten findings; the load-bearing ones forced one structural change that cascades through the whole document. **This section is the map; the details live in the sections named.**

**The pivot — from a causal claim to an empirical one.** v0.1 made a claim it could never verify: *"this anomaly **is** an insider, so follow it."* That framing has two fatal flaws: (1) the make-or-break posterior — P(informed ∧ right | anomaly ∧ unexplained) — was never estimated, and the cited evidence (ForesightFlow) measures the *reverse* conditional on cases *already known* to contain an insider (§1.3); and (2) "no public explanation found" was used as positive proof of an insider, which is an **argument from ignorance** — it's equally consistent with a whale, a manipulator, obscure-but-public info, or thin-market noise (§6).

v0.2 **stops trying to identify insiders.** The testable edge becomes:

> **Conditional on {math-anomaly ∧ investigator-features ∧ market-stratum}, does the market's terminal move in the flow direction have positive expectancy *after fees*?** — measured on resolved markets.

"Insider trading" is retained as the **motivation and prior** — it's *why* such drift plausibly exists and *where the scanner looks* (§7) — but it is no longer the claim under test. This one move:

- **dissolves the argument-from-ignorance (#2):** UNEXPLAINED is demoted from a betting-gateway verdict to *one feature among several*, weighted by whatever the data says.
- **reframes the base-rate problem (#1):** we measure realized edge directly instead of an unobservable P(insider).
- **gives us real ground truth (#7):** the outcome of a resolved conditional bet, not an unobtainable insider label.
- **turns almost every other finding from an unresolvable assertion into a measured quantity** (see §5.4, §8, §10, §12).

**Consequences threaded through the doc:**
- Detectors are now **candidate features in a jointly-fit drift-prediction model**, not independent "votes" (§5.4, resolves #3).
- The certainty 0–5 becomes a **predicted post-fee-drift score** with weights *calibrated on outcomes*, validated monotone in realized drift (§6.2).
- Validation is a **cheap→expensive falsification ladder with kill-gates**: retrospective for the math signal, forward paper for the investigator's marginal lift (§10, resolves #7).
- Manipulation defense rides on the reframe (manipulation-heavy strata fail the positive-drift bar) plus size caps + a non-stationarity auto-suspend; **never-fade is kept but reframed as *selective abstention*** (§8, §12, resolves #5).

---

## 0.1 Implementation status & as-built deltas (v0.3)

**What is built (Phase 1 — the retrospective kill-gate only):** a batch tool that replays resolved Kalshi markets and emits a **PASS / KILL / INCONCLUSIVE** verdict. Code in `src/` (kalshi data layer, math detectors, detection, expectancy, replay/verdict), 88 tests, run via `npm run replay`. Repo `github.com/emcnamee-bs/InformedTrading`, branch `phase1-kill-gate`, **draft PR #1**. **88/88 tests, `tsc --noEmit` clean, data layer verified against live Kalshi.**

**What is NOT built yet (still design-only):** the AI explain-away investigator (§6), the market scanner / insider-proneness rubric (§7), the betting engine (§8), position manager, Postgres/TimescaleDB (Phase 1 uses a JSONL file cache — no DB), the dashboard, forward paper-logging (Phase 2), and all live trading (Phase 3). **Phase 2/3 are gated on the Phase-1 gate PASSing on real markets.**

**As-built deltas from the vision below — these SUPERSEDE the inline text in §3, §5, §7, §8, §10 where they differ:**
- **Strata = `series_ticker × volume band`, not `category × liquidity band`.** The live `/markets` object has no `category` and its `liquidity_dollars` is deprecated ("0.0000"), so we derive the series from `event_ticker` (prefix before the first `-`) and band by traded `volume_fp` (thin <1k, mid <10k, else deep — first-pass, tunable). Partial-pooling calibration (#10) deferred to Phase 2.
- **Control baseline is direction-matched**, not always-YES: at non-anomaly windows the control bets the local move direction (CUSUM dir if it fired, else the sign of the window's price change), so "anomaly beats control" measures real incremental edge.
- **Multiple-comparisons correction = one-sided Bonferroni** over the decidable-stratum family (`invNormCDF`; the verdict reports `strataTested`), so a single lucky stratum can't flip the run to PASS.
- **Live Kalshi data-layer facts (verified vs docs.kalshi.com):** candlesticks REQUIRE `start_ts`/`end_ts`/`period_interval` (1|60|1440; default 60); prices arrive as `*_dollars` strings → ×100 to cents; sizes are `*_fp` strings; trades use `taker_outcome_side` (`taker_side` deprecated); `/markets` and `/markets/trades` paginate via `cursor`; `close_time` is ISO → unix.
- **Mid-price fallback:** no-trade candle periods return a null last-trade price, so the price series falls back to the order-book mid `(yesBid+yesAsk)/2` (keeps the detector series continuous; realized drift still uses bid/ask).
- **Horizon filter lives in the replay:** an observation is recorded only if the market resolves within **31 days** of entry (enforces the §8.1 time gate). Return bar stays **≥ 5% net-of-fee**.
- **Synthetic data is unit-test-only**; all edge evidence comes from real resolved markets (§10).

*(All Phase-1 build decisions are also logged in `.superpowers/sdd/progress.md`.)*

---

## 1. Overview

An automated trading system that monitors Kalshi prediction markets for price/volume patterns consistent with informed ("insider") trading, uses AI to rule out public-information explanations for those patterns, and — **on the market-strata where the combination has empirically demonstrated positive post-fee expectancy** — places bets in the same direction as the flow.

The system never uses non-public information itself. It reads only publicly available market data (Kalshi's public API) and publicly available news/social content. **v0.2 framing:** it does *not* assert that any given anomaly is an insider. It measures whether markets exhibiting a given anomaly-plus-investigation signature *drift favorably to resolution as a population*, and trades that measured edge. The insider hypothesis motivates where to look; the ledger of resolved outcomes decides what to trade. (Note: I'm not a lawyer; this design assumes your legal read is correct, but see §12 for compliance risks worth checking — Kalshi ToS and market-manipulation rules, not just insider-trading law.)

### 1.1 Goals

- **Per-bet return target:** ≥ ~5% expected return per bet placed, with the market resolving in ≤ 1 month — where "expected return" means the **measured net-of-fee terminal drift** of the stratum the bet belongs to (§8.1), not a modeled insider-move estimate.
- **Baseline to beat:** ~7%/year passive ETF return. A modest hit rate on 5%+ bets resolving inside a month clears this easily; the constraint is signal quality, not return math.
- **Category-agnostic *detection*, category-aware *calibration* (revised, #10).** The scanner's insider-proneness rubric scores *mechanism*, not category, and stays category-agnostic. But expectancy calibration is *not* category-agnostic — leakage shape, liquidity, fee bite, and catalyst-search difficulty differ enormously by category. Calibration uses **hierarchical partial pooling**: a global prior (all categories) shrunk toward per-category estimates as each category accrues sample, so the system can act on the global estimate early and specialize as data grows.
- **Graduated conviction:** bet size scales with the **predicted post-fee-drift score** (the re-grounded 0–5, §6.2) — 0% of the per-bet allotment at 3/5, scaling to 100% at 5/5.

### 1.2 Non-goals (v1)

- No market making, no arbitrage across platforms. **We only follow flow, never fade it** — but "never-fade" is a *selective-abstention* rule, not a compulsion to always act (see §8.4 and #5): the defense against manipulation and thin signal is *not following*, not taking the other side.
- No sub-minute latency. Kalshi's finest candlestick is 1 minute; we design around minutes-scale reaction, not HFT.
- No fully autonomous live trading at launch — the rollout is a staged falsification ladder ending in small live bets only on strata with measured-positive expectancy (§10).
- No bespoke manipulation-vs-insider classifier in v1 — the empirical framework plus size caps and auto-suspend cover it (§12); revisit only if the data demands it.

### 1.3 Why this can work (evidence base — as prior, not proof)

Insider trading on prediction markets is documented, not hypothetical: a US Army soldier was charged after making ~$400k on Polymarket using confidential operational knowledge; nine accounts made $2.4M on US-military-action markets ahead of events; the House Oversight Committee opened a probe into Kalshi and Polymarket in May 2026; and Kalshi itself now maintains a market-level insider-risk scoring system and collects employment info for "heightened risk" markets. Academic work (ForesightFlow, §5.3) finds that in documented insider cases a large fraction of the eventual "information move" is priced in *before* the public news event.

**How v0.2 uses this evidence (important caveat).** ForesightFlow measures P(leakage | *known* insider) — a conditional computed on episodes already labeled as containing an insider. That is the **reverse** of the operational quantity (P(favorable drift | anomaly we detected)), and it says nothing about the base rate of true episodes among the anomalies we'll actually flag. So this evidence is treated as a **prior/motivation** — it justifies believing exploitable drift *might* exist and tells the scanner where to look — **not** as a measurement of our edge. Our edge is whatever the resolved-outcome ledger says it is (§10). The core economic trade-off remains: by the time flow is detectable, part of the move has happened; we are trying to harvest the *remainder* (detection→resolution) — and in v0.2 that remainder is **measured directly** (§8, resolves #9), not assumed.

### 1.4 Operating model (v1) — attended runs from a MacBook

v1 is **not** a 24/7 cloud service. It runs from the operator's **MacBook for bounded, attended (or semi-attended) periods**, matching the phased rollout (§10). While running, the loop is:

1. **Scan.** The bot scans Kalshi markets for price/volume signatures consistent with informed trading (the detection engine, §5), narrowed to the plausible universe by the scanner (§7).
2. **Explain-away.** For each flagged move, the investigator (§6) checks the web, official sources, and X for **readily-available public information that would explain the move**. If a public catalyst is found, the move is `EXPLAINED` and no bet is placed.
3. **Decide & bet.** When no public explanation is found *and* the move's stratum carries measured positive post-fee edge (the empirical framing, §0/§10), the AI places a bet in the flow direction — subject to all §8 gates (≥ 5% net-of-fee expected return, resolution ≤ 1 month, liquidity/exposure caps).

This "run it from my laptop for a while" model is deliberate for v1: it keeps operating cost near zero (§11), keeps a human within arm's reach of the kill switch (§8.4), and fits the ≤ $1/alert X budget (§6, §11). Always-on hosting is a later concern, out of v1 scope. *(Honesty note, per §0: "no public explanation left" is a gate/feature, not proof of an insider — the bet fires on the stratum's measured edge, not on an assertion about who traded.)*

---

## 2. High-level architecture

```
                        ┌────────────────────────────────────────────────┐
                        │                  SCHEDULER                     │
                        │        (node-cron / BullMQ job queues)         │
                        └──┬──────────────┬───────────────┬──────────────┘
                           │              │               │
                 ┌─────────▼───────┐ ┌────▼─────────┐ ┌───▼───────────────┐
                 │ 1. MARKET       │ │ 2. INGESTION │ │ 3. DETECTION      │
                 │    SCANNER      │ │    SERVICE   │ │    ENGINE         │
                 │ (AI selects     │ │ (Kalshi API  │ │ (candidate        │
                 │  insider-prone  │ │  candles,    │ │  drift-predictive │
                 │  markets)       │ │  trades, OB) │ │  features)        │
                 └─────────┬───────┘ └────┬─────────┘ └───┬───────────────┘
                           │              │               │ alert: candidate
                           │   watchlist  │  time series  │ drift signal
                           ▼              ▼               ▼
                 ┌────────────────────────────────────────────────────────┐
                 │                  POSTGRES + TIMESCALEDB                │
                 │  markets · candles · trades · alerts · investigations  │
                 │  positions · decisions · expectancy_strata · config    │
                 └──────────────────────────┬─────────────────────────────┘
                                            │ alert rows (fired AND not-fired)
                           ┌────────────────▼────────────────┐
                           │ 4. EXPLAIN-AWAY INVESTIGATOR    │
                           │  (AI agent: web search, official│
                           │   sources, X API ≤$1/bet)       │
                           └────────────────┬────────────────┘
                                            │ verdict + drift-score features
                           ┌────────────────▼────────────────┐
                           │ 5. BETTING ENGINE               │
                           │  (measured-drift EV gate ≥5%,   │
                           │   tiered sizing, ≤1-mo filter,   │
                           │   Kalshi order API / paper mode)│
                           └────────────────┬────────────────┘
                                            │ orders + fills
                           ┌────────────────▼────────────────┐
                           │ 6. POSITION MANAGER + MONITOR   │
                           │  (exits, resolution tracking,   │
                           │   P&L, per-stratum drift        │
                           │   re-measure + auto-suspend,    │
                           │   dashboards, kill switch)      │
                           └─────────────────────────────────┘
```

All six components are independent TypeScript services (or modules within one process in v1) communicating through the database and a lightweight job queue. This lets us run components 2–3 alone against historical data in phase 1 without touching the rest. **New in v0.2:** every alert is logged whether or not it becomes a bet (fired *and* not-fired), because the expectancy estimate is a property of the *whole stratum*, and betting only on the subset we act on would inject selection bias (§10).

---

## 3. Data model

### 3.1 Core observation: the candle

You asked for data points containing **date, rate, identifier** and whether anything else is needed. Yes — the detection models fundamentally require **volume** and benefit strongly from **open interest** and **bid/ask**, all of which Kalshi's candlestick endpoint already provides. Price moves alone cannot distinguish "informed trader accumulating" from "thin market drifting on noise"; volume-conditioned models (VPIN, order-flow imbalance) are the backbone of the academic detection literature.

```ts
interface Candle {
  marketTicker: string;      // identifier, e.g. "KXCABINET-26-RFK"
  seriesTicker: string;      // parent series, needed for the API path
  endPeriodTs: number;       // unix seconds — the "date"
  periodMinutes: 1 | 60 | 1440;
  price: { open: number; high: number; low: number; close: number; mean: number | null };
                             // the "rate": YES price in cents (1–99)
  yesBid: { open: number; high: number; low: number; close: number };
  yesAsk: { open: number; high: number; low: number; close: number };
  volume: number;            // contracts traded this period  ← required for detection
  openInterest: number;      // outstanding contracts          ← position accumulation signal
}
```

### 3.2 Individual trades (tape)

For markets on the active watchlist we also pull the trade tape (`GET /markets/trades`, verified against the live docs): `{trade_id, ticker, yes_price_dollars, no_price_dollars, count_fp, taker_side, taker_book_side, created_time}`. The signed taker side gives us signed order flow without needing a trade-classification algorithm — a luxury equity-market researchers don't have, and it makes VPIN/imbalance calculations exact rather than estimated. *(As-built §0.1: the live field is `taker_outcome_side`; `taker_side` is deprecated.)* *(Caveat, #18: takers include noise/liquidity-demanding traders too, so signed taker flow is a direction hint, not proof of informed direction — it earns its weight only by measured drift-lift, §5.4.)*

### 3.3 Supporting tables

- `markets` — ticker, series, category, title, rules summary, open/close/expected-resolution time, Kalshi liquidity metrics, our scanner's insider-proneness score and rationale, **and the stratum keys** (liquidity band, proneness band, category) used for expectancy calibration (#6, #10).
- `alerts` — one row per detection trigger, **fired or not**: marketTicker, triggerTs, direction (yes/no), per-feature outputs, composite drift score, status (`new → investigating → confirmed | explained | expired`), **and whether a bet was placed** (for selection-bias-free expectancy estimation).
- `investigations` — the AI's explain-away work product: sources searched, X spend, findings, verdict, the derived features (not a truth-verdict), full reasoning transcript (auditability matters if this ever gets scrutinized).
- `decisions` / `positions` / `fills` — what we bet, why, sizing math, **realistic entry price incl. spread crossing** (#9), resolution outcome, realized P&L.
- `expectancy_strata` — **new in v0.2.** Per stratum (features × liquidity/proneness band × category): count of resolved observations, measured net-of-fee terminal drift, dispersion, significance, last-re-measured timestamp, and suspended-flag (§8.4 auto-suspend).
- `synthetic_runs` — backtest bookkeeping. **Demoted in v0.2:** synthetic data is used for *detector unit tests only* (does the CUSUM implementation fire on a known step?), **not** for edge validation — self-labeled synthetic data would make the edge test circular (#7). Edge validation uses real resolved markets (§10).

**Storage:** Postgres with TimescaleDB hypertables for `candles` and `trades`. At 1-min resolution, 500 watched markets ≈ 720k candle rows/day — trivial for Timescale, and continuous aggregates give us 1h/1d rollups for free.

---

## 4. Ingestion service (Kalshi data plane)

- **REST poller** for discovery and backfill: `GET /markets` (paginated, cursor), `GET /series/{series}/markets/{ticker}/candlesticks` (1/60/1440-min periods), `GET /markets/trades`, `GET /markets/{ticker}/orderbook`. Batch candlesticks endpoint (up to 10k candles per call) for efficient watchlist refresh.
- **Historical backfill** for Phase 1: `/historical/markets/{ticker}/candlesticks` and historical trades over resolved markets — this is the substrate for the retrospective math kill-gate (§10).
- **WebSocket subscriber** (`wss://api.elections.kalshi.com/trade-api/ws/v2`) for `ticker`, `trade`, and `orderbook_delta` channels on the *hot* subset of the watchlist (markets with a live alert or high scanner score). WS gives sub-minute reaction where polling would lag.
- **Rate-limit governor:** Kalshi uses a token-cost budget system with 429s on breach. A single shared token-bucket module wraps every request; exponential backoff with jitter on 429; watchlist polling frequency degrades gracefully (hot markets 1-min, warm 15-min, cold hourly) to stay inside budget.
- **Environments:** identical client pointed at prod (`api.elections.kalshi.com`) or demo (`demo-api.kalshi.co`) via config — the demo environment is our phase-2 paper-trading target.
- **Historical / synthetic adapter:** the ingestion service exposes a `MarketDataSource` interface; a `HistoricalSource` replays resolved-market history through the exact same pipe (phase-1 requirement), and a `SyntheticSource` feeds hand-built fixtures to the *detector unit tests only*. Detection code cannot tell the difference.

---

## 5. Detection engine (candidate drift-predictive features)

**Reframed for v0.2 (#3).** These are no longer "three independent detector families that vote for insider." They are **candidate features** for a jointly-fit model that predicts post-fee terminal drift. Each catches a different mathematical signature of a fast move on one-sided volume — but because they all key off *that same underlying event*, their errors are correlated, so they are **not** treated as independent votes. Each feature earns its place only by **measured out-of-sample marginal lift** in predicting drift (§5.4); redundant features are pruned. We may ship fewer than the full menu below.

**Per-feature guardrails (new, #4).** Every feature declares a **volume/history floor**; when a market lacks the volume or trailing baseline the feature needs, the feature **abstains (emits null)** rather than emitting noise. For **cold-start** markets (little history — where insiders often trade *early*), features use a **category/peer-market prior** as the baseline for the first window, flagged lower-confidence, rather than abstaining entirely and forfeiting the signal.

### 5.1 Feature group A — Price-jump / regime-change

Catches: the *footprint* of a large directional trader moving price.

- **CUSUM (Page 1954, quickest-detection variant):** cumulative sum of standardized price innovations; fires when drift exceeds threshold. Cheap, online, well-understood false-alarm rate (ARL theory). Good first tripwire.
- **Bayesian Online Changepoint Detection (Adams & MacKay 2007):** maintains a posterior over "run length since last regime change" per market. Output is `P(changepoint in last k bars)`, which slots directly into the drift model.
- Both run on **log-odds transformed prices** (`ln(p/(1−p))`), not raw cents — a 5¢ move at 50¢ is noise, at 93¢ it's an event. This also naturally handles the bounded [1,99] price domain and its heteroskedasticity near the edges (#4).

### 5.2 Feature group B — Order-flow / microstructure

Catches: directional *accumulation*, even before price moves much.

- **VPIN (Easley, López de Prado, O'Hara 2011):** volume-synchronized probability of informed trading. Kalshi's `takerSide` field makes classification exact. Subject to the volume floor above — on thin contracts where VPIN's buckets can't fill, it abstains. Its known criticisms (mechanical correlation with trading intensity) are moot here: it either earns drift-lift as one feature or is pruned.
- **Order-flow imbalance + volume anomaly:** z-score of signed volume vs. that market's own trailing baseline, and open-interest delta (rising OI + one-sided flow = new positions being built, not existing holders exiting).
- **Trade-size fingerprint:** documented prediction-market insider cases show distinctive tape patterns (aggressive taker orders, size far above market norm). We proxy this with tape statistics: max trade size percentile, taker-side run lengths, sweep-the-book events from orderbook deltas.
- **Scheduled-catalyst proximity (new, #5).** Distance (in time) to the market's *known upcoming resolution event* (nomination date, ruling/earnings window, scheduled announcement). Genuinely **orthogonal** to the move-on-volume features: real informed flow clusters in the days before a known event, whereas untethered manipulation has no reason to. One of the few features that helps separate the profitable hypothesis from the manipulation hypothesis.
- *(Deferred to v2: full PIN maximum-likelihood estimation — heavier, offline, adds little over VPIN + exact takerSide at our scale.)*

### 5.3 Feature group C — Information-leakage scoring (ForesightFlow ILS)

Catches: the characteristic *shape* of pre-news pricing — **as a candidate feature, and as a calibration reference.**

The 2026 ForesightFlow framework (Nechepurenko, arXiv:2605.00493) defines an **Information Leakage Score**: the fraction of a market's terminal information move priced in before the public news event. Validated against eight documented Polymarket insider episodes (the FFIC inventory).

- **As a feature:** an online "pre-news pricing" estimate enters the drift model like any other candidate and must earn its weight by marginal lift (#3). **Demoted from v0.1:** it is *not* the EV estimator anymore (that was the circular n=8 path, #8).
- **As a reference set:** FFIC's eight labeled episodes remain a useful *sanity check* on the detectors, but with an explicit caveat (#7, #12.5) — n=8, Polymarket (on-chain per-account), a different data regime than Kalshi's tape-only feed. Not a substitute for measuring drift on real resolved Kalshi markets.

### 5.4 Composite: a jointly-fit drift-prediction model (was "composite math score")

**This is the biggest §5 change (#3).** v0.1 summed per-detector scores (`S = w_A·… + w_B·… + w_C·…`), which double- and triple-counts collinear detectors — "3/3 agreement" among features that are really one phenomenon *looks* like strong independent evidence but is a single observation. That miscalibrates confidence.

v0.2 fits a **single joint model** that maps the feature vector → predicted net-of-fee terminal drift (and its uncertainty). Collinear features share credit automatically; redundant ones get pruned by regularization.

- **Fitting strategy (from #3, adapted to sparse data):** a **small, deliberately de-correlated feature set** + regularized joint fit. The **math-family features are fit on abundant retrospective history** (Phase 1); the **investigator feature is sparse and forward-only**, added with heavy regularization and **cross-category partial pooling** (#10) to avoid overfitting.
- **Feature selection = measured marginal lift.** A feature stays only if it improves out-of-sample drift prediction beyond the others. Start with a simple, interpretable form (e.g. regularized logistic/linear on a handful of features); add complexity only if it earns out-of-sample lift.
- **Output:** a predicted drift + uncertainty per candidate alert. `predicted_drift ≥ θ_alert` (tuned for high recall) creates an `alert` row and wakes the investigator. Precision is not asserted by the math layer; it is *measured* downstream by resolved outcomes. Every alert records **direction** (the side the flow is buying) — the side we would follow if the stratum pays.

---

## 6. Explain-away investigator (the AI layer)

The critical filter: a price move that the model flags as drift-predictive is *more* tradeable if **no public information explains it** — but v0.2 treats this as a **feature that must earn its weight**, not as proof of an insider (#2). If public info explains the move, the edge is likely gone (the market is just reacting to news faster than us). If nothing public is found, that is *one input* raising the predicted drift — its actual weight is whatever the resolved-outcome data says (§10, claim 2).

### 6.1 Pipeline (per alert, fully automated)

1. **Context assembly:** market title, rules, category, the alert window (move size, direction, volume profile), and the market's scanner dossier (§7) which pre-identifies *who would know* and *which sources would publish*.
2. **Tier 1 — broad news search** (cheap, always): web search over the alert window ± a few hours: market subject keywords, entity names from the dossier. Google News/RSS-first, no per-query cost.
3. **Tier 2 — official sources** (targeted): the dossier lists official channels for the TargetTopic (agency press pages, court dockets, league injury reports, company IR pages, government schedules). Fetch and diff against last-seen state.
4. **Tier 3 — X search** (metered, ≤ **$1.00/alert ≈ 200 post reads**): the dossier maintains a ranked list of directly-associated X accounts. Budget: ~10 top handles × last ~15 posts (≈150 reads) + one keyword recent-search page (≈50 reads). Reads are deduplicated within a 24h UTC window under X's pay-per-use pricing. Hard spend cap enforced in code; if the cap is hit, the investigator renders its features with what it has.
5. **Verdict → features (LLM, e.g. Claude API):** given the move and all retrieved content, produce features, not a truth-claim:
   - `EXPLAINED` — public catalyst found that predates/accompanies the move → alert closed, no bet, **logged as a negative example** for the drift model.
   - `UNEXPLAINED` — thorough search found nothing → contributes the "no-public-explanation" feature (weight learned, not assumed).
   - `AMBIGUOUS` — weak/partial explanation → re-check on a timer.

**Honest limit of this filter (#2, #7, #12.1).** "UNEXPLAINED" means *we did not find a public explanation* — confounded by search quality, non-English/obscure sources, and public-but-hard-to-find info. That is precisely why v0.2 does not treat it as proof: its predictive value is measured, and if UNEXPLAINED adds no drift-lift over the math features, it gets down-weighted.

**Timing tension (noted, #8-adjacent).** The AMBIGUOUS re-check ("persistence upgrades") consumes time, during which more of the move can happen — eroding the residual we're trying to capture. The drift model is fit on *realistic entry timing* (§8), so this erosion is measured, not wished away.

### 6.2 Predicted-drift score (0–5) — the betting input (re-grounded)

**Re-grounded in v0.2 (#1, #2).** The 0–5 is no longer "how sure we are it's an insider." It is a **predicted post-fee-drift score** — a monotone mapping of the jointly-fit model's output — whose weights are **calibrated against realized outcomes**, and which **must be validated monotone in realized drift** (§10, claim 3) before it gates real money.

The v0.1 hand-set table (math 0–2, unexplained +2, corroboration +1) survives **only as an explicit cold-start prior**, flagged as unvalidated, and is replaced by fitted weights as resolved data accrues:

| Component (cold-start prior only) | Contribution |
|---|---|
| Composite drift-model output | 0–2 points (scaled) |
| Investigation: UNEXPLAINED after full 3-tier search | +2 (feature; re-weighted by data) |
| Corroboration: signal persists/strengthens on re-check ≥30 min later; OI still rising; no reversal | +1 (feature; re-weighted by data) |

A second LLM pass acts as adversarial reviewer ("what's the most plausible innocent explanation, and did we actually rule it out?") before any score ≥4 is finalized. Every investigation transcript is stored.

---

## 7. Market scanner (AI target selection)

Runs daily (and on new-market listings). Purpose: build the watchlist of markets where informed drift *could plausibly occur*, so the detection engine watches hundreds of markets, not thousands.

**Insider-proneness rubric** (LLM-scored per market, using title/rules/category + web context) — **kept category-agnostic** (scores mechanism, #10):

1. **Concentrated private knowledge exists** — a small identifiable group knows the outcome early (nominations, personnel decisions, corporate announcements, military/operational actions, regulatory rulings, awards). Contrast: weather, aggregate econ statistics with strict embargo protocols — low proneness.
2. **Discrete resolution event** ≤ 1 month out (the holding-period constraint, applied at selection time).
3. **Liquidity band → a stratum dimension, not a hand-set filter (#6).** v0.1 asserted a market must be "liquid enough to enter but not so deep flow is invisible" — but never showed that band is non-empty. v0.2 records **liquidity and proneness as stratum keys** and lets Phase 1 *measure* which bands actually pay after fees. If no band is both enterable-at-size and drifting, that is a legitimate **kill-finding**, surfaced honestly — not papered over.
4. **Kalshi's own heightened-risk designation** — where visible, free confirmation of proneness.
5. **Dossier construction** — for each selected market the scanner writes the investigation dossier: who would know, which official sources would publish, which X handles to watch. Doing this *at selection time* (not alert time) is what makes the $1/alert X budget sufficient — the expensive thinking is precomputed. Dossiers are refreshed weekly for active markets (handle lists rot, #12.6).

Output: `markets` rows with proneness score, stratum keys, dossier, and polling tier. Human-reviewable via dashboard before phase 3.

---

## 8. Betting engine

### 8.1 Entry gates (all must pass)

1. Predicted-drift score ≥ threshold (>3.0/5 — below that, allotment fraction is 0 anyway).
2. **EV gate — measured, not modeled (#8, #9).** Expected return ≥ 5% *after fees and spread*, where the expectation is the **stratum's measured net-of-fee terminal drift** (from `expectancy_strata`), computed **from a realistic entry price (crossing the spread) to resolution** — not from a modeled insider-move target. Kalshi fees (formula-based per contract, `0.07 × p × (1−p)` rounded up — highest near 50¢, so verify the exact current fee schedule per series at build time) are **baked into the measured drift**: because the fee peaks where uncertain binaries trade, the gate naturally rejects mid-price contracts unless measured drift is large.
3. **Stratum-eligibility gate (new).** The stratum must have (a) enough resolved observations for significance and (b) a **positive, non-suspended** measured drift (§8.4). No measured edge → no bet (selective abstention).
4. **Time gate:** expected resolution ≤ 1 month.
5. **Liquidity gate:** our order ≤ N% of visible book depth (no self-impact, no signaling).
6. **Exposure gates:** max % of bankroll per market, per category, and total-at-risk cap. **Anti-manipulation rationale (#5):** caps are also sized to keep any single position *below the "worth-manipulating" threshold* — small enough that a manipulator can't recover their manipulation cost from our capped exit liquidity.

### 8.2 Sizing — tiered-conviction, made continuous

Per-bet allotment `A` = bankroll × per-bet fraction (default 5% of bankroll → $50–$500 at your capital range). Fraction of `A` deployed scales with the predicted-drift score `c`:

```
stake(c) = A · clamp((c − 3) / 2, 0, 1)      // 3/5 → 0%, 4/5 → 50%, 5/5 → 100%
```

Then capped by **fractional Kelly** (¼-Kelly on the *measured* stratum edge) so a miscalibrated 5/5 can't overbet: `stake = min(stake(c), 0.25 · kelly(drift̂, price) · bankroll)`.

Entries are **limit orders** at or inside the ask, never market sweeps; unfilled after a timeout → re-evaluate (the move may have run away — chasing violates the EV gate). Fill price (incl. spread crossing) is recorded and is the anchor for drift measurement (#9).

### 8.3 Exits

Default is hold-to-resolution (that's where the 5%+ comes from and resolution is ≤1 month by construction). Early-exit triggers: **score downgrade** (news later explains the move → EXPLAINED → exit at best price), **target-capture** (price reaches ~fair value early — e.g. 97¢ on a 30-day market: sell, recycle capital), and a **hard reversal stop** if price reverses through the pre-alert level with the same volume signature the other way (we followed noise or got faded by a bigger trader — a primary manipulation backstop, #5).

### 8.4 Modes, circuit breakers, and auto-suspend

- **Modes:** `paper` (historical/demo — logs virtual fills), `demo` (real orders on demo-api.kalshi.co), `live` (real money; requires per-deploy human arming of the kill switch, plus daily-loss and total-drawdown circuit breakers that flip the system back to paper automatically).
- **Selective abstention (#5).** "Never-fade" does not mean "always follow." When no stratum is eligible (§8.1 gate 3), the correct action is *no trade*. Not-following is the primary defense against both thin signal and manipulation.
- **Non-stationarity auto-suspend (new, #5, #12.3).** The position manager continuously **re-measures realized drift per live stratum** and **auto-suspends** any stratum whose drift decays below the bar. This single mechanism defends both a *targeted, non-stationary manipulator* (who ramps up after a stratum calibrates positive) and *organic edge decay* (ForesightFlow is public research; Kalshi is actively countering insiders). The system degrades to "no bets" rather than "bad bets."

---

## 9. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Language/runtime | TypeScript on Node.js 22 LTS | Your pick; strict mode, ESM |
| Kalshi client | Official TS SDK (docs.kalshi.com/sdks) or thin custom client | Custom client keeps the rate-limit governor first-class; decide in ADR-001 |
| DB | Postgres 16 + TimescaleDB | Candles/trades hypertables; Prisma or Drizzle ORM |
| Jobs/queue | BullMQ (Redis) | Scheduler, alert fan-out, investigator jobs with retry |
| Feature/math layer | Custom TS implementations of CUSUM/BOCPD/VPIN + a small regularized drift model | Detectors are each <200 LOC; the joint model is a light regularized regression. Validate against Python reference implementations in tests |
| AI | Claude API (tool-use agent for investigator + scanner) | Transcripts persisted to `investigations` |
| X data | X API v2 pay-per-use, recent search + user timelines | Hard $1/alert cap in code; 24h dedup exploited |
| Web/news | Search API + direct fetch of dossier-listed official sources | |
| Dashboard | Small Next.js or plain Express+HTMX app | Watchlist, alerts (fired + not-fired), investigations, per-stratum drift, P&L, kill switch |
| Config/secrets | .env + typed config module; API keys never in repo | |
| Testing | Vitest; golden-file tests for detectors on synthetic fixtures (unit tests only) + real-history replay for edge validation | |

---

## 10. Rollout phases & validation (the falsification ladder)

**Restructured for v0.2 (#7).** Validation is a **cheap→expensive ladder of separately-falsifiable claims**, each with a kill-gate, using real resolved markets for the edge (synthetic is unit-test-only). Ground truth is **realized net-of-fee terminal drift**, and *every* alert (fired and not-fired) is logged to avoid selection bias.

**Phase 1 — Retrospective math kill-gate (next step).** Replay resolved Kalshi markets (`/historical` candles + trades) through the detection engine. **Claim 1: does the math-anomaly stratum drift favorably to resolution, net of fees?** This needs *no investigator* and is essentially free. **Kill-gate:** if math-anomaly strata show no post-fee drift, the thesis is dead and we've spent nothing on the AI layer. Deliverable: per-stratum drift distributions, `expectancy_strata` seeded with math-only strata, a replay CLI (`npm run replay -- --history <range>`), and threshold calibration. *(Synthetic data is used only to unit-test that each detector fires correctly on known fixtures.)*

**Phase 2 — Forward paper-logging with the faithful investigator.** Real Kalshi public data, full pipeline including the *point-in-time* investigator (no hindsight-leakage — the hard-to-backtest feature is measured forward, live). Log every alert (fired + not-fired); paper/demo bets. Run ≥4–6 weeks (longer if sample is thin — see throughput, §12). **Claim 2: does the investigator add marginal drift-lift over math alone? Claim 3: is the 0–5 score monotone in realized drift?** Success criteria: (a) per-stratum realized drift is positive and significant on the strata we'd bet; (b) the score's tiers are monotone in realized drift; (c) explained-alert rate is non-trivial (if ~0% of alerts are EXPLAINED, the investigator isn't filtering and thresholds are wrong). **Negative controls:** known public-news events (Fed decisions, announced rulings) must be marked EXPLAINED.

**Phase 3 — Live.** Real API key, real money, small per-bet allotment (2% of bankroll), circuit breakers + auto-suspend armed. **Bet only on strata with measured-positive, non-suspended, significant post-fee drift.** Scale allotment only after N≥20 resolved live bets confirm Phase-2 calibration.

Backtesting throughout uses real past markets with known outcomes as the out-of-sample set. **Overfitting guard:** hold out categories/time-periods; keep the feature set small and regularized (§5.4); prefer the global pooled estimate until a category has its own sample (#10).

---

## 11. Load, cost, reliability

- **Scale estimate:** ~200–500 watched markets; 1-min candles on ~50 hot markets + 15-min on the rest ≈ well inside Kalshi's free API budget. Storage growth ~1–2 GB/month. Single small VPS (or your machine) suffices; no horizontal scaling needed at this capital level.
- **X cost:** alerts are the cost driver. At an expected 1–5 investigator-escalated alerts/day, X spend ≈ $30–150/month worst case. Tier-1/2 searches are free, so X budget is spent only when cheaper tiers find nothing. **v0.2 note:** the Phase-1 kill-gate runs *before* any X spend, so we don't fund the AI layer until the base signal is confirmed.
- **Claude API cost:** scanner (daily batch) + investigator (per alert) ≈ low tens of $/month at these volumes.
- **Failure posture:** every component idempotent and resumable from DB state; missed candles backfilled on restart; the betting engine refuses to act on stale data (>2× polling interval old); all clocks UTC.

---

## 12. Risks & open questions (honest ledger — v0.2)

Findings from the fresh-review pass and how v0.2 handles them:

1. **Base-rate / posterior precision (#1) — RESOLVED by reframe.** We no longer need P(insider | anomaly); we measure realized post-fee drift per stratum directly (§10). Residual: the drift must actually be positive somewhere — Phase 1 is the honest test.
2. **"Unexplained = insider" argument from ignorance (#2) — RESOLVED.** UNEXPLAINED is a feature with a data-learned weight, not a verdict (§6).
3. **Detector non-independence (#3) — RESOLVED.** Joint drift model, marginal-lift feature selection, pruning (§5.4).
4. **Detector math vs. thin bounded Kalshi contracts (#4) — HANDLED.** Prune-by-lift decides what works; per-feature volume/history floors (abstain, don't emit noise); category-prior baseline for cold-start (§5).
5. **Manipulation / follow-never-fade (#5) — HANDLED.** Manipulation-heavy strata fail the positive-drift bar; size caps below the worth-manipulating threshold; non-stationarity auto-suspend; scheduled-catalyst-proximity feature; never-fade reframed as selective abstention (§8). No bespoke classifier in v1. Residual: a targeted non-stationary adversary faster than our re-measurement window — bounded, not eliminated.
6. **Liquidity band may be empty (#6) — MADE HONEST.** Liquidity/proneness are stratum dimensions; Phase 1 measures which bands pay; empty band is a valid kill-finding (§7, §8.1).
7. **No path to ground truth (#7) — RESOLVED.** Ground truth = realized net-of-fee drift on real resolved markets; synthetic demoted to unit tests; staged retrospective/forward validation (§10). Residual: FFIC (n=8, Polymarket) is a weak reference, not a Kalshi label set.
8. **EV circular / n=8-fragile / fee bite (#8) — RESOLVED.** EV = measured net-of-fee stratum drift; ILS demoted from EV-estimator to candidate feature; fee baked into the measured quantity (§8.1).
9. **Adverse selection / "harvest the remainder" (#9) — DISSOLVED.** The captured residual *is* the measured detection→resolution drift, anchored at realistic entry (spread-crossed) price (§8). A stratum where adverse selection eats the residual simply fails the bar.
10. **Category-agnostic vs. per-category (#10) — RESOLVED.** Category-agnostic detection, category-aware calibration via hierarchical partial pooling (§1.1, §5.4).
11. **Signal-vs-noise base rate.** Most detected moves are whales/hedgers/noise; the reframe means those just show up as strata with no positive drift and get filtered. Measurable in Phases 1–2; do not skip negative-control tests.
12. **Edge decay.** Detection research is public; Kalshi is actively countering insiders. The auto-suspend (§8.4) is the primary mitigation — degrade to "no bets," not "bad bets."
13. **Legal/ToS review needed (I'm not a lawyer).** Trading on public inference is generally lawful, but check: (a) Kalshi ToS on automated trading and API use; (b) CFTC rules on trading alongside suspected MNPI flow in event contracts (May 2026 congressional probe); (c) whether *reporting* detected episodes creates obligations. **v0.2 note:** the empirical reframe actually helps the framing here — the system's operative claim is "these market strata drift favorably," not "we detect and piggyback on specific insiders" — but this is a framing nuance, not legal cover. Worth an hour with a lawyer before phase 3.
14. **Kalshi vs. Polymarket detectability gap.** Kalshi's API gives no account-level data, so detectors are strictly tape-based — expect lower feature quality than the (Polymarket) papers report. Phase-1 calibration reflects this directly.
15. **Sample-size / throughput (new open item).** Category-aware, significance-gated per-stratum calibration is sample-hungry, and Phase-2 forward data is slow to accrue. Open: how many concurrent watched markets and what short-dated-market bias is needed to reach significance per stratum in an acceptable calendar window? Partial pooling (#10) and leaning on Phase-1's abundant history for the math features are the mitigations; do the throughput arithmetic before committing to a live date.
16. **Selection bias (new open item).** Expectancy must be estimated over fired *and* not-fired alerts; the logging and dashboards enforce this (§2, §3.3), but analysis discipline is required so we don't quietly condition on "bets we chose to place."
17. **Open decisions for the next session (ADR candidates):** official SDK vs. custom Kalshi client; single-process modular monolith vs. services from day one; BOCPD hazard/prior parameterization; exact per-bet allotment %; the joint drift-model's functional form and regularization; the stratum discretization (how to bin liquidity/proneness/category).

---

## 13. References

- ForesightFlow ILS framework — arxiv.org/abs/2605.00493; real-time variant SSRN 6687441; FFIC insider-case inventory (validation labels)
- Easley, López de Prado, O'Hara — VPIN / order-flow toxicity — SSRN 1695596, 1695041; criticisms: Andersen & Bondarenko (ScienceDirect S1386418113000189)
- Easley & O'Hara PIN model — frds.io/measures/probability_of_informed_trading
- Adams & MacKay (2007) Bayesian Online Changepoint Detection; financial applications ACM 3795154.3795291
- Quickest change-point detection for financial surveillance — arxiv.org/pdf/1509.01570
- Rothschild & Sethi (2016) — trader heterogeneity & manipulation, Intrade 2012 (J. Prediction Markets)
- Kalshi API docs — docs.kalshi.com (candlesticks, trades, orderbook, orders, historical, rate limits, demo env)
- Insider-trading context: CNBC 2026-05-22 (House Oversight probe); Al Jazeera 2026-06-10 (Kalshi employment disclosure + risk scoring); Forbes 2026-04-27 (first prediction-market insider case)
- X API pay-per-use pricing — docs.x.com/x-api/getting-started/pricing ($0.005/post read, 24h dedup)
- Partial pooling / hierarchical estimation — Gelman & Hill, *Data Analysis Using Regression and Multilevel/Hierarchical Models* (small-sample per-category calibration)

---

## Appendix — v0.2 change log

| # | Finding (severity) | Resolution | Sections |
|---|---|---|---|
| 1 | Bayesian base-rate never computed; evidence is reversed conditional (🔴) | Reframe to empirical conditional expectancy; measure drift, not P(insider) | §0, §1, §1.3, §10 |
| 2 | "Unexplained = insider" argument from ignorance (🔴) | UNEXPLAINED demoted to a data-weighted feature | §0, §6 |
| 3 | Detector families not independent (🔴) | Joint drift-prediction model; marginal-lift feature selection; pruning | §5.4, §5.1–5.3 |
| 5 | Follow-never-fade = manipulator bait (🔴) | Empirical self-defense + size caps + auto-suspend + catalyst feature; never-fade → selective abstention | §1.2, §5.2, §8.4, §12 |
| 7 | No path to real ground truth (🔴) | Realized drift on resolved markets; synthetic → unit tests; staged retrospective/forward ladder | §3.3, §10 |
| 4 | Detector math vs thin bounded contracts (🟡) | Prune-by-lift; per-feature volume/history floors; cold-start category prior | §5 |
| 6 | Liquidity band may be empty (🟡) | Liquidity/proneness as stratum dimensions; empty band = kill-finding | §7, §8.1 |
| 8 | EV circular / n=8-fragile / fee bite (🟡) | EV = measured net-of-fee stratum drift; ILS → feature | §8.1, §5.3 |
| 9 | Adverse selection / harvest-remainder unmeasured (🟡) | Dissolved — residual is the measured quantity; realistic-entry anchor | §8 |
| 10 | Category-agnostic vs per-category (🟡) | Agnostic detection, aware calibration via partial pooling | §1.1, §5.4 |
