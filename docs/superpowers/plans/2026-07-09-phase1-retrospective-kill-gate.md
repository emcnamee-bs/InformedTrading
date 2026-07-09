# Phase 1 — Retrospective Math Kill-Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer one falsifiable question on real resolved Kalshi markets — *do windows exhibiting a math-anomaly signature drift favorably to resolution, net of fees, more than non-anomaly windows?* — and emit a PASS / KILL / INCONCLUSIVE verdict.

**Architecture:** A batch replay pipeline. Fetch historical candles + trades for resolved (settled) Kalshi markets, cache to JSONL, replay each market forward in time (no lookahead), compute a per-window feature vector from pure-function detectors, flag math-anomaly windows, and measure each anomaly's realized net-of-fee return from a realistic (spread-crossed) entry to the known resolution. Aggregate by stratum and compare anomaly vs. control drift. No database, no AI layer, no live trading — this is the go/no-go gate for the rest of the system (see `SYSTEM_DESIGN_PROPOSAL.md` §0, §10).

**Tech Stack:** TypeScript (ESM), Node.js 22 LTS, `tsx` (run TS without a build), Vitest (tests), `undici`/global `fetch` (Kalshi REST). No ORM, no database in Phase 1.

## Global Constraints

- **Language/runtime:** TypeScript strict mode, ESM (`"type": "module"`), Node.js 22 LTS. (`SYSTEM_DESIGN_PROPOSAL.md` §9)
- **Module resolution:** `"moduleResolution": "Bundler"` so imports need no `.js` suffix; run via `tsx`, no build step in Phase 1.
- **Prices:** YES price is in **cents, integer 1–99** (`Candle.price` etc.). All probability math runs on **log-odds** of `price/100`, never raw cents. (§5.1)
- **Fees:** Kalshi per-contract fee = `ceil(0.07 · p · (1−p) · 100) / 100` dollars, `p = priceCents/100`. Peaks near 50¢. Verify the exact live schedule per series at build time; this formula is the Phase-1 model. (§8.1)
- **No lookahead:** during replay a window's features may use only candles/trades at or before that window's timestamp. The resolution outcome is used **only** to compute realized drift after an observation is recorded, never as a feature. (§10)
- **Abstain, don't guess:** a detector whose volume/history floor is unmet returns `null` (abstain), never a noisy number. (§5, #4)
- **Selection-bias-free:** record observations for anomaly **and** control (non-anomaly) windows; the verdict compares the two. (§2, §10, #16)
- **Synthetic data is unit-test-only** — never used to establish the edge. Edge evidence comes exclusively from real resolved markets. (§3.3, #7)
- **Kill-gate honesty:** if no stratum clears the bar, the correct output is KILL or INCONCLUSIVE, surfaced plainly — not a lowered bar. (§7, §10)

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `loadConfig(): Config` where `Config = { kalshiBaseUrl: string; cacheDir: string; requestsPerSecond: number }`. npm scripts `test`, `replay`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "insider-flow-follower",
  "version": "0.2.0",
  "type": "module",
  "private": true,
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "replay": "tsx src/replay/cli.ts"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.7.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`, `.gitignore`, `.env.example`**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

`.gitignore`:
```
node_modules
dist
.cache
.env
```

`.env.example`:
```
KALSHI_BASE_URL=https://api.elections.kalshi.com/trade-api/v2
CACHE_DIR=.cache
REQUESTS_PER_SECOND=5
```

- [ ] **Step 4: Write the failing test for config**

`tests/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("falls back to defaults when env is empty", () => {
    const cfg = loadConfig({});
    expect(cfg.kalshiBaseUrl).toContain("kalshi");
    expect(cfg.cacheDir).toBe(".cache");
    expect(cfg.requestsPerSecond).toBe(5);
  });

  it("reads overrides from the provided env object", () => {
    const cfg = loadConfig({ CACHE_DIR: "/tmp/x", REQUESTS_PER_SECOND: "2" });
    expect(cfg.cacheDir).toBe("/tmp/x");
    expect(cfg.requestsPerSecond).toBe(2);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm install && npm run test -- tests/config.test.ts`
Expected: FAIL — `Cannot find module '../src/config'`.

- [ ] **Step 6: Implement `src/config.ts`**

```ts
export interface Config {
  kalshiBaseUrl: string;
  cacheDir: string;
  requestsPerSecond: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    kalshiBaseUrl:
      env.KALSHI_BASE_URL ?? "https://api.elections.kalshi.com/trade-api/v2",
    cacheDir: env.CACHE_DIR ?? ".cache",
    requestsPerSecond: Number(env.REQUESTS_PER_SECOND ?? "5"),
  };
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test -- tests/config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git init 2>/dev/null; git add -A
git commit -m "chore: scaffold Phase 1 kill-gate project (config + tooling)"
```

---

### Task 2: Domain types + Kalshi fee model

**Files:**
- Create: `src/kalshi/types.ts`
- Create: `src/expectancy/fees.ts`
- Test: `tests/expectancy/fees.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Ohlc = { open: number; high: number; low: number; close: number }`
  - `Candle` and `Trade` interfaces (per §3.1/§3.2).
  - `Side = "yes" | "no"`.
  - `feePerContract(priceCents: number): number` — dollars, rounded up to the cent.

- [ ] **Step 1: Create `src/kalshi/types.ts`**

```ts
export type Side = "yes" | "no";

export interface Ohlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Candle {
  marketTicker: string;
  seriesTicker: string;
  endPeriodTs: number; // unix seconds
  periodMinutes: 1 | 60 | 1440;
  price: Ohlc & { mean: number | null }; // YES price, cents 1..99
  yesBid: Ohlc; // cents
  yesAsk: Ohlc; // cents
  volume: number; // contracts traded this period
  openInterest: number; // outstanding contracts
}

export interface Trade {
  tradeId: string;
  ticker: string;
  yesPriceCents: number;
  count: number; // contracts
  takerSide: Side; // aggressor side
  createdTs: number; // unix seconds
}

export interface ResolvedMarket {
  marketTicker: string;
  seriesTicker: string;
  category: string;
  outcome: Side; // "yes" if settled YES, else "no"
  openTs: number;
  closeTs: number;
  liquidityCents: number; // Kalshi liquidity metric (proxy)
}
```

- [ ] **Step 2: Write the failing test for fees**

`tests/expectancy/fees.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { feePerContract } from "../../src/expectancy/fees";

describe("feePerContract", () => {
  it("peaks near 50 cents and rounds up to the cent", () => {
    // 0.07 * 0.5 * 0.5 = 0.0175 -> ceil to 0.02
    expect(feePerContract(50)).toBeCloseTo(0.02, 6);
  });

  it("is small near the edges", () => {
    // 0.07 * 0.05 * 0.95 = 0.003325 -> ceil to 0.01
    expect(feePerContract(5)).toBeCloseTo(0.01, 6);
  });

  it("is monotonic increasing from an edge toward 50c", () => {
    expect(feePerContract(30)).toBeGreaterThanOrEqual(feePerContract(10));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- tests/expectancy/fees.test.ts`
Expected: FAIL — cannot find `../../src/expectancy/fees`.

- [ ] **Step 4: Implement `src/expectancy/fees.ts`**

```ts
/**
 * Kalshi per-contract trading fee, in dollars.
 * fee = ceil(0.07 * p * (1 - p) * 100) / 100, with p = priceCents / 100.
 * Peaks near 50c. NOTE: verify exact live schedule per series at build time (§8.1).
 */
export function feePerContract(priceCents: number): number {
  const p = priceCents / 100;
  const rawDollars = 0.07 * p * (1 - p);
  return Math.ceil(rawDollars * 100) / 100;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- tests/expectancy/fees.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: domain types + Kalshi fee model"
```

---

### Task 3: Stats helpers + log-odds transform

**Files:**
- Create: `src/math/stats.ts`
- Create: `src/math/logOdds.ts`
- Test: `tests/math/stats.test.ts`
- Test: `tests/math/logOdds.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `mean(xs: number[]): number`
  - `sampleStd(xs: number[]): number` (n−1 denominator; 0 for length < 2)
  - `meanCI95(xs: number[]): { mean: number; lo: number; hi: number; n: number }`
  - `toLogOdds(priceCents: number): number`
  - `clampProb(p: number, eps?: number): number`

- [ ] **Step 1: Write the failing test for stats**

`tests/math/stats.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mean, sampleStd, meanCI95 } from "../../src/math/stats";

describe("stats", () => {
  it("mean of [1,2,3] is 2", () => expect(mean([1, 2, 3])).toBe(2));
  it("sampleStd of [2,4,4,4,5,5,7,9] is 2.138...", () =>
    expect(sampleStd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4));
  it("sampleStd of a single value is 0", () =>
    expect(sampleStd([5])).toBe(0));
  it("meanCI95 brackets the mean and reports n", () => {
    const ci = meanCI95([1, 2, 3, 4, 5]);
    expect(ci.mean).toBe(3);
    expect(ci.lo).toBeLessThan(3);
    expect(ci.hi).toBeGreaterThan(3);
    expect(ci.n).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/math/stats.test.ts`
Expected: FAIL — cannot find `../../src/math/stats`.

- [ ] **Step 3: Implement `src/math/stats.ts`**

```ts
export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function sampleStd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const ss = xs.reduce((a, b) => a + (b - m) * (b - m), 0);
  return Math.sqrt(ss / (xs.length - 1));
}

export interface MeanCI {
  mean: number;
  lo: number;
  hi: number;
  n: number;
}

/** Normal-approx 95% CI for the mean (adequate at the sample sizes the gate needs). */
export function meanCI95(xs: number[]): MeanCI {
  const n = xs.length;
  const m = mean(xs);
  if (n < 2) return { mean: m, lo: m, hi: m, n };
  const se = sampleStd(xs) / Math.sqrt(n);
  return { mean: m, lo: m - 1.96 * se, hi: m + 1.96 * se, n };
}
```

- [ ] **Step 4: Write the failing test for log-odds**

`tests/math/logOdds.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { toLogOdds, clampProb } from "../../src/math/logOdds";

describe("logOdds", () => {
  it("50c maps to 0", () => expect(toLogOdds(50)).toBeCloseTo(0, 9));
  it("is symmetric: logodds(30) === -logodds(70)", () =>
    expect(toLogOdds(30)).toBeCloseTo(-toLogOdds(70), 9));
  it("clamps extreme prices instead of returning +/-Infinity", () => {
    expect(Number.isFinite(toLogOdds(0))).toBe(true);
    expect(Number.isFinite(toLogOdds(100))).toBe(true);
  });
  it("clampProb keeps values inside (0,1)", () => {
    expect(clampProb(0)).toBeGreaterThan(0);
    expect(clampProb(1)).toBeLessThan(1);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm run test -- tests/math/logOdds.test.ts`
Expected: FAIL — cannot find `../../src/math/logOdds`.

- [ ] **Step 6: Implement `src/math/logOdds.ts`**

```ts
export function clampProb(p: number, eps = 1e-4): number {
  return Math.min(1 - eps, Math.max(eps, p));
}

/** Log-odds of a YES price given in cents (1..99). Clamps to keep finite. */
export function toLogOdds(priceCents: number): number {
  const p = clampProb(priceCents / 100);
  return Math.log(p / (1 - p));
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test -- tests/math/stats.test.ts tests/math/logOdds.test.ts`
Expected: PASS (all).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: stats helpers + log-odds transform"
```

---

### Task 4: CUSUM price-jump detector

**Files:**
- Create: `src/math/cusum.ts`
- Test: `tests/math/cusum.test.ts`

**Interfaces:**
- Consumes: `mean`, `sampleStd` from `src/math/stats`.
- Produces: `cusum(logOddsSeries: number[], k: number, h: number): CusumResult` where
  `CusumResult = { sHi: number; sLo: number; fired: boolean; direction: Side | null }`.
  Floor: series length < 3 → `{ sHi:0, sLo:0, fired:false, direction:null }` (abstain).

- [ ] **Step 1: Write the failing test**

`tests/math/cusum.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { cusum } from "../../src/math/cusum";
import { toLogOdds } from "../../src/math/logOdds";

describe("cusum", () => {
  it("does not fire on a flat, slightly noisy series", () => {
    const prices = [50, 51, 49, 50, 51, 49, 50, 51, 49, 50];
    const lo = prices.map(toLogOdds);
    expect(cusum(lo, 0.5, 5).fired).toBe(false);
  });

  it("fires YES on a strong sustained upward jump", () => {
    const prices = [50, 50, 50, 50, 60, 70, 80, 88, 92, 95];
    const lo = prices.map(toLogOdds);
    const r = cusum(lo, 0.5, 4);
    expect(r.fired).toBe(true);
    expect(r.direction).toBe("yes");
  });

  it("fires NO on a strong sustained downward jump", () => {
    const prices = [50, 50, 50, 50, 40, 30, 20, 12, 8, 5];
    const lo = prices.map(toLogOdds);
    const r = cusum(lo, 0.5, 4);
    expect(r.fired).toBe(true);
    expect(r.direction).toBe("no");
  });

  it("abstains (no fire) on too-short series", () => {
    expect(cusum([0.1, 0.2], 0.5, 4).fired).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/math/cusum.test.ts`
Expected: FAIL — cannot find `../../src/math/cusum`.

- [ ] **Step 3: Implement `src/math/cusum.ts`**

```ts
import { Side } from "../kalshi/types";
import { sampleStd } from "./stats";

export interface CusumResult {
  sHi: number;
  sLo: number;
  fired: boolean;
  direction: Side | null;
}

/**
 * Two-sided CUSUM on standardized increments of a log-odds series.
 * Detects a sustained regime shift away from the no-drift (zero) expectation.
 * `k` = slack (in std units), `h` = decision threshold. Abstains if < 3 points.
 */
export function cusum(logOddsSeries: number[], k: number, h: number): CusumResult {
  if (logOddsSeries.length < 3) {
    return { sHi: 0, sLo: 0, fired: false, direction: null };
  }
  const diffs: number[] = [];
  for (let i = 1; i < logOddsSeries.length; i++) {
    diffs.push(logOddsSeries[i]! - logOddsSeries[i - 1]!);
  }
  const sd = sampleStd(diffs) || 1;
  let sHi = 0;
  let sLo = 0;
  for (const d of diffs) {
    const z = d / sd;
    sHi = Math.max(0, sHi + z - k);
    sLo = Math.min(0, sLo + z + k);
  }
  const firedHi = sHi > h;
  const firedLo = sLo < -h;
  const fired = firedHi || firedLo;
  let direction: Side | null = null;
  if (fired) direction = sHi >= -sLo ? "yes" : "no";
  return { sHi, sLo, fired, direction };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/math/cusum.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: CUSUM price-jump detector on log-odds"
```

---

### Task 5: Order-flow features (imbalance, volume z-score, OI delta)

**Files:**
- Create: `src/math/orderFlow.ts`
- Test: `tests/math/orderFlow.test.ts`

**Interfaces:**
- Consumes: `mean`, `sampleStd` from `src/math/stats`; `Candle`, `Trade`, `Side` from `src/kalshi/types`.
- Produces:
  - `flowImbalance(trades: Trade[]): number | null` — `(yes−no)/(yes+no)` in [−1,1]; `null` if no trades (floor).
  - `volumeZScore(windowVol: number, baselineVols: number[]): number | null` — `null` if baseline length < 5 (floor).
  - `oiDelta(candles: Candle[]): number | null` — last minus first open interest; `null` if < 2 candles.

- [ ] **Step 1: Write the failing test**

`tests/math/orderFlow.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { flowImbalance, volumeZScore, oiDelta } from "../../src/math/orderFlow";
import { Trade, Candle } from "../../src/kalshi/types";

const trade = (takerSide: "yes" | "no", count: number): Trade => ({
  tradeId: Math.random().toString(36),
  ticker: "T",
  yesPriceCents: 50,
  count,
  takerSide,
  createdTs: 0,
});

describe("order-flow features", () => {
  it("flowImbalance is +1 for all-YES taker flow", () =>
    expect(flowImbalance([trade("yes", 10), trade("yes", 5)])).toBe(1));
  it("flowImbalance is 0 for balanced flow", () =>
    expect(flowImbalance([trade("yes", 5), trade("no", 5)])).toBe(0));
  it("flowImbalance abstains (null) with no trades", () =>
    expect(flowImbalance([])).toBeNull();

  );
  it("volumeZScore flags a spike above baseline", () => {
    const z = volumeZScore(100, [10, 12, 9, 11, 10]);
    expect(z).not.toBeNull();
    expect(z as number).toBeGreaterThan(3);
  });
  it("volumeZScore abstains when baseline too short", () =>
    expect(volumeZScore(100, [10, 12])).toBeNull());
  it("oiDelta reports the rise in open interest", () => {
    const c = (oi: number): Candle => ({
      marketTicker: "T", seriesTicker: "S", endPeriodTs: 0, periodMinutes: 1,
      price: { open: 50, high: 50, low: 50, close: 50, mean: 50 },
      yesBid: { open: 49, high: 49, low: 49, close: 49 },
      yesAsk: { open: 51, high: 51, low: 51, close: 51 },
      volume: 0, openInterest: oi,
    });
    expect(oiDelta([c(100), c(140)])).toBe(40);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/math/orderFlow.test.ts`
Expected: FAIL — cannot find `../../src/math/orderFlow`.

- [ ] **Step 3: Implement `src/math/orderFlow.ts`**

```ts
import { Candle, Trade } from "../kalshi/types";
import { mean, sampleStd } from "./stats";

/** Signed taker-flow imbalance in [-1,1]. Abstains (null) with no trades. */
export function flowImbalance(trades: Trade[]): number | null {
  if (trades.length === 0) return null;
  let yes = 0;
  let no = 0;
  for (const t of trades) {
    if (t.takerSide === "yes") yes += t.count;
    else no += t.count;
  }
  const total = yes + no;
  if (total === 0) return null;
  return (yes - no) / total;
}

/** z-score of window volume vs a trailing baseline. Abstains if baseline < 5. */
export function volumeZScore(windowVol: number, baselineVols: number[]): number | null {
  if (baselineVols.length < 5) return null;
  const sd = sampleStd(baselineVols);
  if (sd === 0) return null;
  return (windowVol - mean(baselineVols)) / sd;
}

/** Change in open interest across a window (last - first). Abstains if < 2 candles. */
export function oiDelta(candles: Candle[]): number | null {
  if (candles.length < 2) return null;
  return candles[candles.length - 1]!.openInterest - candles[0]!.openInterest;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/math/orderFlow.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: order-flow features (imbalance, volume z-score, OI delta)"
```

---

### Task 6: VPIN with a volume-bucket floor

**Files:**
- Create: `src/math/vpin.ts`
- Test: `tests/math/vpin.test.ts`

**Interfaces:**
- Consumes: `Trade` from `src/kalshi/types`.
- Produces: `vpin(trades: Trade[], bucketSize: number, numBuckets: number): number | null` —
  mean of `|buyVol − sellVol| / bucketVolume` over the last `numBuckets` filled volume buckets;
  `null` (abstain) when fewer than `numBuckets` complete buckets can be filled (volume floor, #4).

- [ ] **Step 1: Write the failing test**

`tests/math/vpin.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { vpin } from "../../src/math/vpin";
import { Trade } from "../../src/kalshi/types";

const t = (takerSide: "yes" | "no", count: number): Trade => ({
  tradeId: Math.random().toString(36), ticker: "T", yesPriceCents: 50,
  count, takerSide, createdTs: 0,
});

describe("vpin", () => {
  it("abstains (null) when there is not enough volume to fill the buckets", () => {
    expect(vpin([t("yes", 5)], 10, 2)).toBeNull();
  });
  it("is ~1 for fully one-sided flow", () => {
    const trades = [t("yes", 10), t("yes", 10), t("yes", 10), t("yes", 10)];
    expect(vpin(trades, 10, 2)).toBeCloseTo(1, 6);
  });
  it("is ~0 for perfectly balanced buckets", () => {
    const trades = [t("yes", 5), t("no", 5), t("yes", 5), t("no", 5)];
    expect(vpin(trades, 10, 2)).toBeCloseTo(0, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/math/vpin.test.ts`
Expected: FAIL — cannot find `../../src/math/vpin`.

- [ ] **Step 3: Implement `src/math/vpin.ts`**

```ts
import { Trade } from "../kalshi/types";

/**
 * Volume-synchronized probability of informed trading (Easley et al. 2011),
 * simplified for exact taker classification (Kalshi provides takerSide).
 * Fills fixed-size volume buckets in trade order; returns the mean order-flow
 * imbalance over the last `numBuckets` COMPLETE buckets. Abstains (null) if
 * fewer than `numBuckets` complete buckets can be formed (volume floor, #4).
 */
export function vpin(
  trades: Trade[],
  bucketSize: number,
  numBuckets: number,
): number | null {
  const buckets: { buy: number; sell: number }[] = [];
  let buy = 0;
  let sell = 0;
  let filled = 0;

  for (const tr of trades) {
    let remaining = tr.count;
    while (remaining > 0) {
      const room = bucketSize - filled;
      const take = Math.min(room, remaining);
      if (tr.takerSide === "yes") buy += take;
      else sell += take;
      filled += take;
      remaining -= take;
      if (filled === bucketSize) {
        buckets.push({ buy, sell });
        buy = 0;
        sell = 0;
        filled = 0;
      }
    }
  }

  if (buckets.length < numBuckets) return null;
  const last = buckets.slice(-numBuckets);
  const sum = last.reduce((a, b) => a + Math.abs(b.buy - b.sell) / bucketSize, 0);
  return sum / numBuckets;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/math/vpin.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: VPIN with volume-bucket floor (abstain on thin volume)"
```

---

### Task 7: Feature-vector assembly + math-anomaly definition

**Files:**
- Create: `src/detection/features.ts`
- Create: `src/detection/anomaly.ts`
- Test: `tests/detection/features.test.ts`
- Test: `tests/detection/anomaly.test.ts`

**Interfaces:**
- Consumes: `cusum`, `flowImbalance`, `volumeZScore`, `oiDelta`, `vpin`, `toLogOdds`, `Candle`, `Trade`, `Side`.
- Produces:
  - `FeatureVector = { cusumFired: boolean; cusumDir: Side | null; flowImbalance: number | null; volumeZ: number | null; oiDelta: number | null; vpin: number | null }`
  - `buildFeatures(window: Candle[], windowTrades: Trade[], baseline: Candle[]): FeatureVector`
  - `AnomalyParams = { cusumK: number; cusumH: number; imbalanceTau: number; volumeZTau: number; vpinTau: number; bucketSize: number; numBuckets: number }`
  - `detectAnomaly(f: FeatureVector): { isAnomaly: boolean; direction: Side | null }`

- [ ] **Step 1: Write the failing test for `buildFeatures`**

`tests/detection/features.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildFeatures } from "../../src/detection/features";
import { Candle, Trade } from "../../src/kalshi/types";

const candle = (ts: number, close: number, vol: number, oi: number): Candle => ({
  marketTicker: "T", seriesTicker: "S", endPeriodTs: ts, periodMinutes: 1,
  price: { open: close, high: close, low: close, close, mean: close },
  yesBid: { open: close - 1, high: close - 1, low: close - 1, close: close - 1 },
  yesAsk: { open: close + 1, high: close + 1, low: close + 1, close: close + 1 },
  volume: vol, openInterest: oi,
});
const trade = (takerSide: "yes" | "no", count: number): Trade => ({
  tradeId: Math.random().toString(36), ticker: "T", yesPriceCents: 60,
  count, takerSide, createdTs: 0,
});

describe("buildFeatures", () => {
  it("produces a vector; abstained features are null, not noise", () => {
    const baseline = [10, 11, 9, 10, 12].map((v, i) => candle(i, 50, v, 100));
    const window = [candle(5, 50, 90, 100), candle(6, 70, 90, 130), candle(7, 85, 90, 160)];
    const f = buildFeatures(window, [trade("yes", 20), trade("yes", 20)], baseline);
    expect(f.cusumFired).toBe(true);
    expect(f.cusumDir).toBe("yes");
    expect(f.oiDelta).toBe(60);
    expect(f.flowImbalance).toBe(1);
    expect(f.volumeZ).not.toBeNull();
  });

  it("abstains cleanly with no trades and short baseline", () => {
    const f = buildFeatures([candle(0, 50, 1, 100)], [], []);
    expect(f.flowImbalance).toBeNull();
    expect(f.volumeZ).toBeNull();
    expect(f.oiDelta).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/detection/features.test.ts`
Expected: FAIL — cannot find `../../src/detection/features`.

- [ ] **Step 3: Implement `src/detection/features.ts`**

```ts
import { Candle, Trade, Side } from "../kalshi/types";
import { toLogOdds } from "../math/logOdds";
import { cusum } from "../math/cusum";
import { flowImbalance, volumeZScore, oiDelta } from "../math/orderFlow";
import { vpin } from "../math/vpin";

export interface FeatureVector {
  cusumFired: boolean;
  cusumDir: Side | null;
  flowImbalance: number | null;
  volumeZ: number | null;
  oiDelta: number | null;
  vpin: number | null;
}

export interface FeatureParams {
  cusumK: number;
  cusumH: number;
  bucketSize: number;
  numBuckets: number;
}

export const DEFAULT_FEATURE_PARAMS: FeatureParams = {
  cusumK: 0.5,
  cusumH: 4,
  bucketSize: 20,
  numBuckets: 3,
};

export function buildFeatures(
  window: Candle[],
  windowTrades: Trade[],
  baseline: Candle[],
  params: FeatureParams = DEFAULT_FEATURE_PARAMS,
): FeatureVector {
  const lo = window.map((c) => toLogOdds(c.price.close));
  const c = cusum(lo, params.cusumK, params.cusumH);
  const windowVol = window.reduce((a, b) => a + b.volume, 0);
  return {
    cusumFired: c.fired,
    cusumDir: c.direction,
    flowImbalance: flowImbalance(windowTrades),
    volumeZ: volumeZScore(windowVol, baseline.map((b) => b.volume)),
    oiDelta: oiDelta(window),
    vpin: vpin(windowTrades, params.bucketSize, params.numBuckets),
  };
}
```

- [ ] **Step 4: Write the failing test for `detectAnomaly`**

`tests/detection/anomaly.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { detectAnomaly, DEFAULT_ANOMALY_PARAMS } from "../../src/detection/anomaly";
import { FeatureVector } from "../../src/detection/features";

const base: FeatureVector = {
  cusumFired: false, cusumDir: null, flowImbalance: null,
  volumeZ: null, oiDelta: null, vpin: null,
};

describe("detectAnomaly", () => {
  it("no anomaly when nothing fires", () => {
    expect(detectAnomaly(base).isAnomaly).toBe(false);
  });

  it("anomaly when CUSUM fires AND flow/volume confirms, direction from CUSUM", () => {
    const f: FeatureVector = {
      ...base, cusumFired: true, cusumDir: "yes", flowImbalance: 0.8, volumeZ: 4,
    };
    const r = detectAnomaly(f);
    expect(r.isAnomaly).toBe(true);
    expect(r.direction).toBe("yes");
  });

  it("no anomaly when CUSUM fires but flow/volume do NOT confirm", () => {
    const f: FeatureVector = {
      ...base, cusumFired: true, cusumDir: "yes", flowImbalance: 0.05, volumeZ: 0.5,
    };
    expect(detectAnomaly(f).isAnomaly).toBe(false);
  });

  it("respects VPIN when present (abstained VPIN does not block)", () => {
    const withVpin: FeatureVector = {
      ...base, cusumFired: true, cusumDir: "no", flowImbalance: -0.9, volumeZ: 5, vpin: 0.9,
    };
    expect(detectAnomaly(withVpin).isAnomaly).toBe(true);
    const lowVpin: FeatureVector = { ...withVpin, vpin: 0.05 };
    expect(detectAnomaly(lowVpin).isAnomaly).toBe(false);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm run test -- tests/detection/anomaly.test.ts`
Expected: FAIL — cannot find `../../src/detection/anomaly`.

- [ ] **Step 6: Implement `src/detection/anomaly.ts`**

```ts
import { Side } from "../kalshi/types";
import { FeatureVector } from "./features";

export interface AnomalyParams {
  imbalanceTau: number; // min |flowImbalance| to confirm
  volumeZTau: number; // min volume z-score to confirm
  vpinTau: number; // min VPIN when present
}

export const DEFAULT_ANOMALY_PARAMS: AnomalyParams = {
  imbalanceTau: 0.3,
  volumeZTau: 2,
  vpinTau: 0.2,
};

export interface AnomalyResult {
  isAnomaly: boolean;
  direction: Side | null;
}

/**
 * A math-anomaly requires a fired price-jump (CUSUM) CONFIRMED by at least one
 * order-flow signal (imbalance or volume spike). VPIN, when present (not
 * abstained), must also clear its floor; an abstained VPIN neither confirms nor
 * blocks. Direction comes from CUSUM. (§5.4 candidate-feature confirmation.)
 */
export function detectAnomaly(
  f: FeatureVector,
  p: AnomalyParams = DEFAULT_ANOMALY_PARAMS,
): AnomalyResult {
  if (!f.cusumFired || f.cusumDir === null) return { isAnomaly: false, direction: null };

  const imbalanceConfirms =
    f.flowImbalance !== null && Math.abs(f.flowImbalance) >= p.imbalanceTau;
  const volumeConfirms = f.volumeZ !== null && f.volumeZ >= p.volumeZTau;
  if (!imbalanceConfirms && !volumeConfirms) return { isAnomaly: false, direction: null };

  if (f.vpin !== null && f.vpin < p.vpinTau) return { isAnomaly: false, direction: null };

  return { isAnomaly: true, direction: f.cusumDir };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test -- tests/detection/features.test.ts tests/detection/anomaly.test.ts`
Expected: PASS (all).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: feature-vector assembly + math-anomaly definition"
```

---

### Task 8: Realized net-of-fee drift (realistic entry → resolution)

**Files:**
- Create: `src/expectancy/drift.ts`
- Test: `tests/expectancy/drift.test.ts`

**Interfaces:**
- Consumes: `feePerContract` from `src/expectancy/fees`; `Candle`, `Side` from `src/kalshi/types`.
- Produces: `realizedDrift(entry: Candle, direction: Side, outcome: Side): number` — fractional net-of-fee
  return on capital, entering at the spread-crossed price (buy YES at `yesAsk.close`; buy NO at `100 − yesBid.close`), paying the fee, held to resolution (§8, #9).

- [ ] **Step 1: Write the failing test**

`tests/expectancy/drift.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { realizedDrift } from "../../src/expectancy/drift";
import { Candle } from "../../src/kalshi/types";

const c = (yesBid: number, yesAsk: number): Candle => ({
  marketTicker: "T", seriesTicker: "S", endPeriodTs: 0, periodMinutes: 1,
  price: { open: 50, high: 50, low: 50, close: 50, mean: 50 },
  yesBid: { open: yesBid, high: yesBid, low: yesBid, close: yesBid },
  yesAsk: { open: yesAsk, high: yesAsk, low: yesAsk, close: yesAsk },
  volume: 0, openInterest: 0,
});

describe("realizedDrift", () => {
  it("YES win: buy at ask 60c (+fee), settle YES", () => {
    // entryCost = 0.60 + fee(60); payout = 1; return = (1 - cost)/cost
    const d = realizedDrift(c(58, 60), "yes", "yes");
    expect(d).toBeGreaterThan(0.6); // ~ (1-0.62)/0.62
    expect(d).toBeLessThan(0.7);
  });
  it("YES loss: buy at ask 60c, settle NO -> -100%", () => {
    expect(realizedDrift(c(58, 60), "yes", "no")).toBeCloseTo(-1, 6);
  });
  it("NO win: buy NO at (100-58)=42c, settle NO", () => {
    const d = realizedDrift(c(58, 60), "no", "no");
    expect(d).toBeGreaterThan(1.2); // ~ (1-0.43)/0.43
  });
  it("fees make a coin-flip entry negative-EV before any drift", () => {
    // symmetric 50/50 entry both ways, averaged, must be < 0 due to fees+spread
    const win = realizedDrift(c(49, 51), "yes", "yes");
    const loss = realizedDrift(c(49, 51), "yes", "no");
    expect((win + loss) / 2).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/expectancy/drift.test.ts`
Expected: FAIL — cannot find `../../src/expectancy/drift`.

- [ ] **Step 3: Implement `src/expectancy/drift.ts`**

```ts
import { Candle, Side } from "../kalshi/types";
import { feePerContract } from "./fees";

/**
 * Realized net-of-fee fractional return of following `direction` at a realistic
 * spread-crossed entry on `entry`, held to `outcome`. (§8, #9)
 *  - buy YES  -> entry price = yesAsk.close
 *  - buy NO   -> entry price = 100 - yesBid.close
 *  - payout $1 if direction === outcome, else $0
 */
export function realizedDrift(entry: Candle, direction: Side, outcome: Side): number {
  const entryCents =
    direction === "yes" ? entry.yesAsk.close : 100 - entry.yesBid.close;
  const fee = feePerContract(entryCents);
  const entryCost = entryCents / 100 + fee; // dollars per contract
  const payout = direction === outcome ? 1 : 0;
  return (payout - entryCost) / entryCost;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/expectancy/drift.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: realized net-of-fee drift from realistic entry to resolution"
```

---

### Task 9: Stratum keys + observations + stratum aggregation

**Files:**
- Create: `src/detection/stratum.ts`
- Create: `src/expectancy/strata.ts`
- Test: `tests/expectancy/strata.test.ts`

**Interfaces:**
- Consumes: `meanCI95` from `src/math/stats`; `ResolvedMarket` from `src/kalshi/types`.
- Produces:
  - `liquidityBand(liquidityCents: number): "thin" | "mid" | "deep"` (thin < 50_000; mid < 500_000; else deep).
  - `stratumKey(market: ResolvedMarket): string` = `"${category}|${liquidityBand}"`.
  - `Observation = { stratumKey: string; kind: "anomaly" | "control"; drift: number }`
  - `StratumStat = { stratumKey: string; kind: string; n: number; meanDrift: number; lo: number; hi: number }`
  - `aggregate(obs: Observation[]): StratumStat[]`

- [ ] **Step 1: Write the failing test**

`tests/expectancy/strata.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { liquidityBand, stratumKey } from "../../src/detection/stratum";
import { aggregate, Observation } from "../../src/expectancy/strata";
import { ResolvedMarket } from "../../src/kalshi/types";

describe("stratum keys", () => {
  it("bands by liquidity", () => {
    expect(liquidityBand(1000)).toBe("thin");
    expect(liquidityBand(100_000)).toBe("mid");
    expect(liquidityBand(9_000_000)).toBe("deep");
  });
  it("builds a category|band key", () => {
    const m: ResolvedMarket = {
      marketTicker: "K", seriesTicker: "S", category: "Politics",
      outcome: "yes", openTs: 0, closeTs: 1, liquidityCents: 100_000,
    };
    expect(stratumKey(m)).toBe("Politics|mid");
  });
});

describe("aggregate", () => {
  it("groups by (stratumKey, kind) and reports CI + n", () => {
    const obs: Observation[] = [
      { stratumKey: "Politics|mid", kind: "anomaly", drift: 0.1 },
      { stratumKey: "Politics|mid", kind: "anomaly", drift: 0.2 },
      { stratumKey: "Politics|mid", kind: "control", drift: -0.05 },
    ];
    const stats = aggregate(obs);
    const anom = stats.find((s) => s.kind === "anomaly")!;
    expect(anom.n).toBe(2);
    expect(anom.meanDrift).toBeCloseTo(0.15, 6);
    const ctrl = stats.find((s) => s.kind === "control")!;
    expect(ctrl.n).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/expectancy/strata.test.ts`
Expected: FAIL — cannot find the modules.

- [ ] **Step 3: Implement `src/detection/stratum.ts`**

```ts
import { ResolvedMarket } from "../kalshi/types";

export type LiquidityBand = "thin" | "mid" | "deep";

/** Coarse liquidity banding (cents of Kalshi liquidity). Tune in Phase 2. */
export function liquidityBand(liquidityCents: number): LiquidityBand {
  if (liquidityCents < 50_000) return "thin";
  if (liquidityCents < 500_000) return "mid";
  return "deep";
}

export function stratumKey(market: ResolvedMarket): string {
  return `${market.category}|${liquidityBand(market.liquidityCents)}`;
}
```

- [ ] **Step 4: Implement `src/expectancy/strata.ts`**

```ts
import { meanCI95 } from "../math/stats";

export interface Observation {
  stratumKey: string;
  kind: "anomaly" | "control";
  drift: number;
}

export interface StratumStat {
  stratumKey: string;
  kind: "anomaly" | "control";
  n: number;
  meanDrift: number;
  lo: number;
  hi: number;
}

export function aggregate(obs: Observation[]): StratumStat[] {
  const groups = new Map<string, Observation[]>();
  for (const o of obs) {
    const key = `${o.stratumKey}::${o.kind}`;
    const arr = groups.get(key) ?? [];
    arr.push(o);
    groups.set(key, arr);
  }
  const stats: StratumStat[] = [];
  for (const [key, arr] of groups) {
    const [stratumKey, kind] = key.split("::") as [string, "anomaly" | "control"];
    const ci = meanCI95(arr.map((o) => o.drift));
    stats.push({ stratumKey, kind, n: ci.n, meanDrift: ci.mean, lo: ci.lo, hi: ci.hi });
  }
  return stats;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- tests/expectancy/strata.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: stratum keys + observation aggregation with CIs"
```

---

### Task 10: Kalshi historical client + rate governor + JSONL cache

**Files:**
- Create: `src/kalshi/rateGovernor.ts`
- Create: `src/kalshi/cache.ts`
- Create: `src/kalshi/historicalClient.ts`
- Test: `tests/kalshi/rateGovernor.test.ts`
- Test: `tests/kalshi/historicalClient.test.ts`

**Interfaces:**
- Consumes: `Config` from `src/config`; `Candle`, `Trade`, `ResolvedMarket` from `src/kalshi/types`.
- Produces:
  - `RateGovernor` class: `constructor(requestsPerSecond: number)`, `acquire(): Promise<void>`.
  - `readCache<T>(dir: string, key: string): T[] | null`, `writeCache<T>(dir: string, key: string, rows: T[]): void`.
  - `HistoricalClient` class with injectable `fetchFn`:
    - `listResolvedMarkets(startTs: number, endTs: number): Promise<ResolvedMarket[]>`
    - `getCandles(seriesTicker: string, marketTicker: string): Promise<Candle[]>`
    - `getTrades(marketTicker: string): Promise<Trade[]>`

- [ ] **Step 1: Write the failing test for the rate governor**

`tests/kalshi/rateGovernor.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { RateGovernor } from "../../src/kalshi/rateGovernor";

describe("RateGovernor", () => {
  it("spaces out acquisitions to ~1/rps seconds", async () => {
    const gov = new RateGovernor(50); // 50 rps -> 20ms spacing
    const start = Date.now();
    await gov.acquire();
    await gov.acquire();
    await gov.acquire();
    expect(Date.now() - start).toBeGreaterThanOrEqual(35); // >= 2 gaps of ~20ms
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/kalshi/rateGovernor.test.ts`
Expected: FAIL — cannot find `../../src/kalshi/rateGovernor`.

- [ ] **Step 3: Implement `src/kalshi/rateGovernor.ts` and `src/kalshi/cache.ts`**

`src/kalshi/rateGovernor.ts`:
```ts
/** Simple serial token-bucket: guarantees >= 1/rps seconds between acquisitions. */
export class RateGovernor {
  private nextAt = 0;
  private readonly gapMs: number;
  constructor(requestsPerSecond: number) {
    this.gapMs = 1000 / Math.max(1, requestsPerSecond);
  }
  async acquire(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.nextAt - now);
    this.nextAt = Math.max(now, this.nextAt) + this.gapMs;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}
```

`src/kalshi/cache.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function pathFor(dir: string, key: string): string {
  return join(dir, `${key.replace(/[^a-zA-Z0-9_.-]/g, "_")}.jsonl`);
}

export function readCache<T>(dir: string, key: string): T[] | null {
  const p = pathFor(dir, key);
  if (!existsSync(p)) return null;
  const text = readFileSync(p, "utf8").trim();
  if (text === "") return [];
  return text.split("\n").map((line) => JSON.parse(line) as T);
}

export function writeCache<T>(dir: string, key: string, rows: T[]): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(pathFor(dir, key), rows.map((r) => JSON.stringify(r)).join("\n"));
}
```

- [ ] **Step 4: Run the rate-governor test to verify it passes**

Run: `npm run test -- tests/kalshi/rateGovernor.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Write the failing test for the historical client (injected fetch)**

`tests/kalshi/historicalClient.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { HistoricalClient } from "../../src/kalshi/historicalClient";

function fakeFetch(routes: Record<string, unknown>) {
  return async (url: string) => {
    const path = new URL(url).pathname;
    const body = routes[path];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
}

describe("HistoricalClient", () => {
  it("maps candle API shape into our Candle type", async () => {
    const fetchFn = fakeFetch({
      "/series/S/markets/M/candlesticks": {
        candlesticks: [
          {
            end_period_ts: 1000, period_minutes: 1,
            price: { open: 50, high: 55, low: 49, close: 54, mean: 52 },
            yes_bid: { open: 49, high: 54, low: 48, close: 53 },
            yes_ask: { open: 51, high: 56, low: 50, close: 55 },
            volume: 42, open_interest: 300,
          },
        ],
      },
    }) as unknown as typeof fetch;
    const client = new HistoricalClient(
      { kalshiBaseUrl: "https://x/trade-api/v2", cacheDir: ".cache", requestsPerSecond: 1000 },
      fetchFn,
    );
    const candles = await client.getCandles("S", "M");
    expect(candles).toHaveLength(1);
    expect(candles[0].price.close).toBe(54);
    expect(candles[0].yesAsk.close).toBe(55);
    expect(candles[0].volume).toBe(42);
    expect(candles[0].openInterest).toBe(300);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run test -- tests/kalshi/historicalClient.test.ts`
Expected: FAIL — cannot find `../../src/kalshi/historicalClient`.

- [ ] **Step 7: Implement `src/kalshi/historicalClient.ts`**

```ts
import { Config } from "../config";
import { Candle, Trade, ResolvedMarket, Side } from "./types";
import { RateGovernor } from "./rateGovernor";

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export class HistoricalClient {
  private readonly gov: RateGovernor;
  constructor(
    private readonly cfg: Config,
    private readonly fetchFn: FetchLike = fetch as unknown as FetchLike,
  ) {
    this.gov = new RateGovernor(cfg.requestsPerSecond);
  }

  private async getJson(path: string): Promise<any> {
    await this.gov.acquire();
    const res = await this.fetchFn(`${this.cfg.kalshiBaseUrl}${path}`);
    if (!res.ok) throw new Error(`Kalshi ${path} -> HTTP ${res.status}`);
    return res.json();
  }

  async getCandles(seriesTicker: string, marketTicker: string): Promise<Candle[]> {
    const body = await this.getJson(`/series/${seriesTicker}/markets/${marketTicker}/candlesticks`);
    return (body.candlesticks ?? []).map((c: any): Candle => ({
      marketTicker,
      seriesTicker,
      endPeriodTs: c.end_period_ts,
      periodMinutes: c.period_minutes,
      price: c.price,
      yesBid: c.yes_bid,
      yesAsk: c.yes_ask,
      volume: c.volume,
      openInterest: c.open_interest,
    }));
  }

  async getTrades(marketTicker: string): Promise<Trade[]> {
    const body = await this.getJson(`/markets/trades?ticker=${marketTicker}`);
    return (body.trades ?? []).map((t: any): Trade => ({
      tradeId: t.trade_id,
      ticker: marketTicker,
      yesPriceCents: t.yes_price,
      count: t.count,
      takerSide: t.taker_side as Side,
      createdTs: t.created_time_ts ?? Math.floor(new Date(t.created_time).getTime() / 1000),
    }));
  }

  async listResolvedMarkets(startTs: number, endTs: number): Promise<ResolvedMarket[]> {
    const body = await this.getJson(`/markets?status=settled&min_close_ts=${startTs}&max_close_ts=${endTs}`);
    return (body.markets ?? []).map((m: any): ResolvedMarket => ({
      marketTicker: m.ticker,
      seriesTicker: m.event_ticker ?? m.series_ticker,
      category: m.category ?? "Unknown",
      outcome: (m.result === "yes" ? "yes" : "no") as Side,
      openTs: m.open_time_ts ?? 0,
      closeTs: m.close_time_ts ?? 0,
      liquidityCents: m.liquidity ?? 0,
    }));
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run test -- tests/kalshi/`
Expected: PASS (all). **Note:** field names (`result`, `liquidity`, `yes_price`, `event_ticker`) must be verified against the live Kalshi API docs at build time and adjusted if they differ — the mapping layer is the only place this matters.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: Kalshi historical client + rate governor + JSONL cache"
```

---

### Task 11: Replay orchestrator (detect → label → observe)

**Files:**
- Create: `src/replay/windows.ts`
- Create: `src/replay/replay.ts`
- Test: `tests/replay/windows.test.ts`
- Test: `tests/replay/replay.test.ts`

**Interfaces:**
- Consumes: `Candle`, `Trade`, `ResolvedMarket`; `buildFeatures`, `detectAnomaly`; `realizedDrift`; `stratumKey`; `Observation`.
- Produces:
  - `slidingWindows<T extends { endPeriodTs?: number }>(candles: Candle[], size: number, baselineSize: number): { window: Candle[]; baseline: Candle[]; endTs: number }[]`
  - `ReplayInput = { market: ResolvedMarket; candles: Candle[]; trades: Trade[] }`
  - `replayMarket(input: ReplayInput, windowSize?: number, baselineSize?: number): Observation[]` — emits one `anomaly` observation per anomaly window and one `control` observation per non-anomaly window (subsampled 1-in-`controlEvery`), each with `drift = realizedDrift(entryCandle, direction, outcome)`. No lookahead: features use only candles/trades with `endPeriodTs`/`createdTs` ≤ the window end; `outcome` used only for drift.

- [ ] **Step 1: Write the failing test for `slidingWindows`**

`tests/replay/windows.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { slidingWindows } from "../../src/replay/windows";
import { Candle } from "../../src/kalshi/types";

const c = (ts: number): Candle => ({
  marketTicker: "T", seriesTicker: "S", endPeriodTs: ts, periodMinutes: 1,
  price: { open: 50, high: 50, low: 50, close: 50, mean: 50 },
  yesBid: { open: 49, high: 49, low: 49, close: 49 },
  yesAsk: { open: 51, high: 51, low: 51, close: 51 },
  volume: 1, openInterest: 100,
});

describe("slidingWindows", () => {
  it("yields windows with a preceding baseline and never looks ahead", () => {
    const candles = Array.from({ length: 10 }, (_, i) => c(i));
    const out = slidingWindows(candles, 3, 4);
    expect(out.length).toBeGreaterThan(0);
    for (const w of out) {
      expect(w.window).toHaveLength(3);
      const maxWindowTs = Math.max(...w.window.map((x) => x.endPeriodTs));
      for (const b of w.baseline) expect(b.endPeriodTs).toBeLessThan(maxWindowTs);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/replay/windows.test.ts`
Expected: FAIL — cannot find `../../src/replay/windows`.

- [ ] **Step 3: Implement `src/replay/windows.ts`**

```ts
import { Candle } from "../kalshi/types";

export interface WindowSlice {
  window: Candle[];
  baseline: Candle[];
  endTs: number;
}

/**
 * Sliding windows over time-ordered candles. Each window is `size` candles;
 * `baseline` is the up-to-`baselineSize` candles immediately preceding the
 * window. Never includes any candle at or after the window (no lookahead).
 */
export function slidingWindows(
  candles: Candle[],
  size: number,
  baselineSize: number,
): WindowSlice[] {
  const sorted = [...candles].sort((a, b) => a.endPeriodTs - b.endPeriodTs);
  const out: WindowSlice[] = [];
  for (let start = baselineSize; start + size <= sorted.length; start++) {
    const window = sorted.slice(start, start + size);
    const baseline = sorted.slice(Math.max(0, start - baselineSize), start);
    out.push({ window, baseline, endTs: window[window.length - 1]!.endPeriodTs });
  }
  return out;
}
```

- [ ] **Step 4: Write the failing test for `replayMarket`**

`tests/replay/replay.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { replayMarket, ReplayInput } from "../../src/replay/replay";
import { Candle, Trade, ResolvedMarket } from "../../src/kalshi/types";

const candle = (ts: number, close: number, vol: number, oi: number): Candle => ({
  marketTicker: "M", seriesTicker: "S", endPeriodTs: ts, periodMinutes: 1,
  price: { open: close, high: close, low: close, close, mean: close },
  yesBid: { open: close - 1, high: close - 1, low: close - 1, close: close - 1 },
  yesAsk: { open: close + 1, high: close + 1, low: close + 1, close: close + 1 },
  volume: vol, openInterest: oi,
});

describe("replayMarket", () => {
  it("emits an anomaly observation on a clear informed-looking upswing", () => {
    // flat baseline, then a sharp confirmed upswing on heavy YES volume
    const flat = Array.from({ length: 8 }, (_, i) => candle(i, 50, 5, 100));
    const surge = [
      candle(8, 62, 80, 130),
      candle(9, 74, 80, 160),
      candle(10, 86, 80, 190),
    ];
    const candles = [...flat, ...surge];
    const trades: Trade[] = surge.flatMap((c, i) => [
      { tradeId: `t${i}a`, ticker: "M", yesPriceCents: c.price.close, count: 40, takerSide: "yes", createdTs: c.endPeriodTs },
      { tradeId: `t${i}b`, ticker: "M", yesPriceCents: c.price.close, count: 40, takerSide: "yes", createdTs: c.endPeriodTs },
    ]);
    const market: ResolvedMarket = {
      marketTicker: "M", seriesTicker: "S", category: "Politics",
      outcome: "yes", openTs: 0, closeTs: 11, liquidityCents: 100_000,
    };
    const input: ReplayInput = { market, candles, trades };
    const obs = replayMarket(input, 3, 5);
    const anomalies = obs.filter((o) => o.kind === "anomaly");
    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies[0].stratumKey).toBe("Politics|mid");
    // YES surge, settles YES -> positive drift recorded
    expect(anomalies[0].drift).toBeGreaterThan(0);
  });

  it("emits control observations for non-anomaly windows", () => {
    const flat = Array.from({ length: 20 }, (_, i) => candle(i, 50, 5, 100));
    const market: ResolvedMarket = {
      marketTicker: "M", seriesTicker: "S", category: "Sports",
      outcome: "no", openTs: 0, closeTs: 21, liquidityCents: 10_000,
    };
    const obs = replayMarket({ market, candles: flat, trades: [] }, 3, 5);
    expect(obs.every((o) => o.kind === "control")).toBe(true);
    expect(obs.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm run test -- tests/replay/replay.test.ts`
Expected: FAIL — cannot find `../../src/replay/replay`.

- [ ] **Step 6: Implement `src/replay/replay.ts`**

```ts
import { Candle, Trade, ResolvedMarket } from "../kalshi/types";
import { buildFeatures } from "../detection/features";
import { detectAnomaly } from "../detection/anomaly";
import { realizedDrift } from "../expectancy/drift";
import { stratumKey } from "../detection/stratum";
import { Observation } from "../expectancy/strata";
import { slidingWindows } from "./windows";

export interface ReplayInput {
  market: ResolvedMarket;
  candles: Candle[];
  trades: Trade[];
}

const CONTROL_EVERY = 5; // subsample control windows to bound their count

/** Trades whose createdTs falls within [startTs, endTs] (no lookahead). */
function tradesInWindow(trades: Trade[], startTs: number, endTs: number): Trade[] {
  return trades.filter((t) => t.createdTs >= startTs && t.createdTs <= endTs);
}

export function replayMarket(
  input: ReplayInput,
  windowSize = 3,
  baselineSize = 5,
): Observation[] {
  const { market, candles, trades } = input;
  const key = stratumKey(market);
  const slices = slidingWindows(candles, windowSize, baselineSize);
  const obs: Observation[] = [];

  slices.forEach((slice, idx) => {
    const startTs = slice.window[0]!.endPeriodTs;
    const wt = tradesInWindow(trades, startTs, slice.endTs);
    const features = buildFeatures(slice.window, wt, slice.baseline);
    const { isAnomaly, direction } = detectAnomaly(features);
    const entry = slice.window[slice.window.length - 1]!;

    if (isAnomaly && direction) {
      obs.push({
        stratumKey: key,
        kind: "anomaly",
        drift: realizedDrift(entry, direction, market.outcome),
      });
    } else if (idx % CONTROL_EVERY === 0) {
      // control: what a naive YES-follow would have returned here
      obs.push({
        stratumKey: key,
        kind: "control",
        drift: realizedDrift(entry, "yes", market.outcome),
      });
    }
  });

  return obs;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test -- tests/replay/`
Expected: PASS (all).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: replay orchestrator (detect -> label -> observe, no lookahead)"
```

---

### Task 12: Report + kill-gate verdict + CLI

**Files:**
- Create: `src/replay/report.ts`
- Create: `src/replay/cli.ts`
- Test: `tests/replay/report.test.ts`

**Interfaces:**
- Consumes: `StratumStat`, `aggregate`, `Observation`; `Config`, `loadConfig`; `HistoricalClient`; `readCache`, `writeCache`; `replayMarket`.
- Produces:
  - `Verdict = "PASS" | "KILL" | "INCONCLUSIVE"`
  - `verdictFor(stats: StratumStat[], minDrift?: number, minSample?: number): { verdict: Verdict; bettableStrata: string[]; reasons: string[] }`
  - `renderReport(stats: StratumStat[]): string`
  - CLI: `npm run replay -- --history <startISO>..<endISO> [--categories a,b]` — fetches (cache-first), replays, prints the report + verdict.

- [ ] **Step 1: Write the failing test for the verdict logic**

`tests/replay/report.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { verdictFor, renderReport } from "../../src/replay/report";
import { StratumStat } from "../../src/expectancy/strata";

const stat = (kind: "anomaly" | "control", n: number, mean: number, lo: number, hi: number): StratumStat =>
  ({ stratumKey: "Politics|mid", kind, n, meanDrift: mean, lo, hi });

describe("verdictFor", () => {
  it("PASS when an anomaly stratum clears drift+sample AND beats its control", () => {
    const stats = [
      stat("anomaly", 60, 0.12, 0.06, 0.18),
      stat("control", 200, -0.02, -0.04, 0.0),
    ];
    const r = verdictFor(stats, 0.05, 30);
    expect(r.verdict).toBe("PASS");
    expect(r.bettableStrata).toContain("Politics|mid");
  });

  it("KILL when anomaly drift CI lower bound is below the bar despite big sample", () => {
    const stats = [
      stat("anomaly", 200, 0.01, -0.03, 0.05),
      stat("control", 200, 0.0, -0.02, 0.02),
    ];
    expect(verdictFor(stats, 0.05, 30).verdict).toBe("KILL");
  });

  it("INCONCLUSIVE when samples are too small to decide", () => {
    const stats = [stat("anomaly", 5, 0.2, -0.1, 0.5), stat("control", 5, 0.0, -0.1, 0.1)];
    expect(verdictFor(stats, 0.05, 30).verdict).toBe("INCONCLUSIVE");
  });

  it("renderReport produces a non-empty table string", () => {
    expect(renderReport([stat("anomaly", 60, 0.12, 0.06, 0.18)]).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/replay/report.test.ts`
Expected: FAIL — cannot find `../../src/replay/report`.

- [ ] **Step 3: Implement `src/replay/report.ts`**

```ts
import { StratumStat } from "../expectancy/strata";

export type Verdict = "PASS" | "KILL" | "INCONCLUSIVE";

export interface VerdictResult {
  verdict: Verdict;
  bettableStrata: string[];
  reasons: string[];
}

/**
 * PASS: at least one stratum where the anomaly-drift 95% CI lower bound >= minDrift,
 *       n >= minSample, AND anomaly meanDrift exceeds its control meanDrift.
 * INCONCLUSIVE: no stratum has n >= minSample for BOTH anomaly and control.
 * KILL: enough sample everywhere but no stratum clears the bar.
 * (§10 kill-gate honesty.)
 */
export function verdictFor(
  stats: StratumStat[],
  minDrift = 0.05,
  minSample = 30,
): VerdictResult {
  const byKey = new Map<string, { anomaly?: StratumStat; control?: StratumStat }>();
  for (const s of stats) {
    const e = byKey.get(s.stratumKey) ?? {};
    e[s.kind] = s;
    byKey.set(s.stratumKey, e);
  }

  const bettable: string[] = [];
  const reasons: string[] = [];
  let anyDecidable = false;

  for (const [key, { anomaly, control }] of byKey) {
    if (!anomaly || !control) {
      reasons.push(`${key}: missing anomaly or control observations`);
      continue;
    }
    const decidable = anomaly.n >= minSample && control.n >= minSample;
    if (!decidable) {
      reasons.push(`${key}: sample too small (anom n=${anomaly.n}, ctrl n=${control.n})`);
      continue;
    }
    anyDecidable = true;
    const clearsBar = anomaly.lo >= minDrift;
    const beatsControl = anomaly.meanDrift > control.meanDrift;
    if (clearsBar && beatsControl) {
      bettable.push(key);
      reasons.push(`${key}: PASS (anom lo=${anomaly.lo.toFixed(3)} >= ${minDrift}, beats control)`);
    } else {
      reasons.push(
        `${key}: fails (lo=${anomaly.lo.toFixed(3)}, clearsBar=${clearsBar}, beatsControl=${beatsControl})`,
      );
    }
  }

  let verdict: Verdict;
  if (bettable.length > 0) verdict = "PASS";
  else if (!anyDecidable) verdict = "INCONCLUSIVE";
  else verdict = "KILL";

  return { verdict, bettableStrata: bettable, reasons };
}

export function renderReport(stats: StratumStat[]): string {
  const header = "stratum                     kind      n      meanDrift   ci95_lo   ci95_hi";
  const rows = stats
    .sort((a, b) => a.stratumKey.localeCompare(b.stratumKey) || a.kind.localeCompare(b.kind))
    .map(
      (s) =>
        `${s.stratumKey.padEnd(26)} ${s.kind.padEnd(8)} ${String(s.n).padStart(5)}   ${s.meanDrift
          .toFixed(4)
          .padStart(9)}  ${s.lo.toFixed(4).padStart(8)}  ${s.hi.toFixed(4).padStart(8)}`,
    );
  return [header, ...rows].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/replay/report.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Implement `src/replay/cli.ts`**

```ts
import { loadConfig } from "../config";
import { HistoricalClient } from "../kalshi/historicalClient";
import { readCache, writeCache } from "../kalshi/cache";
import { Candle, Trade, ResolvedMarket } from "../kalshi/types";
import { replayMarket } from "./replay";
import { aggregate, Observation } from "../expectancy/strata";
import { renderReport, verdictFor } from "./report";

function parseArgs(argv: string[]): { start: number; end: number; categories: string[] | null } {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const history = get("--history");
  if (!history || !history.includes("..")) {
    throw new Error("usage: npm run replay -- --history <startISO>..<endISO> [--categories a,b]");
  }
  const [startISO, endISO] = history.split("..");
  const cats = get("--categories");
  return {
    start: Math.floor(new Date(startISO!).getTime() / 1000),
    end: Math.floor(new Date(endISO!).getTime() / 1000),
    categories: cats ? cats.split(",") : null,
  };
}

async function main() {
  const cfg = loadConfig();
  const { start, end, categories } = parseArgs(process.argv.slice(2));
  const client = new HistoricalClient(cfg);

  const universeKey = `universe_${start}_${end}`;
  let markets = readCache<ResolvedMarket>(cfg.cacheDir, universeKey);
  if (!markets) {
    markets = await client.listResolvedMarkets(start, end);
    writeCache(cfg.cacheDir, universeKey, markets);
  }
  if (categories) markets = markets.filter((m) => categories.includes(m.category));
  console.error(`Replaying ${markets.length} resolved markets...`);

  const allObs: Observation[] = [];
  for (const m of markets) {
    let candles = readCache<Candle>(cfg.cacheDir, `candles_${m.marketTicker}`);
    if (!candles) {
      candles = await client.getCandles(m.seriesTicker, m.marketTicker);
      writeCache(cfg.cacheDir, `candles_${m.marketTicker}`, candles);
    }
    let trades = readCache<Trade>(cfg.cacheDir, `trades_${m.marketTicker}`);
    if (!trades) {
      trades = await client.getTrades(m.marketTicker);
      writeCache(cfg.cacheDir, `trades_${m.marketTicker}`, trades);
    }
    if (candles.length === 0) continue;
    allObs.push(...replayMarket({ market: m, candles, trades }));
  }

  const stats = aggregate(allObs);
  const result = verdictFor(stats);
  console.log(renderReport(stats));
  console.log("\n=== KILL-GATE VERDICT ===");
  console.log(`Verdict: ${result.verdict}`);
  if (result.bettableStrata.length) console.log(`Bettable strata: ${result.bettableStrata.join(", ")}`);
  for (const r of result.reasons) console.log(`  - ${r}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 6: Full test-suite run**

Run: `npm run test`
Expected: PASS — all suites green.

- [ ] **Step 7: Smoke-run the CLI (needs network + live API field verification)**

Run: `npm run replay -- --history 2026-01-01..2026-03-31 --categories Politics`
Expected: prints a stratum table and a `Verdict:` line. If HTTP/field-mapping errors appear, fix the field names in `historicalClient.ts` against the live Kalshi docs (see Task 10 Step 8 note), then re-run — cached responses make re-runs fast.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: kill-gate report + verdict + replay CLI"
```

---

## Self-Review (completed by plan author)

**1. Spec coverage (against `SYSTEM_DESIGN_PROPOSAL.md` §10 Phase 1 + the constraints):**
- Retrospective replay on real resolved markets → Tasks 10–12. ✅
- Math-anomaly features on log-odds (CUSUM), order-flow, VPIN with floors → Tasks 3–7. ✅
- Abstain-on-floor (null, not noise) → Tasks 5, 6, 7 (asserted in tests). ✅
- No lookahead → Task 11 (`slidingWindows` baseline-precedes-window test; trades filtered by ts; outcome used only in drift). ✅
- Realistic-entry, net-of-fee drift → Tasks 2, 8. ✅
- Selection-bias-free (anomaly + control) → Tasks 11, 12. ✅
- Stratum keys (category × liquidity band) → Task 9. ✅
- Kill-gate honesty (PASS/KILL/INCONCLUSIVE) → Task 12. ✅
- Synthetic = unit-test-only (no synthetic edge claim) → all edge evidence flows from the live CLI over real markets; fixtures appear only inside `tests/`. ✅
- **Deliberately out of Phase 1 (documented in the plan intro, not gaps):** BOCPD, trade-size fingerprint, catalyst-proximity, the investigator/AI layer, the joint fitted model, Postgres/Timescale, betting/live execution. These belong to Phase 2/3 plans.

**2. Placeholder scan:** No "TBD/TODO/handle appropriately". The one build-time caveat (Kalshi JSON field names, Task 10 Step 8 / Task 12 Step 7) is an explicit verification instruction with a concrete fallback, not a placeholder.

**3. Type consistency:** `Side`, `Candle`, `Trade`, `ResolvedMarket` (Task 2) are used unchanged downstream. `FeatureVector` (Task 7) fields match `detectAnomaly` reads. `Observation`/`StratumStat` (Task 9) match `aggregate`→`verdictFor`/`renderReport` (Task 12). `HistoricalClient` method names (Task 10) match CLI calls (Task 12). `realizedDrift(entry, direction, outcome)` signature (Task 8) matches its call in `replayMarket` (Task 11).

---

## Notes for the executor

- **Run order matters for confidence, not correctness:** each task is independently testable, but Tasks 2→9 are pure functions (fast, no I/O), Task 10 adds injectable I/O, Tasks 11–12 wire it together. Implement in order.
- **The verdict thresholds** (`minDrift=0.05`, `minSample=30`, `CONTROL_EVERY=5`, `liquidityBand` cutoffs, anomaly `tau`s) are first-pass values. They are *parameters of the gate, not of the edge* — do not tune them to manufacture a PASS. If the honest answer is KILL or INCONCLUSIVE, that is the deliverable (§10).
- **Next plan after this:** if PASS, Phase 2 (forward paper-logging with the point-in-time investigator, the joint fitted drift model, and Postgres/Timescale). If KILL, the project stops here — as designed.
