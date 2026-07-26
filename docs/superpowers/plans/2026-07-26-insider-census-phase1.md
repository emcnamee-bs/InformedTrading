# Insider Census — Phase 1 (Census Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the local Insider Census core in `InsiderTradeFollower` — the enter→settle→rollup loop that paper-bets on detector-fired signals, keyed by signal-config cells, and records outcomes to `insider.db` — proven end-to-end with fixtures + a local `spine.db`.

**Architecture:** A `SpineReader` reads markets/candles/trades/settlement from a local SQLite `spine.db` (the same schema contract the production poller will later fill). An entry engine runs the *existing validated detectors* at medium sensitivity on each non-past, non-sports market and opens enter-once 1¢ paper bets keyed by a pure cell function. A settlement engine joins the spine's settlement feed to open bets and folds outcomes into permanent per-cell rollups. All writes go to a separate `insider.db`.

**Tech Stack:** TypeScript (Node 18), vitest, `tsx`, `better-sqlite3@^9` (Node-18-compatible; SQLite is file-format-portable so this reads a `spine.db` the JS poller will later write).

## Global Constraints

- Node 18 runtime. Use `better-sqlite3@^9.6.0` (v11 requires Node 20+). SQLite files are portable across libraries/languages, so this Phase-1 store is forward-compatible with ai1's `node:sqlite` poller.
- REUSE the validated detection code — do NOT reimplement detection math. Entry runs the existing `detectCandidate`/`detectAnomaly`/`buildFeatures` pipeline at the medium sensitivity `DEFAULT_ANOMALY_PARAMS`. Reuse `isEventPast` (`src/live/eventDate.ts`) for the past-event pre-gate.
- Census READS markets/candles/trades/settlement only from a local `spine.db` (the Home-2 contract); it WRITES only to `insider.db`. No direct Kalshi calls in the entry/settle engines (a separate hydrate runner is the only API caller, mirroring the one-fetcher rule locally).
- Enter-once: dedup PK `(ticker, side, cell_key)`. Paper fill: `count = 1 / priceCents` (cost = exactly 1¢), entry at the flagged direction's ask.
- Settlement: `won = (result === side)`; `pnl_cents = (won ? Math.round(count*100) : 0) - Math.round(entry_price_cents*count)`.
- Universe: NON-sports only (exclude the `sports` category). Sensitivity fixed to `medium` this phase.
- `npx tsc --noEmit` clean and all tests green after every task; stage only each task's own files (never `git add -A`).
- Money safety: this is PAPER only — no order-placement code, no `orderClient`, nothing that can place a real Kalshi order.

---

### Task 1: `insider.db` store (`better-sqlite3`)

**Files:**
- Modify: `package.json` (add `better-sqlite3` dependency)
- Create: `src/census/insiderDb.ts`
- Test: `tests/census/insiderDb.test.ts`

**Interfaces:**
- Produces:
  - `interface OpenBet { ticker: string; side: "yes"|"no"; cellKey: string; entryPriceCents: number; count: number; openedTs: number; closeMs: number; category: string; detector: string; sensitivity: string; direction: string; entryBand: string; timeBucket: string; scoreBucket: string; anomalyScore: number }`
  - `interface CellRow { cellKey: string; category: string; detector: string; sensitivity: string; direction: string; entryBand: string; timeBucket: string; scoreBucket: string; n: number; wins: number; tradedCents: number; pnlCents: number }`
  - `class InsiderDb` with: `constructor(path: string)`, `openBet(b: OpenBet): boolean` (returns false if the `(ticker,side,cellKey)` already existed), `listOpen(): OpenBet[]`, `settle(ticker: string, side: string, won: boolean, settledAt: number, settleSource: string): void` (folds every matching open row for that ticker+side into its cell + raw, deletes from open), `listCells(): CellRow[]`, `close(): void`.

- [ ] **Step 1: Add the dependency**

Run: `npm install better-sqlite3@^9.6.0`
Expected: installs; `node -e "require('better-sqlite3')"` prints nothing (loads OK on Node 18). If the native build fails, pin `better-sqlite3@9.4.3`.

- [ ] **Step 2: Write the failing test**

Create `tests/census/insiderDb.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InsiderDb, OpenBet } from "../../src/census/insiderDb";

const dirs: string[] = [];
function tmpDb(): string {
  const d = mkdtempSync(join(tmpdir(), "insiderdb-"));
  dirs.push(d);
  return join(d, "insider.db");
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function bet(over: Partial<OpenBet> = {}): OpenBet {
  return {
    ticker: "KXT-26JUL30-A", side: "yes", cellKey: "entertainment|cusum+imbalance|medium|yes|b62|1d|med",
    entryPriceCents: 62, count: 1 / 62, openedTs: 1000, closeMs: 2000,
    category: "entertainment", detector: "cusum+imbalance", sensitivity: "medium", direction: "yes",
    entryBand: "b62", timeBucket: "1d", scoreBucket: "med", anomalyScore: 3.2, ...over,
  };
}

describe("InsiderDb", () => {
  it("opens a bet once (enter-once dedup on ticker,side,cellKey)", () => {
    const db = new InsiderDb(tmpDb());
    expect(db.openBet(bet())).toBe(true);
    expect(db.openBet(bet())).toBe(false); // same (ticker,side,cellKey) ignored
    expect(db.listOpen()).toHaveLength(1);
    db.close();
  });

  it("settles a win: folds into cell rollup (n=1,wins=1) and clears open", () => {
    const db = new InsiderDb(tmpDb());
    db.openBet(bet()); // entry 62c, count=1/62
    db.settle("KXT-26JUL30-A", "yes", true, 3000, "market-result");
    const cells = db.listCells();
    expect(cells).toHaveLength(1);
    expect(cells[0]!.n).toBe(1);
    expect(cells[0]!.wins).toBe(1);
    // pnl = round(count*100) - round(entry*count) = round(100/62) - round(62/62) = 2 - 1 = 1
    expect(cells[0]!.pnlCents).toBe(1);
    expect(db.listOpen()).toHaveLength(0);
    db.close();
  });

  it("settles a loss: n=1, wins=0, pnl = -1 (lost the 1c cost)", () => {
    const db = new InsiderDb(tmpDb());
    db.openBet(bet());
    db.settle("KXT-26JUL30-A", "yes", false, 3000, "market-result");
    const c = db.listCells()[0]!;
    expect(c.n).toBe(1); expect(c.wins).toBe(0); expect(c.pnlCents).toBe(-1);
    db.close();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/census/insiderDb.test.ts`
Expected: FAIL — `../../src/census/insiderDb` not found.

- [ ] **Step 4: Implement `src/census/insiderDb.ts`**

```typescript
import Database from "better-sqlite3";

export interface OpenBet {
  ticker: string; side: "yes" | "no"; cellKey: string;
  entryPriceCents: number; count: number; openedTs: number; closeMs: number;
  category: string; detector: string; sensitivity: string; direction: string;
  entryBand: string; timeBucket: string; scoreBucket: string; anomalyScore: number;
}

export interface CellRow {
  cellKey: string; category: string; detector: string; sensitivity: string; direction: string;
  entryBand: string; timeBucket: string; scoreBucket: string;
  n: number; wins: number; tradedCents: number; pnlCents: number;
}

const MIGRATION = `
CREATE TABLE IF NOT EXISTS insider_open (
  ticker TEXT NOT NULL, side TEXT NOT NULL, cell_key TEXT NOT NULL,
  entry_price_cents INTEGER NOT NULL, count REAL NOT NULL, opened_ts INTEGER NOT NULL, close_ms INTEGER NOT NULL,
  category TEXT, detector TEXT, sensitivity TEXT, direction TEXT,
  entry_band TEXT, time_bucket TEXT, score_bucket TEXT, anomaly_score REAL,
  PRIMARY KEY (ticker, side, cell_key)
);
CREATE TABLE IF NOT EXISTS insider_cell (
  cell_key TEXT PRIMARY KEY, category TEXT, detector TEXT, sensitivity TEXT, direction TEXT,
  entry_band TEXT, time_bucket TEXT, score_bucket TEXT,
  n INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
  traded_cents INTEGER NOT NULL DEFAULT 0, pnl_cents INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS insider_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT, side TEXT, cell_key TEXT,
  entry_price_cents INTEGER, count REAL, won INTEGER, pnl_cents INTEGER,
  anomaly_score REAL, settled_at INTEGER, settle_source TEXT
);
`;

export class InsiderDb {
  private db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 30000");
    this.db.exec(MIGRATION);
  }

  openBet(b: OpenBet): boolean {
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO insider_open
         (ticker, side, cell_key, entry_price_cents, count, opened_ts, close_ms,
          category, detector, sensitivity, direction, entry_band, time_bucket, score_bucket, anomaly_score)
         VALUES (@ticker,@side,@cellKey,@entryPriceCents,@count,@openedTs,@closeMs,
          @category,@detector,@sensitivity,@direction,@entryBand,@timeBucket,@scoreBucket,@anomalyScore)`,
      )
      .run(b);
    return info.changes === 1;
  }

  listOpen(): OpenBet[] {
    return this.db.prepare(`SELECT * FROM insider_open`).all().map((r: any) => ({
      ticker: r.ticker, side: r.side, cellKey: r.cell_key, entryPriceCents: r.entry_price_cents,
      count: r.count, openedTs: r.opened_ts, closeMs: r.close_ms, category: r.category, detector: r.detector,
      sensitivity: r.sensitivity, direction: r.direction, entryBand: r.entry_band, timeBucket: r.time_bucket,
      scoreBucket: r.score_bucket, anomalyScore: r.anomaly_score,
    }));
  }

  settle(ticker: string, side: string, won: boolean, settledAt: number, settleSource: string): void {
    const rows = this.db.prepare(`SELECT * FROM insider_open WHERE ticker=? AND side=?`).all(ticker, side) as any[];
    const tx = this.db.transaction(() => {
      for (const r of rows) {
        const traded = Math.round(r.entry_price_cents * r.count);
        const pnl = (won ? Math.round(r.count * 100) : 0) - traded;
        this.db.prepare(
          `INSERT INTO insider_cell
             (cell_key, category, detector, sensitivity, direction, entry_band, time_bucket, score_bucket, n, wins, traded_cents, pnl_cents)
           VALUES (@cell_key,@category,@detector,@sensitivity,@direction,@entry_band,@time_bucket,@score_bucket,1,@w,@traded,@pnl)
           ON CONFLICT(cell_key) DO UPDATE SET
             n = n + 1, wins = wins + @w, traded_cents = traded_cents + @traded, pnl_cents = pnl_cents + @pnl`,
        ).run({
          cell_key: r.cell_key, category: r.category, detector: r.detector, sensitivity: r.sensitivity,
          direction: r.direction, entry_band: r.entry_band, time_bucket: r.time_bucket, score_bucket: r.score_bucket,
          w: won ? 1 : 0, traded, pnl,
        });
        this.db.prepare(
          `INSERT INTO insider_raw (ticker, side, cell_key, entry_price_cents, count, won, pnl_cents, anomaly_score, settled_at, settle_source)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ).run(r.ticker, r.side, r.cell_key, r.entry_price_cents, r.count, won ? 1 : 0, pnl, r.anomaly_score, settledAt, settleSource);
      }
      this.db.prepare(`DELETE FROM insider_open WHERE ticker=? AND side=?`).run(ticker, side);
    });
    tx();
  }

  listCells(): CellRow[] {
    return this.db.prepare(`SELECT * FROM insider_cell`).all().map((r: any) => ({
      cellKey: r.cell_key, category: r.category, detector: r.detector, sensitivity: r.sensitivity,
      direction: r.direction, entryBand: r.entry_band, timeBucket: r.time_bucket, scoreBucket: r.score_bucket,
      n: r.n, wins: r.wins, tradedCents: r.traded_cents, pnlCents: r.pnl_cents,
    }));
  }

  close(): void { this.db.close(); }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/census/insiderDb.test.ts && npx tsc --noEmit`
Expected: 3 tests PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/census/insiderDb.ts tests/census/insiderDb.test.ts
git commit -m "feat(census): insider.db store (open/cell/raw, enter-once, settlement fold)"
```

---

### Task 2: Pure cell bucketing (`src/census/cell.ts`)

**Files:**
- Create: `src/census/cell.ts`
- Test: `tests/census/cell.test.ts`

**Interfaces:**
- Consumes: `FeatureVector` from `../detection/features`.
- Produces: `categoryOf(series: string): string`, `bandOf(cents: number): string`, `timeBucketOf(minsToClose: number): string`, `scoreBucketOf(score: number): string`, `detectorLabel(f: FeatureVector): string`, `cellKey(parts: { category: string; detector: string; sensitivity: string; direction: string; entryBand: string; timeBucket: string; scoreBucket: string }): string`, and `SPORTS_CATEGORY = "sports"`.

- [ ] **Step 1: Write the failing test**

Create `tests/census/cell.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { categoryOf, bandOf, timeBucketOf, scoreBucketOf, detectorLabel, cellKey } from "../../src/census/cell";
import { FeatureVector } from "../../src/detection/features";

describe("cell bucketing", () => {
  it("categoryOf maps series prefixes; sports detected, unknown -> other", () => {
    expect(categoryOf("KXMLBMENTION")).toBe("sports");
    expect(categoryOf("KXWCMENTION")).toBe("sports");
    expect(categoryOf("KXAOCMENTION")).toBe("mentions");
    expect(categoryOf("KXNETFLIXRANKSHOWRUNNERUP")).toBe("entertainment");
    expect(categoryOf("KXWEIRDUNKNOWN")).toBe("other");
  });
  it("bandOf buckets by whole cent, excludes 0/100", () => {
    expect(bandOf(62)).toBe("b62");
    expect(bandOf(0)).toBe("bNA");
    expect(bandOf(100)).toBe("bNA");
  });
  it("timeBucketOf slices minutes-to-close", () => {
    expect(timeBucketOf(20)).toBe("30m");
    expect(timeBucketOf(90)).toBe("2h");
    expect(timeBucketOf(60 * 20)).toBe("1d");
    expect(timeBucketOf(60 * 24 * 9)).toBe("1wk"); // capped
  });
  it("scoreBucketOf low/med/high", () => {
    expect(scoreBucketOf(0.5)).toBe("low");
    expect(scoreBucketOf(2.0)).toBe("med");
    expect(scoreBucketOf(4.0)).toBe("high");
  });
  it("detectorLabel names the confirming signal(s)", () => {
    const base: FeatureVector = { cusumFired: true, cusumDir: "yes", flowImbalance: 0.5, volumeZ: 0.1, vpin: null } as any;
    expect(detectorLabel(base)).toContain("imbalance");
    expect(detectorLabel({ ...base, flowImbalance: 0.0, volumeZ: 3 } as any)).toContain("volumeZ");
  });
  it("cellKey is a stable pipe-joined string", () => {
    expect(cellKey({ category: "mentions", detector: "cusum+imbalance", sensitivity: "medium", direction: "yes", entryBand: "b62", timeBucket: "1d", scoreBucket: "med" }))
      .toBe("mentions|cusum+imbalance|medium|yes|b62|1d|med");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/census/cell.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/census/cell.ts`**

```typescript
import { FeatureVector } from "../detection/features";

export const SPORTS_CATEGORY = "sports";

// Series-prefix → category. Order matters: check sports mention-markets before generic *MENTION.
const SPORTS_PREFIXES = ["KXMLB", "KXNBA", "KXNFL", "KXNHL", "KXWC", "KXATP", "KXWTA", "KXFIGHT", "KXUFC", "KXSOCCER", "KXTENNIS"];
export function categoryOf(series: string): string {
  const s = series.toUpperCase();
  if (SPORTS_PREFIXES.some((p) => s.startsWith(p))) return SPORTS_CATEGORY;
  if (s.includes("MENTION")) return "mentions";
  if (/(NETFLIX|BIGBROTHER|LIUSA|LOVEISLAND|OSCAR|EMMY|GRAMMY|BOXOFFICE|ROTTEN|SHOWRUNNER|MOVIE|ALBUM)/.test(s)) return "entertainment";
  if (/(SENATE|HOUSE|PRES|ELECT|GOV|POLL|CONGRESS|SCOTUS|VETO|NDAA)/.test(s)) return "politics";
  if (/(CPI|GDP|FED|RATE|JOBS|UNEMP|INFLATION|PAYROLL)/.test(s)) return "economics";
  if (/(EARN|MERGER|IPO|TSLA|AAPL|COMPANY|NVDA|LAYOFF)/.test(s)) return "companies";
  return "other";
}

export function bandOf(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0 || cents >= 100) return "bNA";
  return `b${Math.round(cents)}`;
}

export function timeBucketOf(minsToClose: number): string {
  const m = minsToClose;
  if (m <= 30) return "30m";
  if (m <= 60) return "1h";
  if (m <= 120) return "2h";
  if (m <= 360) return "6h";
  if (m <= 720) return "12h";
  if (m <= 1440) return "1d";
  if (m <= 2880) return "2d";
  return "1wk";
}

export function scoreBucketOf(score: number): string {
  if (score < 1.5) return "low";
  if (score < 3) return "med";
  return "high";
}

// DEFAULT_ANOMALY_PARAMS thresholds (imbalanceTau=0.3, volumeZTau=2, vpinTau=0.2) decide which
// confirmations fired. detectAnomaly guarantees at least one of imbalance/volumeZ confirmed.
export function detectorLabel(f: FeatureVector): string {
  const parts: string[] = ["cusum"];
  if (f.flowImbalance !== null && Math.abs(f.flowImbalance) >= 0.3) parts.push("imbalance");
  if (f.volumeZ !== null && f.volumeZ >= 2) parts.push("volumeZ");
  if (f.vpin !== null && f.vpin >= 0.2) parts.push("vpin");
  return parts.join("+");
}

export function cellKey(p: {
  category: string; detector: string; sensitivity: string; direction: string;
  entryBand: string; timeBucket: string; scoreBucket: string;
}): string {
  return [p.category, p.detector, p.sensitivity, p.direction, p.entryBand, p.timeBucket, p.scoreBucket].join("|");
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/census/cell.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean. (If the `detectorLabel` test needs the exact `FeatureVector` field names, confirm them against `src/detection/features.ts` and adjust the test's cast — the implementation only reads `flowImbalance`/`volumeZ`/`vpin`.)

- [ ] **Step 5: Commit**

```bash
git add src/census/cell.ts tests/census/cell.test.ts
git commit -m "feat(census): pure cell bucketing (category/band/time/score/detector/cellKey)"
```

---

### Task 3: Expose features from detection (`detectCandidateWithFeatures`)

**Files:**
- Modify: `src/live/candidate.ts`
- Test: `tests/live/candidate.test.ts` (append)

**Interfaces:**
- Produces: `detectCandidateWithFeatures(market, candles, trades, windowSize?, baselineSize?): { candidate: LiveCandidate; features: FeatureVector } | null`. Existing `detectCandidate` keeps its exact signature/behavior by delegating.

- [ ] **Step 1: Write the failing test**

Append to `tests/live/candidate.test.ts` (reuse the file's existing surge fixtures/imports; add the import):

```typescript
import { detectCandidateWithFeatures } from "../../src/live/candidate";

it("detectCandidateWithFeatures returns the candidate AND its feature vector on a firing", () => {
  // Reuse the same surge inputs the existing 'detects a surge' test uses in this file.
  const res = detectCandidateWithFeatures(SURGE_MARKET, SURGE_CANDLES, SURGE_TRADES);
  expect(res).not.toBeNull();
  expect(res!.candidate.direction).toBe("yes");
  expect(res!.features.cusumFired).toBe(true);
});
```

(If the existing test uses inline fixtures rather than `SURGE_*` constants, construct the same surge inputs inline here — a flat baseline of 8 candles at 50¢ then a 3-candle surge to ~86¢ with yes-dominant trades, matching the existing passing surge test in this file.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/live/candidate.test.ts`
Expected: FAIL — `detectCandidateWithFeatures` not exported.

- [ ] **Step 3: Refactor `detectCandidate` to delegate, add the new export**

Replace the body of `detectCandidate` (lines 34-52) with:

```typescript
export function detectCandidateWithFeatures(
  market: LiveMarket,
  candles: Candle[],
  trades: Trade[],
  windowSize = 3,
  baselineSize = 5,
): { candidate: LiveCandidate; features: FeatureVector } | null {
  const slices = slidingWindows(candles, windowSize, baselineSize);
  if (slices.length === 0) return null;
  const slice = slices[slices.length - 1]!; // latest window, no lookahead
  const wt = trades.filter(
    (t) => t.createdTs >= slice.window[0]!.endPeriodTs && t.createdTs <= slice.endTs,
  );
  const f = buildFeatures(slice.window, wt, slice.baseline);
  const { isAnomaly, direction } = detectAnomaly(f);
  if (!isAnomaly || !direction) return null;
  const entryCents = direction === "yes" ? market.yesAskCents : 100 - market.yesBidCents;
  return { candidate: { market, direction, anomalyScore: anomalyScore(f), entryCents }, features: f };
}

export function detectCandidate(
  market: LiveMarket,
  candles: Candle[],
  trades: Trade[],
  windowSize = 3,
  baselineSize = 5,
): LiveCandidate | null {
  return detectCandidateWithFeatures(market, candles, trades, windowSize, baselineSize)?.candidate ?? null;
}
```

- [ ] **Step 4: Run to verify pass (incl. existing candidate/probe regressions)**

Run: `npx vitest run tests/live/candidate.test.ts && npx vitest run && npx tsc --noEmit`
Expected: new test PASS; the full suite stays green (detectCandidate behavior unchanged); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/live/candidate.ts tests/live/candidate.test.ts
git commit -m "feat(detection): detectCandidateWithFeatures exposing the feature vector (non-breaking)"
```

---

### Task 4: Entry engine (`src/census/entry.ts`)

**Files:**
- Create: `src/census/entry.ts`
- Test: `tests/census/entry.test.ts`

**Interfaces:**
- Consumes: `InsiderDb` (Task 1), cell functions (Task 2), `detectCandidateWithFeatures` (Task 3), `isEventPast` (`../live/eventDate`), `LiveMarket/Candle/Trade` (`../kalshi/types`).
- Produces:
  - `interface MarketData { market: LiveMarket; candles: Candle[]; trades: Trade[] }`
  - `interface EntryFunnel { universe: number; pastEvent: number; sports: number; scanned: number; fired: number; entered: number }`
  - `runEntryCycle(markets: MarketData[], db: InsiderDb, nowTs: number): EntryFunnel`

- [ ] **Step 1: Write the failing test**

Create `tests/census/entry.test.ts`. Build one firing market (flat→surge, yes-dominant), one past-event market, one sports market; assert only the firing non-sports non-past market is entered, once.

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InsiderDb } from "../../src/census/insiderDb";
import { runEntryCycle, MarketData } from "../../src/census/entry";
import { LiveMarket, Candle, Trade } from "../../src/kalshi/types";

const dirs: string[] = [];
const tmpDb = () => { const d = mkdtempSync(join(tmpdir(), "entry-")); dirs.push(d); return join(d, "i.db"); };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const NOW = Math.floor(Date.UTC(2026, 6, 30, 12, 0, 0) / 1000);
const candle = (ts: number, close: number, vol: number): Candle => ({
  marketTicker: "M", seriesTicker: "S", endPeriodTs: ts, periodMinutes: 60,
  price: { open: close, high: close, low: close, close, mean: close },
  yesBid: { open: close - 1, high: close - 1, low: close - 1, close: close - 1 },
  yesAsk: { open: close + 1, high: close + 1, low: close + 1, close: close + 1 },
  volume: vol, openInterest: 100,
});
function surge(ticker: string): { candles: Candle[]; trades: Trade[] } {
  const flat = Array.from({ length: 8 }, (_, i) => candle(i, 50, 5));
  const s = [candle(8, 62, 80), candle(9, 74, 80), candle(10, 86, 80)];
  const trades: Trade[] = s.map((c, i) => ({ tradeId: `${ticker}-${i}`, ticker, yesPriceCents: c.price.close, count: 80, takerSide: "yes", createdTs: c.endPeriodTs }));
  return { candles: [...flat, ...s], trades };
}
function mkt(ticker: string, series: string): LiveMarket {
  return { marketTicker: ticker, seriesTicker: series, category: series, openTs: NOW - 100000, closeTs: NOW + 3600, liquidityVolume: 5000, yesBidCents: 60, yesAskCents: 62 };
}

describe("runEntryCycle", () => {
  it("enters only firing, non-sports, non-past markets — once", () => {
    const db = new InsiderDb(tmpDb());
    const fire = surge("KXAOCMENTION-26JUL30-A");
    const markets: MarketData[] = [
      { market: mkt("KXAOCMENTION-26JUL30-A", "KXAOCMENTION"), ...fire },          // fires, mentions, future -> ENTER
      { market: mkt("KXAOCMENTION-26JUL10-B", "KXAOCMENTION"), ...surge("KXAOCMENTION-26JUL10-B") }, // past event -> skip
      { market: mkt("KXMLBMENTION-26JUL30-C", "KXMLBMENTION"), ...surge("KXMLBMENTION-26JUL30-C") }, // sports -> skip
    ];
    const f = runEntryCycle(markets, db, NOW);
    expect(f.entered).toBe(1);
    expect(f.pastEvent).toBe(1);
    expect(f.sports).toBe(1);
    expect(db.listOpen()).toHaveLength(1);
    // second run does not double-enter
    expect(runEntryCycle(markets, db, NOW).entered).toBe(0);
    db.close();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/census/entry.test.ts`
Expected: FAIL — `../../src/census/entry` not found.

- [ ] **Step 3: Implement `src/census/entry.ts`**

```typescript
import { LiveMarket, Candle, Trade } from "../kalshi/types";
import { InsiderDb, OpenBet } from "./insiderDb";
import { detectCandidateWithFeatures } from "../live/candidate";
import { isEventPast } from "../live/eventDate";
import { categoryOf, bandOf, timeBucketOf, scoreBucketOf, detectorLabel, cellKey, SPORTS_CATEGORY } from "./cell";

export interface MarketData { market: LiveMarket; candles: Candle[]; trades: Trade[] }
export interface EntryFunnel { universe: number; pastEvent: number; sports: number; scanned: number; fired: number; entered: number }

const SENSITIVITY = "medium";

export function runEntryCycle(markets: MarketData[], db: InsiderDb, nowTs: number): EntryFunnel {
  const f: EntryFunnel = { universe: markets.length, pastEvent: 0, sports: 0, scanned: 0, fired: 0, entered: 0 };
  for (const md of markets) {
    const m = md.market;
    if (isEventPast(m.marketTicker, nowTs)) { f.pastEvent++; continue; }
    const category = categoryOf(m.seriesTicker);
    if (category === SPORTS_CATEGORY) { f.sports++; continue; }
    f.scanned++;
    const res = detectCandidateWithFeatures(m, md.candles, md.trades);
    if (!res) continue;
    f.fired++;
    const { candidate, features } = res;
    const minsToClose = Math.max(0, (m.closeTs - nowTs) / 60);
    const bet: OpenBet = {
      ticker: m.marketTicker, side: candidate.direction, entryPriceCents: candidate.entryCents,
      count: candidate.entryCents > 0 ? 1 / candidate.entryCents : 0,
      openedTs: nowTs, closeMs: m.closeTs * 1000,
      category, detector: detectorLabel(features), sensitivity: SENSITIVITY, direction: candidate.direction,
      entryBand: bandOf(candidate.entryCents), timeBucket: timeBucketOf(minsToClose),
      scoreBucket: scoreBucketOf(candidate.anomalyScore), anomalyScore: candidate.anomalyScore,
      cellKey: cellKey({
        category, detector: detectorLabel(features), sensitivity: SENSITIVITY, direction: candidate.direction,
        entryBand: bandOf(candidate.entryCents), timeBucket: timeBucketOf(minsToClose), scoreBucket: scoreBucketOf(candidate.anomalyScore),
      }),
    };
    if (db.openBet(bet)) f.entered++;
  }
  return f;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/census/entry.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/census/entry.ts tests/census/entry.test.ts
git commit -m "feat(census): signal-triggered entry cycle (past-event + sports gates, enter-once)"
```

---

### Task 5: Settlement engine (`src/census/settle.ts`)

**Files:**
- Create: `src/census/settle.ts`
- Test: `tests/census/settle.test.ts`

**Interfaces:**
- Consumes: `InsiderDb` (Task 1).
- Produces:
  - `interface SettlementRecord { ticker: string; result: "yes" | "no"; settledAt: number; source: string }`
  - `runSettleCycle(settlements: SettlementRecord[], db: InsiderDb): { matched: number; settled: number }` — for each settlement, settle both sides' open bets on that ticker (a `yes`-result settles yes-bets as wins and no-bets as losses).

- [ ] **Step 1: Write the failing test**

Create `tests/census/settle.test.ts`: open a yes-bet and a no-bet on the same ticker, feed a `yes` result, assert the yes cell is a win and the no cell is a loss, and open is cleared.

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InsiderDb, OpenBet } from "../../src/census/insiderDb";
import { runSettleCycle } from "../../src/census/settle";

const dirs: string[] = [];
const tmpDb = () => { const d = mkdtempSync(join(tmpdir(), "settle-")); dirs.push(d); return join(d, "i.db"); };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const openBet = (side: "yes"|"no", cell: string): OpenBet => ({
  ticker: "KXT-26JUL30-A", side, cellKey: cell, entryPriceCents: 50, count: 1/50, openedTs: 1, closeMs: 2,
  category: "mentions", detector: "cusum+imbalance", sensitivity: "medium", direction: side,
  entryBand: "b50", timeBucket: "1d", scoreBucket: "med", anomalyScore: 2,
});

describe("runSettleCycle", () => {
  it("settles yes-bets as wins and no-bets as losses on a yes result", () => {
    const db = new InsiderDb(tmpDb());
    db.openBet(openBet("yes", "mentions|cusum+imbalance|medium|yes|b50|1d|med"));
    db.openBet(openBet("no", "mentions|cusum+imbalance|medium|no|b50|1d|med"));
    const r = runSettleCycle([{ ticker: "KXT-26JUL30-A", result: "yes", settledAt: 9, source: "market-result" }], db);
    expect(r.settled).toBe(2);
    const cells = Object.fromEntries(db.listCells().map((c) => [c.direction, c]));
    expect(cells["yes"]!.wins).toBe(1);
    expect(cells["no"]!.wins).toBe(0);
    expect(db.listOpen()).toHaveLength(0);
    db.close();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/census/settle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/census/settle.ts`**

```typescript
import { InsiderDb } from "./insiderDb";

export interface SettlementRecord { ticker: string; result: "yes" | "no"; settledAt: number; source: string }

export function runSettleCycle(settlements: SettlementRecord[], db: InsiderDb): { matched: number; settled: number } {
  let matched = 0, settled = 0;
  const open = db.listOpen();
  for (const s of settlements) {
    const sides = new Set(open.filter((o) => o.ticker === s.ticker).map((o) => o.side));
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

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/census/settle.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/census/settle.ts tests/census/settle.test.ts
git commit -m "feat(census): settlement cycle (won=result===side, fold into cells)"
```

---

### Task 6: Spine reader + local hydrate + CLI runner (integration)

**Files:**
- Create: `src/census/spine.ts` (spine.db read contract + reader), `src/census/hydrate.ts` (local API fetch → spine.db), `src/census/cli.ts` (run one cycle)
- Test: `tests/census/spine.test.ts` (end-to-end reader→entry→settle over a fixture spine.db)

**Interfaces:**
- Consumes: `better-sqlite3`, `MarketData` (Task 4), `SettlementRecord` (Task 5), `HistoricalClient` (`../kalshi/historicalClient`), `loadConfig`/`loadDotEnv`.
- Produces:
  - `SPINE_SCHEMA` (the CREATE statements the production poller must satisfy: `spine_markets`, `spine_candles`, `spine_trades`, `spine_settlement`).
  - `class SpineReader { constructor(path: string); listMarketData(): MarketData[]; listSettlements(): SettlementRecord[]; close() }`.

- [ ] **Step 1: Write the failing end-to-end test**

Create `tests/census/spine.test.ts`: build a fixture `spine.db` (write markets + a surge's candles/trades + a settlement using the `SPINE_SCHEMA` and raw `better-sqlite3` inserts), then run `SpineReader` → `runEntryCycle` → `runSettleCycle` and assert a cell rollup exists with `n===1`.

```typescript
import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpineReader, SPINE_SCHEMA } from "../../src/census/spine";
import { InsiderDb } from "../../src/census/insiderDb";
import { runEntryCycle } from "../../src/census/entry";
import { runSettleCycle } from "../../src/census/settle";

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "spine-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const NOW = Math.floor(Date.UTC(2026, 6, 30, 12, 0, 0) / 1000);

it("reads a fixture spine.db and runs the full enter->settle->rollup loop", () => {
  const d = dir();
  const spinePath = join(d, "spine.db");
  const sp = new Database(spinePath);
  sp.exec(SPINE_SCHEMA);
  // one firing market (flat 50c x8 then surge to 86c) + yes-dominant trades + a yes settlement
  sp.prepare(`INSERT INTO spine_markets (ticker, series, yes_bid_cents, yes_ask_cents, open_ts, close_ts) VALUES (?,?,?,?,?,?)`)
    .run("KXAOCMENTION-26JUL30-A", "KXAOCMENTION", 60, 62, NOW - 100000, NOW + 3600);
  const ins = sp.prepare(`INSERT INTO spine_candles (ticker, end_period_ts, period_minutes, close_cents, volume) VALUES (?,?,?,?,?)`);
  for (let i = 0; i < 8; i++) ins.run("KXAOCMENTION-26JUL30-A", i, 60, 50, 5);
  [62, 74, 86].forEach((c, i) => ins.run("KXAOCMENTION-26JUL30-A", 8 + i, 60, c, 80));
  const it2 = sp.prepare(`INSERT INTO spine_trades (ticker, created_ts, yes_price_cents, count, taker_side) VALUES (?,?,?,?,?)`);
  [62, 74, 86].forEach((c, i) => it2.run("KXAOCMENTION-26JUL30-A", 8 + i, c, 80, "yes"));
  sp.close();

  const reader = new SpineReader(spinePath);
  const db = new InsiderDb(join(d, "insider.db"));
  const ef = runEntryCycle(reader.listMarketData(), db, NOW);
  expect(ef.entered).toBe(1);

  // now add a settlement and settle
  const sp2 = new Database(spinePath);
  sp2.prepare(`INSERT INTO spine_settlement (ticker, result, settled_at, source) VALUES (?,?,?,?)`)
    .run("KXAOCMENTION-26JUL30-A", "yes", NOW + 7200, "market-result");
  sp2.close();
  const sf = runSettleCycle(reader.listSettlements(), db);
  expect(sf.settled).toBe(1);
  expect(db.listCells()[0]!.n).toBe(1);
  reader.close(); db.close();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/census/spine.test.ts`
Expected: FAIL — `../../src/census/spine` not found.

- [ ] **Step 3: Implement `src/census/spine.ts`**

```typescript
import Database from "better-sqlite3";
import { MarketData } from "./entry";
import { SettlementRecord } from "./settle";
import { LiveMarket, Candle, Trade } from "../kalshi/types";

// The read contract the production poller (Fast99Follower/agent) must satisfy. Phase 1 fills it
// locally via hydrate.ts. Columns are the minimum the detectors + bucketing need.
export const SPINE_SCHEMA = `
CREATE TABLE IF NOT EXISTS spine_markets (
  ticker TEXT PRIMARY KEY, series TEXT, yes_bid_cents INTEGER, yes_ask_cents INTEGER, open_ts INTEGER, close_ts INTEGER
);
CREATE TABLE IF NOT EXISTS spine_candles (
  ticker TEXT, end_period_ts INTEGER, period_minutes INTEGER, close_cents INTEGER, volume REAL
);
CREATE TABLE IF NOT EXISTS spine_trades (
  ticker TEXT, created_ts INTEGER, yes_price_cents INTEGER, count REAL, taker_side TEXT
);
CREATE TABLE IF NOT EXISTS spine_settlement (
  ticker TEXT PRIMARY KEY, result TEXT, settled_at INTEGER, source TEXT
);
`;

export class SpineReader {
  private db: Database.Database;
  constructor(path: string) { this.db = new Database(path, { readonly: true }); }

  listMarketData(): MarketData[] {
    const markets = this.db.prepare(`SELECT * FROM spine_markets`).all() as any[];
    return markets.map((m) => {
      const market: LiveMarket = {
        marketTicker: m.ticker, seriesTicker: m.series, category: m.series,
        openTs: m.open_ts, closeTs: m.close_ts, liquidityVolume: 0,
        yesBidCents: m.yes_bid_cents, yesAskCents: m.yes_ask_cents,
      };
      const candles: Candle[] = (this.db.prepare(`SELECT * FROM spine_candles WHERE ticker=? ORDER BY end_period_ts`).all(m.ticker) as any[])
        .map((c) => ({
          marketTicker: m.ticker, seriesTicker: m.series, endPeriodTs: c.end_period_ts, periodMinutes: c.period_minutes,
          price: { open: c.close_cents, high: c.close_cents, low: c.close_cents, close: c.close_cents, mean: c.close_cents },
          yesBid: { open: c.close_cents - 1, high: c.close_cents - 1, low: c.close_cents - 1, close: c.close_cents - 1 },
          yesAsk: { open: c.close_cents + 1, high: c.close_cents + 1, low: c.close_cents + 1, close: c.close_cents + 1 },
          volume: c.volume, openInterest: 0,
        }));
      const trades: Trade[] = (this.db.prepare(`SELECT * FROM spine_trades WHERE ticker=? ORDER BY created_ts`).all(m.ticker) as any[])
        .map((t, i) => ({ tradeId: `${m.ticker}-${i}`, ticker: m.ticker, yesPriceCents: t.yes_price_cents, count: t.count, takerSide: t.taker_side, createdTs: t.created_ts }));
      return { market, candles, trades };
    });
  }

  listSettlements(): SettlementRecord[] {
    return (this.db.prepare(`SELECT * FROM spine_settlement`).all() as any[])
      .map((s) => ({ ticker: s.ticker, result: s.result, settledAt: s.settled_at, source: s.source }));
  }

  close(): void { this.db.close(); }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/census/spine.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Implement the local hydrate + CLI (no unit test — thin API glue, smoke-run manually)**

Create `src/census/hydrate.ts` — the ONLY component that calls Kalshi (local stand-in for the poller), reusing `HistoricalClient`'s existing rate-limit backoff + timeouts. Exact reused signatures (from `src/kalshi/historicalClient.ts`): `listOpenMarkets({ minVolume?, maxMarkets?, maxSpreadCents?, categories? }): Promise<LiveMarket[]>`, `getCandles(seriesTicker, marketTicker, startTs, endTs, periodInterval: 1|60|1440): Promise<Candle[]>`, `getTrades(marketTicker, minTs?, maxTs?): Promise<Trade[]>`. Flow: `openInsiderDb`-style open a `spine.db` (`new Database(path); db.exec(SPINE_SCHEMA)`), then:
1. `const markets = await client.listOpenMarkets({ minVolume: 100, maxMarkets: 1000, categories: ["Entertainment","Social","Mentions","Politics","Economics","Companies"] })` (non-sports set; excludes MVE via the existing client filter).
2. For each market, `getCandles(seriesTicker, marketTicker, nowTs - 74*3600, nowTs, 60)` (hourly, ~74h) and `getTrades(marketTicker, nowTs - 74*3600, nowTs)`; `INSERT OR REPLACE` its row into `spine_markets` and its candles/trades into `spine_candles`/`spine_trades` (map `Candle.price.close`→`close_cents`, `Candle.endPeriodTs`→`end_period_ts`, etc.; `Trade.takerSide`→`taker_side`).
3. For settlement: any ticker currently in `insider_open` that has resolved — fetch its result and `INSERT OR IGNORE` into `spine_settlement`. (Kalshi exposes market `status`/`result`; if the market client lacks a result fetch, add a minimal `getMarketResult(ticker)` to `HistoricalClient` returning `{ result: "yes"|"no" } | null` for `status==="settled"` markets — a small read-only addition.)

Create `src/census/cli.ts`: `loadDotEnv()`; parse `--spine <path>` (default `./.census/spine.db`), `--insider <path>` (default `./.census/insider.db`), `--hydrate` (optional; runs hydrate first); open `SpineReader` + `InsiderDb`; `runEntryCycle` then `runSettleCycle`; print the entry funnel, settlement counts, and the top cells by `pnl_cents/traded_cents` (ret-on-traded). No orders placed anywhere.

Add an npm script to `package.json`: `"census": "tsx src/census/cli.ts"`.

- [ ] **Step 6: Smoke-run the CLI on a fixture, then commit**

Run: `npx vitest run` (full suite green) and `npx tsc --noEmit` (clean). Then a no-hydrate smoke run against the test-style fixture is covered by the Step-1 test; a live `--hydrate` run is a manual/local check, not part of CI.

```bash
git add src/census/spine.ts src/census/hydrate.ts src/census/cli.ts tests/census/spine.test.ts package.json
git commit -m "feat(census): SpineReader + local hydrate + CLI runner (enter->settle->rollup end-to-end)"
```

---

## Notes for the executor
- This is Phase 1 only (local core). The production JS poller history-extension and the Ai1 container deploy are Phases 3 — explicitly OUT OF SCOPE here.
- Everything is PAPER — no order-placement code may be added.
- If `better-sqlite3`'s native build fails on this Node 18 machine, pin `better-sqlite3@9.4.3` and retry; do not switch to `node:sqlite` (unavailable on Node 18).
