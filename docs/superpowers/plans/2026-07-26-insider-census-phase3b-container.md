# Insider Census Phase 3b — Census Container + Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the insider census run continuously on Ai1 against the shared poller-written `spine.db`: adapt `SpineReader` to the poller's real schema, add a `census-runner` loop, and package it as its own Node-18 container image.

**Architecture:** `SpineReader` reads the poller's actual tables (`latest`, `settlement`, `candles`, `trades`) instead of Phase-1's stand-in `spine_*`. A `census-runner` loops `runEntryCycle`+`runSettleCycle` every ~10 min against `AI1_DB=/app/state/spine.db`, writing `/app/state/insider.db`. A `census.Dockerfile` (Node 18 + `npm ci` so `better-sqlite3` compiles for the Linux/Node-18 target) runs the loop as its own container bind-mounting `/app/state`.

**Tech Stack:** TypeScript (Node 18), vitest, `tsx`, `better-sqlite3`, Docker/Podman.

## Global Constraints

- Working dir / git repo: `/Users/eamonmcnamee/Downloads/InsiderTradeFollower`.
- PAPER / read-only w.r.t. Kalshi and spine.db: the census NEVER calls Kalshi and opens `spine.db` READONLY; it only writes `insider.db`. No order-placement code.
- Read the poller's REAL schema (from Fast99Follower `agent/db.js`), do NOT assume Phase-1 names:
  `latest(ticker, ts, event_ticker, series, status, yes_bid, yes_ask, no_bid, no_ask, open_interest, close_ms, settlement_timer_seconds)`;
  `settlement(ticker, result, revenue_cents, settled_at TEXT-ISO, source)`;
  `candles(ticker, end_period_ts, period_minutes, close_cents, volume)`;
  `trades(trade_id, ticker, created_ts, yes_price_cents, count, taker_side)`.
  `close_ms` is epoch MILLISECONDS; candle/trade ts are unix SECONDS; `settled_at` is an ISO string.
- `npx tsc --noEmit` clean and all tests green after every code task; stage only each task's own files.

---

### Task 1: Adapt `SpineReader` to the poller's real schema

**Files:**
- Modify: `src/census/spine.ts`
- Test: `tests/census/spine.test.ts`

**Interfaces:**
- Consumes: `MarketData` (`../census/entry`), `SettlementRecord` (`../census/settle`), `Candle`/`Trade`/`LiveMarket` (`../kalshi/types`).
- Produces: `SpineReader.listMarketData(): MarketData[]` reading `latest` (+`candles`/`trades`); `SpineReader.listSettlements(): SettlementRecord[]` reading `settlement`. Remove the Phase-1 `SPINE_SCHEMA`/`spine_*` reads. Keep `readonly: true`.

- [ ] **Step 1: Rewrite the fixture test to the poller schema**

Replace `tests/census/spine.test.ts` so the fixture builds the poller's tables (not `spine_*`) and asserts the loop still works end-to-end:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpineReader } from "../../src/census/spine";
import { InsiderDb } from "../../src/census/insiderDb";
import { runEntryCycle } from "../../src/census/entry";
import { runSettleCycle } from "../../src/census/settle";

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "spine-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const NOW = Math.floor(Date.UTC(2026, 6, 30, 12, 0, 0) / 1000);

// Minimal poller-schema DDL (subset the reader needs).
const POLLER_DDL = `
CREATE TABLE latest (ticker TEXT PRIMARY KEY, ts INTEGER, event_ticker TEXT, series TEXT, status TEXT,
  yes_bid INTEGER, yes_ask INTEGER, no_bid INTEGER, no_ask INTEGER, open_interest REAL, close_ms INTEGER, settlement_timer_seconds INTEGER);
CREATE TABLE settlement (ticker TEXT PRIMARY KEY, result TEXT, revenue_cents INTEGER, settled_at TEXT, source TEXT);
CREATE TABLE candles (ticker TEXT, end_period_ts INTEGER, period_minutes INTEGER, close_cents INTEGER, volume REAL, PRIMARY KEY(ticker,end_period_ts,period_minutes));
CREATE TABLE trades (trade_id TEXT PRIMARY KEY, ticker TEXT, created_ts INTEGER, yes_price_cents INTEGER, count REAL, taker_side TEXT);
`;

it("reads the poller schema and runs entry->settle->rollup", () => {
  const d = dir(); const spinePath = join(d, "spine.db");
  const sp = new Database(spinePath); sp.exec(POLLER_DDL);
  sp.prepare(`INSERT INTO latest (ticker, series, yes_bid, yes_ask, close_ms, ts) VALUES (?,?,?,?,?,?)`)
    .run("KXAOCMENTION-26JUL30-A", "KXAOCMENTION", 60, 62, (NOW + 3600) * 1000, NOW * 1000);
  const c = sp.prepare(`INSERT INTO candles (ticker, end_period_ts, period_minutes, close_cents, volume) VALUES (?,?,?,?,?)`);
  for (let i = 0; i < 8; i++) c.run("KXAOCMENTION-26JUL30-A", i, 60, 50, 5);
  [62, 74, 86].forEach((cc, i) => c.run("KXAOCMENTION-26JUL30-A", 8 + i, 60, cc, 80));
  const t = sp.prepare(`INSERT INTO trades (trade_id, ticker, created_ts, yes_price_cents, count, taker_side) VALUES (?,?,?,?,?,?)`);
  [62, 74, 86].forEach((cc, i) => t.run(`x${i}`, "KXAOCMENTION-26JUL30-A", 8 + i, cc, 80, "yes"));
  sp.close();

  const reader = new SpineReader(spinePath);
  const db = new InsiderDb(join(d, "insider.db"));
  expect(runEntryCycle(reader.listMarketData(), db, NOW).entered).toBe(1);

  const sp2 = new Database(spinePath);
  sp2.prepare(`INSERT INTO settlement (ticker, result, settled_at, source) VALUES (?,?,?,?)`)
    .run("KXAOCMENTION-26JUL30-A", "yes", "2026-07-30T14:00:00Z", "market-result");
  sp2.close();
  expect(runSettleCycle(reader.listSettlements(), db).settled).toBe(1);
  expect(db.listCells()[0]!.n).toBe(1);
  reader.close(); db.close();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/census/spine.test.ts`
Expected: FAIL — the current `SpineReader` reads `spine_markets`/`spine_candles`/... which no longer exist in the fixture (`no such table`).

- [ ] **Step 3: Rewrite `SpineReader` in `src/census/spine.ts` to the poller schema**

Replace the reader body (drop `SPINE_SCHEMA` and the `spine_*` queries). Key mappings: `close_ms`→`closeTs` (÷1000), `yes_bid`/`yes_ask`→cents; skip candles whose `close_cents` is null (the poller may leave illiquid candles null — don't feed NaN to the detectors); synthesize per-candle `yesBid`/`yesAsk` as `close±1` (Phase-1 behavior; the spine candle table carries no per-candle book); parse `settled_at` (ISO) to unix seconds; map `taker_side`→`takerSide`.

```typescript
import Database from "better-sqlite3";
import { MarketData } from "./entry";
import { SettlementRecord } from "./settle";
import { LiveMarket, Candle, Trade } from "../kalshi/types";

/** Reads the poller-written spine.db (Fast99Follower agent schema): `latest` (markets), `candles`,
 *  `trades`, `settlement`. Opened READONLY — the census never mutates the spine. */
export class SpineReader {
  private db: Database.Database;
  constructor(path: string) { this.db = new Database(path, { readonly: true }); }

  listMarketData(): MarketData[] {
    const markets = this.db.prepare(`SELECT * FROM latest`).all() as any[];
    return markets.map((m) => {
      const market: LiveMarket = {
        marketTicker: m.ticker, seriesTicker: m.series, category: m.series,
        openTs: 0, closeTs: m.close_ms != null ? Math.floor(m.close_ms / 1000) : 0,
        liquidityVolume: m.open_interest ?? 0, yesBidCents: m.yes_bid, yesAskCents: m.yes_ask,
      };
      const candles: Candle[] = (this.db.prepare(`SELECT * FROM candles WHERE ticker=? ORDER BY end_period_ts`).all(m.ticker) as any[])
        .filter((c) => c.close_cents != null)
        .map((c) => ({
          marketTicker: m.ticker, seriesTicker: m.series, endPeriodTs: c.end_period_ts, periodMinutes: c.period_minutes,
          price: { open: c.close_cents, high: c.close_cents, low: c.close_cents, close: c.close_cents, mean: c.close_cents },
          yesBid: { open: c.close_cents - 1, high: c.close_cents - 1, low: c.close_cents - 1, close: c.close_cents - 1 },
          yesAsk: { open: c.close_cents + 1, high: c.close_cents + 1, low: c.close_cents + 1, close: c.close_cents + 1 },
          volume: c.volume ?? 0, openInterest: 0,
        }));
      const trades: Trade[] = (this.db.prepare(`SELECT * FROM trades WHERE ticker=? ORDER BY created_ts`).all(m.ticker) as any[])
        .map((t) => ({ tradeId: t.trade_id, ticker: m.ticker, yesPriceCents: t.yes_price_cents, count: t.count, takerSide: t.taker_side, createdTs: t.created_ts }));
      return { market, candles, trades };
    });
  }

  listSettlements(): SettlementRecord[] {
    // Only definitively-resolved rows with a yes/no result; parse ISO settled_at to unix seconds.
    return (this.db.prepare(`SELECT * FROM settlement WHERE result IN ('yes','no')`).all() as any[])
      .map((s) => ({
        ticker: s.ticker, result: s.result as "yes" | "no",
        settledAt: s.settled_at ? Math.floor(new Date(s.settled_at).getTime() / 1000) : 0,
        source: s.source ?? "settlement",
      }));
  }

  close(): void { this.db.close(); }
}
```
NOTE: confirm the poller's `settlement.result` actually stores the string `"yes"`/`"no"` (read Fast99Follower `agent/poller.js` `captureSettlements`/`captureResults`). If it stores something else (e.g. a winning ticker), adjust the `WHERE`/map accordingly — the census's `won = side === result` depends on `result` being `"yes"`/`"no"`.

- [ ] **Step 4: Run to verify pass + full suite**

Run: `npx vitest run tests/census/spine.test.ts && npx vitest run && npx tsc --noEmit`
Expected: the rewritten spine test PASSES; full suite green; tsc clean. (If `src/census/cli.ts` or `hydrate.ts` referenced the removed `SPINE_SCHEMA`, update those references — `hydrate.ts` was the Phase-1 local stand-in and may now be dead; if it only imported `SPINE_SCHEMA`, delete the dead import or the file, staging that change in this task.)

- [ ] **Step 5: Commit**

```bash
git add src/census/spine.ts tests/census/spine.test.ts
git commit -m "feat(census): SpineReader reads the poller's real schema (latest/settlement/candles/trades)"
```

---

### Task 2: `census-runner` continuous loop

**Files:**
- Create: `src/census/runner.ts`
- Test: `tests/census/runner.test.ts`

**Interfaces:**
- Consumes: `SpineReader`, `InsiderDb`, `runEntryCycle`, `runSettleCycle`.
- Produces: `runOnce(reader, db, nowTs): { entry: EntryFunnel; settle: { matched: number; settled: number } }` (one iteration, pure-ish, testable); `main()` (the daemon: opens reader/db from `AI1_DB`/insider path, loops `runOnce` every `CENSUS_INTERVAL_SECONDS` (default 600), honors SIGTERM and a `HALT` file, re-opens the reader each iteration so it sees fresh poller writes).

- [ ] **Step 1: Write the failing test for `runOnce`**

Create `tests/census/runner.test.ts` — inject a fake reader returning one firing market + a settlement, assert one entry then one settle folds a cell:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InsiderDb } from "../../src/census/insiderDb";
import { runOnce } from "../../src/census/runner";
import { MarketData } from "../../src/census/entry";
import { LiveMarket, Candle, Trade } from "../../src/kalshi/types";

const dirs: string[] = [];
const tmpDb = () => { const d = mkdtempSync(join(tmpdir(), "runner-")); dirs.push(d); return join(d, "i.db"); };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const NOW = Math.floor(Date.UTC(2026, 6, 30, 12, 0, 0) / 1000);
const candle = (ts: number, close: number, vol: number): Candle => ({
  marketTicker: "M", seriesTicker: "S", endPeriodTs: ts, periodMinutes: 60,
  price: { open: close, high: close, low: close, close, mean: close },
  yesBid: { open: close - 1, high: close - 1, low: close - 1, close: close - 1 },
  yesAsk: { open: close + 1, high: close + 1, low: close + 1, close: close + 1 }, volume: vol, openInterest: 0,
});
function fire(ticker: string): MarketData {
  const flat = Array.from({ length: 8 }, (_, i) => candle(i, 50, 5));
  const s = [candle(8, 62, 80), candle(9, 74, 80), candle(10, 86, 80)];
  const trades: Trade[] = s.map((c, i) => ({ tradeId: `${ticker}-${i}`, ticker, yesPriceCents: c.price.close, count: 80, takerSide: "yes", createdTs: c.endPeriodTs }));
  const market: LiveMarket = { marketTicker: ticker, seriesTicker: "KXAOCMENTION", category: "KXAOCMENTION", openTs: NOW - 100000, closeTs: NOW + 3600, liquidityVolume: 5000, yesBidCents: 60, yesAskCents: 62 };
  return { market, candles: [...flat, ...s], trades };
}

it("runOnce enters a firing market then settles it into a cell", () => {
  const db = new InsiderDb(tmpDb());
  const reader = {
    listMarketData: () => [fire("KXAOCMENTION-26JUL30-A")],
    listSettlements: () => [{ ticker: "KXAOCMENTION-26JUL30-A", result: "yes" as const, settledAt: NOW + 7200, source: "market-result" }],
    close: () => {},
  };
  const r = runOnce(reader as any, db, NOW);
  expect(r.entry.entered).toBe(1);
  expect(r.settle.settled).toBe(1);
  expect(db.listCells()[0]!.n).toBe(1);
  db.close();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/census/runner.test.ts`
Expected: FAIL — `runOnce` not found.

- [ ] **Step 3: Implement `src/census/runner.ts`**

```typescript
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SpineReader } from "./spine";
import { InsiderDb } from "./insiderDb";
import { runEntryCycle, EntryFunnel } from "./entry";
import { runSettleCycle } from "./settle";

export interface CensusReader {
  listMarketData: () => ReturnType<SpineReader["listMarketData"]>;
  listSettlements: () => ReturnType<SpineReader["listSettlements"]>;
  close: () => void;
}

/** One census iteration: enter on all firing markets, then settle matured ones. */
export function runOnce(reader: CensusReader, db: InsiderDb, nowTs: number): {
  entry: EntryFunnel; settle: { matched: number; settled: number };
} {
  const entry = runEntryCycle(reader.listMarketData(), db, nowTs);
  const settle = runSettleCycle(reader.listSettlements(), db);
  return { entry, settle };
}

async function main(): Promise<void> {
  const spinePath = process.env.AI1_DB || "/app/state/spine.db";
  const insiderPath = process.env.INSIDER_DB || "/app/state/insider.db";
  const haltPath = process.env.HALT_FILE || "/app/state/HALT-CENSUS";
  const intervalMs = (Number(process.env.CENSUS_INTERVAL_SECONDS) || 600) * 1000;
  const db = new InsiderDb(insiderPath);
  let stop = false;
  process.on("SIGTERM", () => { stop = true; });
  process.on("SIGINT", () => { stop = true; });
  while (!stop) {
    if (existsSync(haltPath)) { console.error("[census] HALT file present, pausing"); }
    else if (!existsSync(spinePath)) { console.error(`[census] spine not found at ${spinePath}, waiting`); }
    else {
      const reader = new SpineReader(spinePath); // re-open each cycle to see fresh poller writes
      try {
        const nowTs = Math.floor(Date.now() / 1000);
        const r = runOnce(reader, db, nowTs);
        console.error(`[census] entry: analyzed=${r.entry.scanned} entered=${r.entry.entered} pastEvent=${r.entry.pastEvent} | settle: ${r.settle.settled}`);
      } catch (e) {
        console.error("[census] cycle error:", e instanceof Error ? e.message : String(e));
      } finally { reader.close(); }
    }
    const t = Date.now();
    while (!stop && Date.now() - t < intervalMs) await new Promise((r) => setTimeout(r, 500));
  }
  db.close();
  console.error("[census] stopped");
}

if (process.argv[1] && process.argv[1].endsWith("runner.ts")) main();
```
(`Date.now()`/`new Date()` are fine in production runtime code — the no-`Date.now` rule is for workflow scripts, not app code.)

- [ ] **Step 4: Run to verify pass + full suite**

Run: `npx vitest run tests/census/runner.test.ts && npx vitest run && npx tsc --noEmit`
Expected: PASS; full suite green; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/census/runner.ts tests/census/runner.test.ts
git commit -m "feat(census): continuous census-runner loop (runOnce + daemon main, SIGTERM/HALT)"
```

---

### Task 3: `census.Dockerfile` + build smoke

**Files:**
- Create: `census.Dockerfile`, `.dockerignore` (if absent)
- Modify: `package.json` (add `census:run` script)
- Test: none (image build is the check; the loop logic is unit-tested).

**Interfaces:**
- Consumes: `src/census/runner.ts` (Task 2).

- [ ] **Step 1: Add the `census:run` npm script**

Add to `package.json` `scripts`: `"census:run": "tsx src/census/runner.ts"`.

- [ ] **Step 2: Create `census.Dockerfile`**

```dockerfile
# Insider census daemon — its own Node-18 image (matches the repo's runtime + better-sqlite3 ABI).
# Runs as a SECOND container on Ai1, bind-mounting /app/state to read the poller's spine.db and
# write insider.db. Never calls Kalshi; no secrets.
FROM node:18-bookworm-slim
# better-sqlite3 compiles a native binding at install time — needs a toolchain in the build stage.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
ENV AI1_DB=/app/state/spine.db
ENV INSIDER_DB=/app/state/insider.db
ENV CENSUS_INTERVAL_SECONDS=600
CMD ["npx", "tsx", "src/census/runner.ts"]
```

- [ ] **Step 3: Ensure `.dockerignore` excludes noise**

Create/append `.dockerignore`:
```
node_modules
.git
.census
*.pem
.env
dist
```

- [ ] **Step 4: Build smoke (local, if docker/podman available)**

Run (skip gracefully if no container runtime locally — this is verified for real in 3c):
```bash
(command -v podman >/dev/null && podman build -f census.Dockerfile -t insider-census:local .) \
  || (command -v docker >/dev/null && docker build -f census.Dockerfile -t insider-census:local .) \
  || echo "no local container runtime — image build deferred to 3c on Ai1"
```
Expected: builds successfully (npm ci compiles better-sqlite3 for the image's Node 18), OR a clean "deferred" message if no runtime is installed locally. `npx tsc --noEmit` must still be clean and `npx vitest run` green.

- [ ] **Step 5: Commit**

```bash
git add census.Dockerfile .dockerignore package.json
git commit -m "feat(census): census.Dockerfile (Node-18 + better-sqlite3) + census:run script"
```

---

## Notes for the executor
- This is 3b only (container + reader + runner). 3c (the actual Ai1 deploy) is a separate, confirmation-gated step.
- The census is PAPER + read-only against Kalshi/spine; it must never place an order or write the spine.
- Confirm the poller's `settlement.result` string values (`agent/poller.js` in Fast99Follower) — the `won = side === result` gate needs `result` ∈ {"yes","no"}; if the poller stores otherwise, map it in `listSettlements`.
