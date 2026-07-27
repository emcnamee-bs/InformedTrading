# RESUME HERE — Grid-of-Bots (paused before brainstorming)

**Paused 2026-07-18** at the user's request, right before the brainstorming session for the
grid-of-bots feature. Everything below is the context to resume from. Next action: invoke
`superpowers:brainstorming` for **Sub-project A** (see bottom).

## What's decided

- **Goal:** a 3×3 grid = **9 trade bots**, each a function of two shared behavior levers (one per
  axis), each with a **$1 pool**, placing **1¢ trades**, each **verbosely logging to a CSV** for
  evaluation. Universe held constant so only behavior varies across bots.
- **Mode: REAL money on the shared Kalshi account** (user chose this over paper/hybrid). Total at
  risk ~$9. This makes Fast99's merge-safety layer mandatory.
- **The two axes (my recommendation, to confirm in brainstorm):**
  - **Axis X — detection sensitivity** (top of funnel): CUSUM threshold `h` + confirmation taus
    (`imbalanceTau`/`volumeZTau`/`vpinTau`). NOT yet CLI-exposed — exposing them is part of the
    build. Levels: **strict / medium / loose**.
  - **Axis Y — return threshold** (`--min-return`, already exposed). Levels: **10% / 5% / 2%**
    (picky / medium / greedy).
  - Orthogonal → clean frequency×quality sweep. Runner-up if we want zero new plumbing: swap Axis X
    for `--window`/`--baseline` sizing (tight 2/4 · med 3/6 · wide 6/12).

## Critical prior art — Fast99Follower (`/Users/eamonmcnamee/Downloads/Fast99Follower`)

It already runs a real-money grid on one shared Kalshi account. **Port its merge-safety design.**

- **Kalshi has NO per-bot concept** — it merges same-ticker holdings across the whole account;
  `getPositions` returns the merged total to every bot. Unhandled, a $1 bot placed ~$10 of real
  orders and drained the account $19→$7.22 (2026-07-16). Defense, all layers required:
  1. **Clamp, never adopt:** `count = Math.min(ourRecordedCount, accountHeldCount)` (reconcile.js:75)
     — a merge can only shrink a bot's belief, never inflate.
  2. **Book only our share** on settlement: P&L from the bot's OWN recorded count × $1, ignore the
     account-total payout (reconcile.js:86-91).
  3. **Never adopt foreign positions** — only reconcile tickers the bot itself opened.
  4. **Absolute exposure ceiling** independent of (merge-inflatable) equity + **clamp deployable to
     live account cash every cycle** + **exposure-based** runaway guard.
  5. **`client_order_id` namespaced by `BOT_ID` + a persisted per-run token** (deterministic ids
     collide with Kalshi's server memory after a state wipe → 409).
- **Our V1 order endpoint is DEAD:** `POST /portfolio/orders` → `410`. Live path is
  `POST /portfolio/events/orders` (V2: `side: bid|ask`, dollar-string amounts, `time_in_force` +
  `self_trade_prevention_type`). Our `src/kalshi/orderClient.ts` must be rewritten to V2.
- **`closed` ≠ `settled`** — only a definitive `yes`/`no` result counts as settled (treating closed
  as loss produced a phantom 0% win-rate).
- **Label win/loss by payout received, not `pnl>0`** (fees make a correct 99¢ bet look like a loss).
- **Fees eat 30–50% of a 1¢ bet** — Fast99 zeroed fees for its research grid.
- **Per-bot isolation = env + filesystem:** distinct `OUTPUT_DIR`/`STATE_DIR`/`CACHE_DIR`/`BOT_ID`;
  per-bot `ledger.json` (cash, openPositions, realizedPnl, settledKeys, runId), `trades.jsonl`
  audit, `fast99.pid`, `HALT` file, `status.json` heartbeat.
- **CSV model:** Fast99's `trades_verbose.csv` — self-documenting config columns (`bot_id`,
  `category`, the axis params, `spread`, `poll_secs`) + per-BUY/SETTLE row with full decision
  context (entry, bid, spread, OI, mins-to-close, contracts, cost, result, pnl, cumulative_pnl,
  pool_equity, free_cash, open_positions). SETTLE echoes buy-time context so each row is
  self-contained.
- **Double-gated live trading:** the human launches each daemon with the env flag AND `--confirm`;
  missing `--confirm` silently degrades to dry-run.

## The architectural reality

**Our InsiderTradeFollower is a one-shot dry-run SCANNER, not a continuous trading DAEMON.** It has
no ledger, reconcile, settlement loop, or money manager. A live grid needs all of that. So this is
**two sub-projects**, each its own spec→plan→build cycle:

- **Sub-project A — merge-safe trading daemon** (do FIRST): continuous run-loop, per-bot ledger,
  Fast99-style reconcile (count-clamp + own-share P&L + never-adopt-foreign), absolute exposure
  ceiling + live-cash clamp, settlement (closed≠settled, win-by-payout), run-token order IDs, and
  the **V2 `/portfolio/events/orders`** endpoint. Reuses the existing detection pipeline
  (`planProbe`/detectors/investigator/keepCandidate) as the signal source.
- **Sub-project B — the 3×3 grid harness:** expose the two axes as CLI flags, per-bot process
  launcher (env + dirs), verbose CSV schema + writer, and an analysis/rollup over all 9 bots' CSVs.

## Where the codebase is now

- Branch `phase1-kill-gate` (mainline) @ merge 113b100: detection pipeline + investigator upgrade +
  hourly detection + candidate-quality filters, all merged. 231 tests, tsc clean.
- `.superpowers/sdd/progress.md` has the full task ledger.
- The live probe is `npm run probe -- ...` (DRY-RUN default; `--live --confirm` to place — but the
  order path is the DEAD V1 endpoint, so live placement is currently broken and must be rewritten
  to V2 as part of Sub-project A).

## Resume action
Invoke `superpowers:brainstorming` for **Sub-project A (merge-safe trading daemon + V2 orders)**.
First brainstorming question will likely be: reuse-Fast99's-daemon-wholesale vs port-its-safety-
layer-into-our-TS-pipeline, and how bots share vs partition the universe (shared universe = clean
experiment but approximate shared-ticker P&L; Fast99 recommends disjoint universes when practical).
