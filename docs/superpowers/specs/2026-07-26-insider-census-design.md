# Insider Census — Design

**Date:** 2026-07-26
**Status:** Approved (brainstorming) → decompose into sub-projects, then writing-plans for Phase 1

## Goal / thesis

Verifying insider-trading anomalies *live*, one at a time, proved hard and unreliable. Instead,
mirror the proven **ai1 `census`** approach (in `Fast99Follower/agent/`): paper-trade at scale and
let **realized market outcomes be the label**. For every anomaly our detectors fire, open a 1¢
paper bet in the flagged direction, record it under a cell keyed by the *signal configuration*, and
settle it against the real market result. Over weeks, the cells whose paper trades **win far above
their implied price** are the insider signals actually worth trading. The unreliable AI
"explain-away" investigator drops out of the hot path entirely — outcomes do the labeling.

Resolved design forks (from brainstorming):
- **A — signal-triggered entries:** enter only when a detector fires (not census's every-market-side).
- **Reuse the spine, extended for history:** one poller hits Kalshi; all readers share `spine.db`.
- **Home 2 — TS census reading shared `spine.db`:** reuse the validated TS detectors as-is; no re-port.
- **Investigator OUT of the hot path:** pure detector + outcome. The cheap past-event pre-gate stays.

## Architecture (mirrors ai1 census; adds candle/trade history)

1. **Poller — extend the existing JS poller (`Fast99Follower/agent`).** It is already the *sole*
   Kalshi fetcher, writing per-ticker snapshots to the shared `spine.db` and populating the
   `settlement` feed. Extend it to also fetch + cache **recent candle + trade history** per watched
   market (new tables, e.g. `candles(ticker, period, ts, o,h,l,c, volume, ...)` and
   `trades(ticker, ts, price_cents, count, taker_side)`), on a cadence. This preserves the sacred
   **one-process-hits-the-API** rule that kept paper-scale CPU-bound, not rate-limit-bound (we
   previously hit Kalshi 429s doing our own bulk calls).
2. **Insider-census daemon — new TS, reads `spine.db`, writes its own `insider.db`.** Each cycle,
   over the watched universe: apply the cheap **past-event pre-gate** (ticker-date, already built);
   for each surviving market run the validated detector suite at the **medium** sensitivity config
   (our current validated `h`/tau defaults); when an anomaly fires on a market-side, open a **1¢
   paper entry** in the flagged direction, keyed by its cell, `INSERT OR IGNORE` (enter-once). No AI.
3. **Settlement.** Join `insider_open` to the spine's existing `settlement` feed. `won = (result ===
   side)`; `pnl = (won ? count*100 : 0) - entry*count`. Fold into permanent `insider_cell` rollups
   and a rolling `insider_raw` drill-down.
4. **Analysis.** An insider `edge-by-dimension` surface: `ret-on-traded` and **win-rate-vs-implied**
   per cell and per **marginal** (collapse one axis at a time so signal appears even when full cells
   are sparse), gated on min-sample + persistence.

## The cell key

`category | detector | sensitivity | direction | entry-band | time-bucket | score-bucket`

- **category** — series-prefix bucket (reuse census's `categoryOf`: politics/mentions/entertainment/
  economics/companies/… ; sports excluded by the universe filter for now).
- **detector** — which confirmation fired alongside CUSUM: `cusum+imbalance` / `cusum+volumeZ` /
  `cusum+vpin`.
- **sensitivity** — starts single-valued (`medium` = validated defaults). Strict/loose added later
  with no schema change (it's just a cell-key component).
- **direction** — `yes` / `no`.
- **entry-band** — price bucket at entry (edge varies by price — the favorite-longshot curve).
- **time-bucket** — time-to-close bucket (reuse census's `timeBucketOf`).
- **score-bucket** — anomaly-score bucket (low/med/high).

Sparse full cells are expected and fine — analyze via **marginals** exactly as census does.

## Storage & paper mechanics

- **Read-only** from the shared `spine.db` (latest / candles / trades / settlement). **Write** to a
  **separate `insider.db`** so we don't add a 6th concurrent writer to the contended shared file.
- Paper fill mirrors census: `count = 1 / priceCents` (cost = exactly 1¢), entry at the flagged
  direction's ask. **Dedup key `(ticker, side, cell_key)`** — each config a market-side fires records
  its own cell once, ever.
- Tables (`insider.db`, WAL, `busy_timeout` raised like census learned to):
  ```sql
  insider_open (ticker, side, cell_key, entry_price_cents, count, opened_ts, close_ms)  -- PK(ticker,side,cell_key)
  insider_cell (cell_key PK, category, detector, sensitivity, direction, entry_band,
                time_bucket, score_bucket, n, wins, traded_cents, pnl_cents)            -- permanent rollup, never pruned
  insider_raw  (id PK, ticker, side, cell_key, entry_price_cents, count, won, pnl_cents,
                anomaly_score, settled_at, settle_source)                               -- rolling 7-day drill-down
  ```
  `settle_source` tags provenance (market-result vs settlement-record vs data-correction) so bad rows
  are excludable without deletion.

## Universe scope (the cost knob — history-fetch is expensive)

Start **bounded**: non-sports qualifying markets (**politics, mentions, entertainment/culture,
economics, companies**) above a volume floor, at a **5–15 min cadence**. Bias-free *within* that
universe. Expand categories / lower the floor / raise cadence as Ai1 capacity allows. Sports excluded
for now (idiosyncratic-word "mention" noise, no insider edge).

## Metric / ripeness

Primary metric: **`ret-on-traded = pnl / traded-$`** (never ret-on-pool). A cell/marginal is "ripe"
— a signal config worth graduating toward real money — when `ret-on-traded` is **durably positive**,
with **≥ a minimum settled sample** (~500, as census uses), **persistent over ≥24–48h** (guards
against regime luck). Win-rate-vs-implied per entry-band is the favorite-longshot-style read that
says whether the flagged direction beats its own price.

## Deployment (Ai1)

Run the TS census as another `respawn()`-wrapped daemon in the Ai1 container alongside
`poller`/`census`/`grid` (add a node/tsx runtime), sharing `/app/state` (`spine.db` + `insider.db`;
only that volume survives container rebuilds). Reuse `agent/deploy.sh` patterns verbatim: rsync over
Tailscale SSH, the secrets pre-flight grep that aborts if `.env`/`.pem`/`key`/`state`/`logs` are
staged, podman `--restart=always`, systemd user timers, `loginctl enable-linger`, and a
`healthcheck.sh`-gated deploy.

## Decomposition into sub-projects (build order)

This is multi-component and cross-repo; build in phases, each its own spec→plan→build cycle:

- **Phase 1 — Census core (local, no deploy):** the TS insider-census entry + settlement engine and
  `insider.db` schema. For the local start the census fetches candle/trade history itself and writes
  it into a **local `spine.db` honoring the same schema contract** the production poller will later
  fill (so nothing downstream changes when the real poller takes over). This proves the
  enter→settle→rollup loop end-to-end with the validated detectors. The production JS poller
  history-extension is deferred to Phase 3 (deploy), where the one-fetcher rule actually binds.
  **Build this first.**
- **Phase 2 — Analysis surface:** the insider `edge-by-dimension`/marginals reporting over
  `insider_cell`/`insider_raw`.
- **Phase 3 — Ai1 deploy:** container daemon integration, systemd timers, healthcheck, shared spine.
- **Phase 4 (later) — enrichments:** strict/loose sensitivity sweep; optional AI `publicLean`
  dimension applied *selectively* to already-ripe cells; universe expansion (incl. a plain
  band-census base-rate comparator); eventual graduation of ripe cells to the real-money bot.

## Non-goals / deferred
- No AI investigator in the census hot path (Phase 4 selective only).
- No real-money trading (this is the paper data-collection layer that *precedes* it; it supersedes
  the earlier paused real-money 3×3 grid — see `docs/superpowers/NEXT-grid-of-bots.md`).
- No sports / no full-universe from day one.
- No strict/loose sweep initially (medium only).

## Success criteria
- Phase 1: the census, run locally, ingests the watched universe from a local `spine.db` (which it
  populates via the same schema contract the production poller will fill), fires the validated
  detectors, opens enter-once 1¢ paper entries keyed by cell, settles them against real results, and
  folds them into permanent `insider_cell` rollups — verified end-to-end with tests and a local dry
  run.
- Production (Phase 3): exactly one process (the shared poller) hits the Kalshi API; the census reads
  the shared `spine.db` and makes no direct Kalshi calls.
