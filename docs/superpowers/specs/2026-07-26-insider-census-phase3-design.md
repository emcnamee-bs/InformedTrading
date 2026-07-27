# Insider Census — Phase 3 (Poller Extension + Ai1 Deploy) Design

**Date:** 2026-07-26
**Status:** Approved (brainstorming) → decompose into 3a/3b/3c, plan+build each in order

## Goal
Run the insider census continuously on the Ai1 machine, fed by one shared poller-written
`spine.db`, accumulating `insider.db` over weeks — so realized outcomes label which detector-fired
signal cells have real edge.

## Architecture: two containers, one shared volume
On Ai1 the census runs as **its own `podman` container** (Node 18 + `better-sqlite3`, our stack
unchanged) bind-mounting the same `/app/state` as the existing Fast99 agent container. It **reads**
`spine.db` (poller-written) and **writes** `/app/state/insider.db`. The Fast99 `poller` stays the
**sole Kalshi fetcher** (the one-fetcher rule). WAL + `busy_timeout=30000` (both containers already
set this) handle cross-container concurrency on the shared host filesystem. **The census container
needs no secrets** — it never calls Kalshi, only reads the spine file.

Resolved forks (brainstorming):
- **Census placement: separate container** (not a daemon inside the Fast99 image) — isolates our
  ESM/Node-18/`better-sqlite3` stack; only coupling is the `spine.db` file.
- **Schema: read the poller's native schema; poller adds only candle/trade tables** — our
  `SpineReader` reads `latest` (markets) + `settlement` (outcomes) + new `candles`/`trades`; the
  heavy poller is NOT asked to double-write market/settlement rows.

## Component 3a — Poller history extension (`Fast99Follower/agent`, JS, `node:sqlite`, CommonJS)
- **`db.js`:** add `candles` and `trades` tables (columns matching what the detectors need:
  `candles(ticker, end_period_ts, period_minutes, close_cents, volume)`;
  `trades(ticker, created_ts, yes_price_cents, count, taker_side)`), with the same WAL/busy_timeout
  and a bounded retention prune (like `market_snapshot`).
- **`src/kalshiClient.js`:** port `getTrades` (`GET /markets/trades`, cursor-paginated,
  cents-normalized) — the client has `getCandlesticks` but no trades method today.
- **Poll loop:** add a **separate, slower history-fetch pass** — NOT every open market every 60s
  (~17.8k × 2 calls would melt the rate limit). On a **~10 min cadence**, for the **non-sports,
  volume-qualifying** universe (cap **~1–2k** markets), fetch candles+trades and upsert into
  `candles`/`trades`. Preserves the one-fetcher rule while bounding cost.
- **Tests:** Fast99's `node --test agent/test/*.test.js` style (CJS), matching the repo.

## Component 3b — Census container + runner (`InsiderTradeFollower`, TS)
- **Adapt `SpineReader`** (`src/census/spine.ts`) to read the poller's real schema: `latest` →
  `MarketData` markets (reconcile `yes_bid`/`yes_ask` cents and `close_ms`→seconds; `openTs` unused
  by entry so may default), `settlement` → `SettlementRecord` (parse `settled_at`, map `result`),
  plus the new `candles`/`trades`. Update its fixture test to the real column names. (Phase-1's
  `SPINE_SCHEMA` was an "as the poller will fill it" stand-in — now aligned to reality.)
- **Add a continuous `census-runner`** (`src/census/runner.ts`): loop every ~10 min —
  `runEntryCycle` then `runSettleCycle` against `AI1_DB=/app/state/spine.db`, writing
  `/app/state/insider.db`; graceful SIGTERM; a HALT-file check. Our census is a one-shot CLI today;
  this is the thin daemon wrapper.
- **Dockerfile** (`census.Dockerfile`): Node 18 base + `npm ci` (so `better-sqlite3` compiles for
  Linux/Node-18 in our image build, not copied from macOS) + entrypoint running the runner. Reads
  `AI1_DB` and an insider-db path both under `/app/state`.

## Component 3c — Deploy to Ai1 (cross-repo → the real machine)
- A deploy script mirroring `agent/deploy.sh` patterns: Tailscale SSH (`emcnamee@100.107.15.75`, key
  `~/.ssh/ai1_deploy`), the **secrets pre-flight** grep (abort if `.env`/`.pem`/`key`/`state`/`logs`
  staged), `podman build` our census image, `podman run -d --restart=always` mounting
  `-v /home/emcnamee/ai1/state:/app/state`. No PEM mount (census needs none).
- Confirm Ai1 arch first (`ssh … uname -m`) so `better-sqlite3` build path is known.
- **HARD GATE: the actual deploy to Ai1 is an outward action run ONLY on the user's explicit
  go-ahead.** 3c builds + locally verifies the image/script, then stops for confirmation before any
  SSH/rsync/podman-on-Ai1 runs.

## Non-goals / deferred
- No changes to the Fast99 census/grid/paper daemons.
- No real-money trading (census is paper-only).
- Poller history for the full open universe (bounded to the census target set).

## Success criteria
- 3a: the poller writes `candles`/`trades` for the bounded non-sports universe into `spine.db` on a
  ~10 min cadence; Fast99's `node --test` gate green.
- 3b: `SpineReader` reads the poller's real schema; the `census-runner` loop runs entry+settle
  against a fixture spine.db end-to-end (tests green, tsc clean); the census image builds locally.
- 3c: a deploy script exists and is locally verified; deploy to Ai1 executed only on explicit
  confirmation, after which the census container runs and `insider.db` accumulates on `/app/state`.
