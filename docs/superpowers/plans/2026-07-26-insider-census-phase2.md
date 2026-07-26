# Insider Census — Phase 2 (Analysis Surface) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the read-only analysis surface over the census data — per-cell and per-marginal `ret-on-traded` + win-rate-vs-implied, with ripeness/persistence gating and a `census:surface` CLI — plus fold in the four deferred Phase-1 minors.

**Architecture:** Pure functions over `CellRow[]` (from `InsiderDb.listCells()`) and raw rows (`InsiderDb.listRaw()`) compute the metrics, single-axis marginals, and ripeness — all testable without a DB. A thin CLI opens `insider.db` and prints the ranked output. No new detection/entry behavior; analysis only.

**Tech Stack:** TypeScript (Node 18), vitest, `tsx`, `better-sqlite3`.

## Global Constraints

- PAPER/read-only: the analysis layer and CLI must not open orders, mutate `insider.db` beyond what already exists, or call Kalshi. Analysis reads `insider_cell`/`insider_raw` only.
- Primary metric is **`ret-on-traded = pnl_cents / traded_cents`** — NEVER ret-on-pool. Guard `traded_cents === 0` → 0.
- Cell axes are exactly: `category, detector, sensitivity, direction, entryBand, timeBucket, scoreBucket` (the 7 `CellRow` fields).
- `npx tsc --noEmit` clean and all tests green after every task; stage only each task's own files (never `git add -A`).

---

### Task 1: Deferred Phase-1 minor fixes

**Files:**
- Modify: `src/census/cell.ts` (`bandOf`), `src/census/entry.ts` (hoist + degenerate skip), `src/census/settle.ts` (Set-dedup)
- Test: `tests/census/cell.test.ts`, `tests/census/entry.test.ts`, `tests/census/settle.test.ts` (append cases)

**Interfaces:**
- Produces: no signature changes. `runEntryCycle`/`runSettleCycle`/`bandOf` keep their exported shapes; behavior is hardened.

- [ ] **Step 1: Write the failing tests**

Append to `tests/census/cell.test.ts`:
```typescript
it("bandOf rounds BEFORE the 0/100 exclusion (99.6 -> bNA, 0.4 -> bNA)", () => {
  expect(bandOf(99.6)).toBe("bNA");
  expect(bandOf(0.4)).toBe("bNA");
  expect(bandOf(62.4)).toBe("b62");
});
```
Append to `tests/census/settle.test.ts` (reuse its existing `openBet`/`tmpDb` helpers):
```typescript
it("does not double-count matched when the same ticker appears twice in one batch", () => {
  const db = new InsiderDb(tmpDb());
  db.openBet(openBet("yes", "mentions|cusum+imbalance|medium|yes|b50|1d|med"));
  const r = runSettleCycle([
    { ticker: "KXT-26JUL30-A", result: "yes", settledAt: 9, source: "market-result" },
    { ticker: "KXT-26JUL30-A", result: "yes", settledAt: 9, source: "market-result" },
  ], db);
  expect(r.matched).toBe(1);
  db.close();
});
```
Append to `tests/census/entry.test.ts` (reuse its helpers; build a firing market whose flagged side has a degenerate 0 price):
```typescript
it("does not enter a candidate whose entry price is <= 0", async () => {
  const db = new InsiderDb(tmpDb());
  const md = { market: { ...mkt("KXAOCMENTION-26JUL30-Z", "KXAOCMENTION"), yesBidCents: 100, yesAskCents: 100 }, ...surge("KXAOCMENTION-26JUL30-Z") };
  // NO-direction entry would be 100 - yesBidCents = 0; YES entry would be yesAskCents=100 (also degenerate).
  const f = runEntryCycle([md], db, NOW);
  expect(f.entered).toBe(0);
  expect(db.listOpen()).toHaveLength(0);
  db.close();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/census/cell.test.ts tests/census/settle.test.ts tests/census/entry.test.ts`
Expected: the three new cases FAIL (bandOf keeps b100; matched=2; a degenerate entry is opened).

- [ ] **Step 3: Fix `bandOf` (round then exclude) in `src/census/cell.ts`**

```typescript
export function bandOf(cents: number): string {
  if (!Number.isFinite(cents)) return "bNA";
  const r = Math.round(cents);
  if (r <= 0 || r >= 100) return "bNA";
  return `b${r}`;
}
```

- [ ] **Step 4: Fix `runSettleCycle` Set-dedup in `src/census/settle.ts`**

Replace the function body with:
```typescript
export function runSettleCycle(settlements: SettlementRecord[], db: InsiderDb): { matched: number; settled: number } {
  let matched = 0, settled = 0;
  const processed = new Set<string>();
  for (const s of settlements) {
    if (processed.has(s.ticker)) continue;
    processed.add(s.ticker);
    const sides = new Set(db.listOpen().filter((o) => o.ticker === s.ticker).map((o) => o.side));
    if (sides.size === 0) continue;
    matched++;
    for (const side of sides) {
      const before = db.listOpen().filter((o) => o.ticker === s.ticker && o.side === side).length;
      db.settle(s.ticker, side, side === s.result, s.settledAt, s.source);
      settled += before;
    }
  }
  return { matched, settled };
}
```

- [ ] **Step 5: Hoist duplicated cell-field computation + skip degenerate entry in `src/census/entry.ts`**

In `runEntryCycle`, after `const { candidate, features } = res;` and `f.fired++;`, replace the `minsToClose`/`bet` construction with:
```typescript
    if (candidate.entryCents <= 0 || candidate.entryCents >= 100) continue; // degenerate price, nothing to bet
    const minsToClose = Math.max(0, (m.closeTs - nowTs) / 60);
    const detector = detectorLabel(features);
    const entryBand = bandOf(candidate.entryCents);
    const timeBucket = timeBucketOf(minsToClose);
    const scoreBucket = scoreBucketOf(candidate.anomalyScore);
    const key = cellKey({ category, detector, sensitivity: SENSITIVITY, direction: candidate.direction, entryBand, timeBucket, scoreBucket });
    const bet: OpenBet = {
      ticker: m.marketTicker, side: candidate.direction, entryPriceCents: candidate.entryCents,
      count: 1 / candidate.entryCents, openedTs: nowTs, closeMs: m.closeTs * 1000,
      category, detector, sensitivity: SENSITIVITY, direction: candidate.direction,
      entryBand, timeBucket, scoreBucket, anomalyScore: candidate.anomalyScore, cellKey: key,
    };
    if (db.openBet(bet)) f.entered++;
```

- [ ] **Step 6: Run to verify pass (incl. full suite)**

Run: `npx vitest run && npx tsc --noEmit`
Expected: the three new tests PASS; full suite green; tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/census/cell.ts src/census/entry.ts src/census/settle.ts tests/census/cell.test.ts tests/census/entry.test.ts tests/census/settle.test.ts
git commit -m "fix(census): deferred Phase-1 minors (bandOf rounding, settle Set-dedup, entry hoist + degenerate skip)"
```

---

### Task 2: Pure surface metrics (`src/census/surface.ts`)

**Files:**
- Create: `src/census/surface.ts`
- Test: `tests/census/surface.test.ts`

**Interfaces:**
- Consumes: `CellRow` from `./insiderDb`.
- Produces: `retOnTraded(row: { pnlCents: number; tradedCents: number }): number`, `winRate(row: { wins: number; n: number }): number`, `impliedFromBand(entryBand: string): number | null`, `winRateVsImplied(row: CellRow): number | null`.

- [ ] **Step 1: Write the failing test**

Create `tests/census/surface.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { retOnTraded, winRate, impliedFromBand, winRateVsImplied } from "../../src/census/surface";
import { CellRow } from "../../src/census/insiderDb";

const cell = (o: Partial<CellRow> = {}): CellRow => ({
  cellKey: "k", category: "mentions", detector: "cusum+imbalance", sensitivity: "medium",
  direction: "yes", entryBand: "b60", timeBucket: "1d", scoreBucket: "med",
  n: 10, wins: 7, tradedCents: 10, pnlCents: 2, ...o,
});

describe("surface metrics", () => {
  it("retOnTraded = pnl/traded, 0 when no traded", () => {
    expect(retOnTraded({ pnlCents: 2, tradedCents: 10 })).toBeCloseTo(0.2);
    expect(retOnTraded({ pnlCents: 0, tradedCents: 0 })).toBe(0);
  });
  it("winRate = wins/n, 0 when n=0", () => {
    expect(winRate({ wins: 7, n: 10 })).toBeCloseTo(0.7);
    expect(winRate({ wins: 0, n: 0 })).toBe(0);
  });
  it("impliedFromBand parses b<NN> to a probability, bNA -> null", () => {
    expect(impliedFromBand("b60")).toBeCloseTo(0.6);
    expect(impliedFromBand("bNA")).toBeNull();
  });
  it("winRateVsImplied = winRate - impliedFromBand (null when band unparseable)", () => {
    expect(winRateVsImplied(cell({ wins: 7, n: 10, entryBand: "b60" }))).toBeCloseTo(0.1);
    expect(winRateVsImplied(cell({ entryBand: "bNA" }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/census/surface.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/census/surface.ts`**

```typescript
import { CellRow } from "./insiderDb";

/** Primary edge metric: net cents per traded cent. 0 when nothing traded. NEVER ret-on-pool. */
export function retOnTraded(row: { pnlCents: number; tradedCents: number }): number {
  return row.tradedCents > 0 ? row.pnlCents / row.tradedCents : 0;
}

export function winRate(row: { wins: number; n: number }): number {
  return row.n > 0 ? row.wins / row.n : 0;
}

/** "b62" -> 0.62 (the band's implied probability); "bNA"/unparseable -> null. */
export function impliedFromBand(entryBand: string): number | null {
  const m = /^b(\d{1,2})$/.exec(entryBand);
  if (!m) return null;
  const cents = Number(m[1]);
  return cents >= 1 && cents <= 99 ? cents / 100 : null;
}

/** Realized win-rate minus the band's implied probability: >0 means the flagged side beat its price. */
export function winRateVsImplied(row: CellRow): number | null {
  const implied = impliedFromBand(row.entryBand);
  return implied === null ? null : winRate(row) - implied;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/census/surface.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/census/surface.ts tests/census/surface.test.ts
git commit -m "feat(census): surface metrics (retOnTraded, winRate, winRateVsImplied)"
```

---

### Task 3: Single-axis marginals (`src/census/surface.ts`)

**Files:**
- Modify: `src/census/surface.ts`
- Test: `tests/census/surface.test.ts` (append)

**Interfaces:**
- Produces: `type Dimension = "category" | "detector" | "sensitivity" | "direction" | "entryBand" | "timeBucket" | "scoreBucket"`; `interface MarginalRow { dimension: Dimension; value: string; n: number; wins: number; tradedCents: number; pnlCents: number; retOnTraded: number; winRate: number }`; `marginal(cells: CellRow[], dim: Dimension): MarginalRow[]` (aggregated by that dimension's value, sorted by `retOnTraded` desc).

- [ ] **Step 1: Write the failing test**

Append to `tests/census/surface.test.ts`:
```typescript
import { marginal } from "../../src/census/surface";

it("marginal collapses cells along one axis, aggregates, sorts by retOnTraded desc", () => {
  const cells = [
    cell({ category: "mentions", n: 10, wins: 6, tradedCents: 10, pnlCents: 1 }),
    cell({ category: "mentions", n: 10, wins: 8, tradedCents: 10, pnlCents: 3 }),
    cell({ category: "politics", n: 20, wins: 5, tradedCents: 20, pnlCents: -4 }),
  ];
  const m = marginal(cells, "category");
  expect(m).toHaveLength(2);
  expect(m[0]!.value).toBe("mentions"); // higher retOnTraded first
  expect(m[0]!.n).toBe(20);
  expect(m[0]!.tradedCents).toBe(20);
  expect(m[0]!.pnlCents).toBe(4);
  expect(m[0]!.retOnTraded).toBeCloseTo(0.2);
  expect(m[1]!.value).toBe("politics");
  expect(m[1]!.retOnTraded).toBeCloseTo(-0.2);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/census/surface.test.ts`
Expected: FAIL — `marginal` not exported.

- [ ] **Step 3: Implement `marginal` in `src/census/surface.ts`**

Add:
```typescript
export type Dimension =
  | "category" | "detector" | "sensitivity" | "direction" | "entryBand" | "timeBucket" | "scoreBucket";

export interface MarginalRow {
  dimension: Dimension; value: string;
  n: number; wins: number; tradedCents: number; pnlCents: number;
  retOnTraded: number; winRate: number;
}

/** Collapse the cell hypercube along ONE axis: group by cells[dim], sum n/wins/traded/pnl, then
 *  compute retOnTraded/winRate per group. Sorted by retOnTraded descending (best edge first). */
export function marginal(cells: CellRow[], dim: Dimension): MarginalRow[] {
  const acc = new Map<string, { n: number; wins: number; tradedCents: number; pnlCents: number }>();
  for (const c of cells) {
    const value = c[dim];
    const a = acc.get(value) ?? { n: 0, wins: 0, tradedCents: 0, pnlCents: 0 };
    a.n += c.n; a.wins += c.wins; a.tradedCents += c.tradedCents; a.pnlCents += c.pnlCents;
    acc.set(value, a);
  }
  return [...acc.entries()]
    .map(([value, a]): MarginalRow => ({
      dimension: dim, value, ...a,
      retOnTraded: retOnTraded(a), winRate: winRate(a),
    }))
    .sort((x, y) => y.retOnTraded - x.retOnTraded);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/census/surface.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/census/surface.ts tests/census/surface.test.ts
git commit -m "feat(census): single-axis marginals (collapse one dimension, rank by retOnTraded)"
```

---

### Task 4: Ripeness + persistence (`src/census/surface.ts` + `InsiderDb.listRaw`)

**Files:**
- Modify: `src/census/insiderDb.ts` (add `RawRow` + `listRaw()`), `src/census/surface.ts` (add `isRipe`, `persistence`)
- Test: `tests/census/surface.test.ts` (append), `tests/census/insiderDb.test.ts` (append a `listRaw` case)

**Interfaces:**
- Produces:
  - In `insiderDb.ts`: `interface RawRow { ticker: string; side: string; cellKey: string; entryPriceCents: number; count: number; won: boolean; pnlCents: number; anomalyScore: number; settledAt: number; settleSource: string }` and `InsiderDb.listRaw(): RawRow[]`.
  - In `surface.ts`: `interface RipeParams { minRet: number; minSample: number }`, `DEFAULT_RIPE: RipeParams = { minRet: 0.02, minSample: 500 }`; `isRipe(row: { retOnTraded: number; n: number }, p?: RipeParams): boolean`; `persistence(raw: RawRow[], nowTs: number, recentWindowSec?: number): { recentN: number; recentRet: number; priorN: number; priorRet: number; persistent: boolean }` — split a cell's raw rows into recent (`settledAt >= nowTs - recentWindowSec`, default 48h) vs prior; `persistent` = both windows have data AND both `ret > 0`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/census/insiderDb.test.ts`:
```typescript
it("listRaw returns settled drill-down rows", () => {
  const db = new InsiderDb(tmpDb());
  db.openBet(bet());
  db.settle("KXT-26JUL30-A", "yes", true, 3000, "market-result");
  const raw = db.listRaw();
  expect(raw).toHaveLength(1);
  expect(raw[0]!.won).toBe(true);
  expect(raw[0]!.settledAt).toBe(3000);
  db.close();
});
```
Append to `tests/census/surface.test.ts`:
```typescript
import { isRipe, persistence } from "../../src/census/surface";
import { RawRow } from "../../src/census/insiderDb";

const raw = (settledAt: number, won: boolean, pnl: number): RawRow => ({
  ticker: "T", side: "yes", cellKey: "k", entryPriceCents: 50, count: 1 / 50,
  won, pnlCents: pnl, anomalyScore: 2, settledAt, settleSource: "market-result",
});

it("isRipe requires retOnTraded >= minRet AND n >= minSample", () => {
  expect(isRipe({ retOnTraded: 0.05, n: 600 })).toBe(true);
  expect(isRipe({ retOnTraded: 0.05, n: 100 })).toBe(false);
  expect(isRipe({ retOnTraded: 0.01, n: 600 })).toBe(false);
});
it("persistence requires positive ret in BOTH the recent and prior windows", () => {
  const NOW = 1_000_000;
  const rows = [
    raw(NOW - 10 * 3600, true, 2),   // recent, win
    raw(NOW - 100 * 3600, true, 2),  // prior, win
  ];
  const p = persistence(rows, NOW, 48 * 3600);
  expect(p.recentN).toBe(1); expect(p.priorN).toBe(1); expect(p.persistent).toBe(true);
  // a prior-window loss breaks persistence
  const p2 = persistence([raw(NOW - 10 * 3600, true, 2), raw(NOW - 100 * 3600, false, -1)], NOW, 48 * 3600);
  expect(p2.persistent).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/census/insiderDb.test.ts tests/census/surface.test.ts`
Expected: FAIL — `listRaw`/`isRipe`/`persistence` not defined.

- [ ] **Step 3: Add `RawRow` + `listRaw()` to `src/census/insiderDb.ts`**

Add the interface near `CellRow`:
```typescript
export interface RawRow {
  ticker: string; side: string; cellKey: string; entryPriceCents: number; count: number;
  won: boolean; pnlCents: number; anomalyScore: number; settledAt: number; settleSource: string;
}
```
Add the method to the class:
```typescript
  listRaw(): RawRow[] {
    return this.db.prepare(`SELECT * FROM insider_raw`).all().map((r: any) => ({
      ticker: r.ticker, side: r.side, cellKey: r.cell_key, entryPriceCents: r.entry_price_cents,
      count: r.count, won: r.won === 1, pnlCents: r.pnl_cents, anomalyScore: r.anomaly_score,
      settledAt: r.settled_at, settleSource: r.settle_source,
    }));
  }
```

- [ ] **Step 4: Add `isRipe` + `persistence` to `src/census/surface.ts`**

```typescript
import { CellRow, RawRow } from "./insiderDb";

export interface RipeParams { minRet: number; minSample: number }
export const DEFAULT_RIPE: RipeParams = { minRet: 0.02, minSample: 500 };

/** A cell/marginal is ripe when its edge clears minRet AND it has enough settled sample. */
export function isRipe(row: { retOnTraded: number; n: number }, p: RipeParams = DEFAULT_RIPE): boolean {
  return row.retOnTraded >= p.minRet && row.n >= p.minSample;
}

/** Split a cell's settled raw rows into recent (last recentWindowSec, default 48h) vs prior;
 *  persistent = both windows have samples AND both are net-positive ret-on-traded (guards against
 *  luck/decay). */
export function persistence(
  raw: RawRow[], nowTs: number, recentWindowSec = 48 * 3600,
): { recentN: number; recentRet: number; priorN: number; priorRet: number; persistent: boolean } {
  const cutoff = nowTs - recentWindowSec;
  const agg = (rows: RawRow[]) => {
    const pnl = rows.reduce((s, r) => s + r.pnlCents, 0);
    const traded = rows.reduce((s, r) => s + Math.round(r.entryPriceCents * r.count), 0);
    return { n: rows.length, ret: traded > 0 ? pnl / traded : 0 };
  };
  const recent = agg(raw.filter((r) => r.settledAt >= cutoff));
  const prior = agg(raw.filter((r) => r.settledAt < cutoff));
  return {
    recentN: recent.n, recentRet: recent.ret, priorN: prior.n, priorRet: prior.ret,
    persistent: recent.n > 0 && prior.n > 0 && recent.ret > 0 && prior.ret > 0,
  };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/census/insiderDb.test.ts tests/census/surface.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/census/insiderDb.ts src/census/surface.ts tests/census/insiderDb.test.ts tests/census/surface.test.ts
git commit -m "feat(census): ripeness gate + persistence + InsiderDb.listRaw"
```

---

### Task 5: `census:surface` CLI

**Files:**
- Create: `src/census/surfaceCli.ts`
- Modify: `package.json` (add `census:surface` script)
- Test: none (thin read-only CLI; smoke-run manually). Correctness of the metrics/marginals/ripeness it prints is covered by Tasks 2–4.

**Interfaces:**
- Consumes: `InsiderDb` (`listCells`, `listRaw`), all of `surface.ts` (`retOnTraded`, `winRate`, `winRateVsImplied`, `marginal`, `Dimension`, `isRipe`, `persistence`, `DEFAULT_RIPE`).

- [ ] **Step 1: Implement `src/census/surfaceCli.ts`**

```typescript
import { InsiderDb } from "./insiderDb";
import { retOnTraded, winRate, winRateVsImplied, marginal, Dimension, isRipe, persistence } from "./surface";

function arg(flag: string, def: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function main(): void {
  const dbPath = arg("--insider", "./.census/insider.db");
  const nowTs = Math.floor(Date.now() / 1000);
  const db = new InsiderDb(dbPath);
  const cells = db.listCells();
  const raw = db.listRaw();

  console.log(`Insider census surface — ${cells.length} cells, ${raw.length} settled raw rows (db=${dbPath})\n`);

  console.log("=== Top cells by ret-on-traded (n>=1) ===");
  const ranked = cells
    .filter((c) => c.tradedCents > 0)
    .map((c) => ({ c, ret: retOnTraded(c), wr: winRate(c), vs: winRateVsImplied(c) }))
    .sort((a, b) => b.ret - a.ret)
    .slice(0, 25);
  for (const { c, ret, wr, vs } of ranked) {
    const ripe = isRipe({ retOnTraded: ret, n: c.n }) ? " RIPE" : "";
    const p = persistence(raw.filter((r) => r.cellKey === c.cellKey), nowTs);
    console.log(`  ${c.cellKey}  n=${c.n} ret=${pct(ret)} wr=${pct(wr)}${vs === null ? "" : ` vsImplied=${pct(vs)}`} persist=${p.persistent}${ripe}`);
  }

  const dims: Dimension[] = ["category", "detector", "sensitivity", "direction", "entryBand", "timeBucket", "scoreBucket"];
  for (const dim of dims) {
    console.log(`\n=== Marginal by ${dim} (ranked by ret-on-traded) ===`);
    for (const m of marginal(cells, dim)) {
      const ripe = isRipe({ retOnTraded: m.retOnTraded, n: m.n }) ? " RIPE" : "";
      console.log(`  ${dim}=${m.value}  n=${m.n} ret=${pct(m.retOnTraded)} wr=${pct(m.winRate)}${ripe}`);
    }
  }
  db.close();
}

if (process.argv[1] && process.argv[1].endsWith("surfaceCli.ts")) main();
```

- [ ] **Step 2: Add the npm script to `package.json`**

Add to `"scripts"`: `"census:surface": "tsx src/census/surfaceCli.ts"`.

- [ ] **Step 3: Verify build + a smoke run**

Run: `npx tsc --noEmit` (clean) and `npx vitest run` (full suite green). Smoke: run the CLI against a fresh path — `InsiderDb`'s constructor creates the schema on open, so it starts empty and must print the headers without error:
```bash
mkdir -p .census && npx tsx src/census/surfaceCli.ts --insider ./.census/smoke.db | head -3
rm -f .census/smoke.db*
```
Expected: prints the "Insider census surface — 0 cells, 0 settled raw rows..." header and the "Top cells" section header with no rows, no crash.

- [ ] **Step 4: Commit**

```bash
git add src/census/surfaceCli.ts package.json
git commit -m "feat(census): census:surface CLI (top cells + per-dimension marginals, ripeness/persistence flags)"
```

---

## Notes for the executor
- Phase 2 is analysis only — read-only over `insider.db`; no entry/settlement/detection behavior changes beyond the Task-1 minors.
- There is no real census data yet (insider.db fills once the census runs on Ai1 in Phase 3); the analysis is validated with fixtures here.
- Persistence uses `insider_raw` (settled drill-down); it degrades gracefully to `persistent=false` when a window has no samples.
