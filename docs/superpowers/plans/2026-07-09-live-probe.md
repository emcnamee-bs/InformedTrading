# Live Probe ($10 / 10×$1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. When implementing the investigator (Group B) consult the **claude-api** skill for current model ids + SDK/web-search usage.

**Goal:** From live Kalshi, find ≤10 open markets showing a suspected-informed anomaly with **no public explanation**, and place a **$1** limit bet following the flow on each — **dry-run by default**, real orders only behind `--live --confirm`, hard-capped at ≤$1×10 / ≤$10.

**Architecture:** Reuse the existing detectors/expectancy. New: `listOpenMarkets` (live universe), a live candidate detector + entry-viability filter (Group A), an injectable explain-away investigator backed by the Claude API + web search (Group B), and a Kalshi RSA-PSS request signer + authenticated order client + probe CLI with dry-run/caps (Group C). Everything through the dry-run is buildable/testable now with no credentials; live order-firing needs the operator's key and an explicit `--live --confirm`.

**Tech Stack:** TypeScript (ESM), Node 22-compatible (runs on Node 18), `tsx`, Vitest, Node built-in `crypto` (RSA-PSS), `@anthropic-ai/sdk` for the investigator.

## Global Constraints

- TypeScript strict, ESM, `moduleResolution: "Bundler"` (no `.js` suffix). `npx tsc --noEmit` must stay clean. Run via `tsx`.
- **Prices in cents (integer 1–99)** internally; convert dollars↔cents at the API boundary (reuse `dollarsToCents`).
- **Safety (enforced in code, not advisory):** dry-run is the DEFAULT; real orders require BOTH `--live` AND `--confirm`. Hard caps: **≤ $1 per order, ≤ 10 orders, ≤ $10 total**; also pass Kalshi `buy_max_cost = 100` (cents) per order as a server-side belt. Refuse to place if account balance < intended spend. Every order uses a fresh `client_order_id`.
- **Secrets:** load `KALSHI_API_KEY_ID` + `KALSHI_PRIVATE_KEY_PATH` (PEM file) and `ANTHROPIC_API_KEY` from `.env` (gitignored). NEVER log the private key or commit any key. If credentials are missing, dry-run still works; `--live` errors out clearly.
- **Public-information only.** The investigator reads public web/news; the system never uses MNPI.
- **Kalshi auth:** sign `"{timestampMs}{METHOD}{path}"` where path includes `/trade-api/v2` and EXCLUDES the query string; RSA-PSS, SHA-256 hash, MGF1-SHA-256, salt length = digest length (32); base64. Headers: `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-TIMESTAMP` (ms), `KALSHI-ACCESS-SIGNATURE`.
- **Buy-and-hold probe:** no exits/position-monitoring in scope; the operator watches the portfolio manually.
- Tests are network-free and key-free (inject fake fetch / fake investigator / a locally-generated test RSA key).

---

## Group A — Live scan, candidate detection, entry viability

### Task 1: `listOpenMarkets` (live universe, volume-filtered + capped)

**Files:**
- Modify: `src/kalshi/types.ts` (add `LiveMarket`)
- Modify: `src/kalshi/historicalClient.ts` (add `listOpenMarkets`)
- Test: `tests/kalshi/listOpenMarkets.test.ts`

**Interfaces:**
- Produces:
  - `LiveMarket = { marketTicker: string; seriesTicker: string; category: string; openTs: number; closeTs: number; liquidityVolume: number; yesBidCents: number; yesAskCents: number }`
  - `HistoricalClient.listOpenMarkets(opts?: { minVolume?: number; maxMarkets?: number }): Promise<LiveMarket[]>` — GET `/markets?status=open`, cursor pagination with the same volume-filter + early-stop-at-cap logic as `listResolvedMarkets`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { HistoricalClient } from "../../src/kalshi/historicalClient";

function fakeFetch(pages: any[]) {
  let i = 0;
  const calls = { n: 0 };
  const fn = async (_url: string) => {
    calls.n++;
    const body = pages[Math.min(i, pages.length - 1)];
    i++;
    return { ok: true, status: 200, json: async () => body };
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

const mkt = (ticker: string, vol: string, bid: string, ask: string) => ({
  ticker, event_ticker: "KXFOO-26JUL09", status: "open", result: "",
  open_time: "2026-07-09T00:00:00Z", close_time: "2026-07-20T00:00:00Z",
  volume_fp: vol, yes_bid_dollars: bid, yes_ask_dollars: ask,
});

describe("listOpenMarkets", () => {
  it("filters by volume, derives series, maps book to cents", async () => {
    const { fn } = fakeFetch([{ markets: [mkt("A", "5000", "0.40", "0.42"), mkt("B", "100", "0.10", "0.12")], cursor: "" }]);
    const c = new HistoricalClient({ kalshiBaseUrl: "https://x/trade-api/v2", cacheDir: ".cache", requestsPerSecond: 1000 }, fn);
    const out = await c.listOpenMarkets({ minVolume: 1000 });
    expect(out.map((m) => m.marketTicker)).toEqual(["A"]);
    expect(out[0]!.seriesTicker).toBe("KXFOO");
    expect(out[0]!.yesBidCents).toBe(40);
    expect(out[0]!.yesAskCents).toBe(42);
  });

  it("early-stops at maxMarkets without fetching more pages", async () => {
    const { fn, calls } = fakeFetch([
      { markets: [mkt("A", "5000", "0.40", "0.42")], cursor: "next" },
      { markets: [mkt("B", "5000", "0.50", "0.52")], cursor: "" },
    ]);
    const c = new HistoricalClient({ kalshiBaseUrl: "https://x/trade-api/v2", cacheDir: ".cache", requestsPerSecond: 1000 }, fn);
    const out = await c.listOpenMarkets({ maxMarkets: 1 });
    expect(out).toHaveLength(1);
    expect(calls.n).toBe(1);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npm run test -- tests/kalshi/listOpenMarkets.test.ts` → FAIL (`listOpenMarkets` not a function).

- [ ] **Step 3: Add the type** to `src/kalshi/types.ts`:

```ts
export interface LiveMarket {
  marketTicker: string;
  seriesTicker: string;
  category: string;
  openTs: number;
  closeTs: number;
  liquidityVolume: number;
  yesBidCents: number;
  yesAskCents: number;
}
```

- [ ] **Step 4: Implement `listOpenMarkets`** in `src/kalshi/historicalClient.ts` (mirror `listResolvedMarkets`'s pagination + filter + early-stop; import `dollarsToCents`, `seriesFromEvent`, `isoToUnix`, `parseFp` from `./parse`):

```ts
async listOpenMarkets(opts?: { minVolume?: number; maxMarkets?: number }): Promise<LiveMarket[]> {
  const minVolume = opts?.minVolume ?? 0;
  const out: LiveMarket[] = [];
  let cursor: string | undefined;
  do {
    const q = new URLSearchParams({ status: "open", limit: "1000" });
    if (cursor) q.set("cursor", cursor);
    const body = await this.getJson(`/markets?${q.toString()}`);
    for (const m of body.markets ?? []) {
      const lm: LiveMarket = {
        marketTicker: m.ticker,
        seriesTicker: seriesFromEvent(m.event_ticker ?? ""),
        category: seriesFromEvent(m.event_ticker ?? ""),
        openTs: isoToUnix(m.open_time),
        closeTs: isoToUnix(m.close_time),
        liquidityVolume: parseFp(m.volume_fp),
        yesBidCents: dollarsToCents(m.yes_bid_dollars),
        yesAskCents: dollarsToCents(m.yes_ask_dollars),
      };
      if (lm.liquidityVolume >= minVolume) out.push(lm);
    }
    cursor = body.cursor || undefined;
    if (opts?.maxMarkets && out.length >= opts.maxMarkets) return out.slice(0, opts.maxMarkets);
  } while (cursor);
  return out;
}
```
(If `getJson` is private, this method is in the same class so it can call it. Ensure the imports in this file already include the `./parse` helpers used.)

- [ ] **Step 5: Run tests, verify pass.** Then `npx tsc --noEmit` clean.
- [ ] **Step 6: Commit** — `git add src/kalshi/types.ts src/kalshi/historicalClient.ts tests/kalshi/listOpenMarkets.test.ts && git commit -m "feat(live): listOpenMarkets (volume-filtered, capped)"`

---

### Task 2: Live candidate detection + anomaly score

**Files:**
- Create: `src/live/candidate.ts`
- Test: `tests/live/candidate.test.ts`

**Interfaces:**
- Consumes: `buildFeatures`, `detectAnomaly`, `slidingWindows`, `Candle`, `Trade`, `Side`, `LiveMarket`.
- Produces:
  - `LiveCandidate = { market: LiveMarket; direction: Side; anomalyScore: number; entryCents: number }`
  - `anomalyScore(f: FeatureVector): number` — magnitude proxy: `|cusum sHi or sLo| ... ` — simpler: `(f.cusumFired ? 1 : 0) + Math.abs(f.flowImbalance ?? 0) + Math.min(1, (f.volumeZ ?? 0) / 5) + (f.vpin ?? 0)`. (First-pass ranking scalar; tune later.)
  - `detectCandidate(market: LiveMarket, candles: Candle[], trades: Trade[], windowSize?: number, baselineSize?: number): LiveCandidate | null` — build features on the LATEST window (most recent `windowSize` candles), run `detectAnomaly`; if anomaly, entry = `market.yesAskCents` for a YES bet or `100 - market.yesBidCents` for NO; return candidate with `anomalyScore`. Null if no anomaly.

- [ ] **Step 1: Write the failing test** — feed a flat baseline then a sharp YES surge (as in `tests/replay/replay.test.ts`), assert `detectCandidate` returns a candidate with `direction: "yes"` and `anomalyScore > 0`; a flat market returns `null`.

```ts
import { describe, it, expect } from "vitest";
import { detectCandidate, anomalyScore } from "../../src/live/candidate";
import { LiveMarket, Candle, Trade } from "../../src/kalshi/types";
// build candle/trade fixtures mirroring tests/replay/replay.test.ts's surge case
// market: yesBidCents 60, yesAskCents 62
// assert detectCandidate(...) -> { direction: "yes", entryCents: 62, anomalyScore > 0 }
// assert a flat market -> null
```
(Write the full fixture explicitly, mirroring the surge/flat fixtures already used in `tests/replay/replay.test.ts`.)

- [ ] **Step 2–5:** Run→fail; implement `src/live/candidate.ts`; run→pass; `tsc` clean.

```ts
import { LiveMarket, Candle, Trade, Side } from "../kalshi/types";
import { buildFeatures, FeatureVector } from "../detection/features";
import { detectAnomaly } from "../detection/anomaly";
import { slidingWindows } from "../replay/windows";

export interface LiveCandidate { market: LiveMarket; direction: Side; anomalyScore: number; entryCents: number; }

export function anomalyScore(f: FeatureVector): number {
  return (f.cusumFired ? 1 : 0) + Math.abs(f.flowImbalance ?? 0) +
    Math.min(1, Math.max(0, (f.volumeZ ?? 0) / 5)) + (f.vpin ?? 0);
}

export function detectCandidate(
  market: LiveMarket, candles: Candle[], trades: Trade[], windowSize = 3, baselineSize = 5,
): LiveCandidate | null {
  const slices = slidingWindows(candles, windowSize, baselineSize);
  if (slices.length === 0) return null;
  const slice = slices[slices.length - 1]!; // latest window
  const wt = trades.filter((t) => t.createdTs >= slice.window[0]!.endPeriodTs && t.createdTs <= slice.endTs);
  const f = buildFeatures(slice.window, wt, slice.baseline);
  const { isAnomaly, direction } = detectAnomaly(f);
  if (!isAnomaly || !direction) return null;
  const entryCents = direction === "yes" ? market.yesAskCents : 100 - market.yesBidCents;
  return { market, direction, anomalyScore: anomalyScore(f), entryCents };
}
```

- [ ] **Step 6: Commit** — `feat(live): live candidate detection + anomaly score`

---

### Task 3: Entry-viability filter

**Files:**
- Create: `src/live/viability.ts`
- Test: `tests/live/viability.test.ts`

**Interfaces:**
- Produces:
  - `ViabilityParams = { maxHorizonDays: number; minEntryCents: number; maxEntryCents: number; maxSpreadCents: number }` with defaults `{ maxHorizonDays: 31, minEntryCents: 5, maxEntryCents: 95, maxSpreadCents: 8 }`.
  - `isViable(c: LiveCandidate, nowTs: number, p?: ViabilityParams): { viable: boolean; reason?: string }` — reject if resolution > horizon or ≤ now; entry price outside [min,max]; spread `(yesAskCents - yesBidCents) > maxSpreadCents`. `nowTs` is passed in (do not call Date.now here — keep pure/testable).

- [ ] **Steps (TDD):** test a viable candidate passes; a far-resolution one fails ("horizon"); an extreme-price one fails; a wide-spread one fails. Implement:

```ts
import { LiveCandidate } from "./candidate";

export interface ViabilityParams { maxHorizonDays: number; minEntryCents: number; maxEntryCents: number; maxSpreadCents: number; }
export const DEFAULT_VIABILITY: ViabilityParams = { maxHorizonDays: 31, minEntryCents: 5, maxEntryCents: 95, maxSpreadCents: 8 };

export function isViable(c: LiveCandidate, nowTs: number, p: ViabilityParams = DEFAULT_VIABILITY): { viable: boolean; reason?: string } {
  const horizon = c.market.closeTs - nowTs;
  if (horizon <= 0) return { viable: false, reason: "already closed" };
  if (horizon > p.maxHorizonDays * 86400) return { viable: false, reason: "beyond horizon" };
  if (!Number.isFinite(c.entryCents) || c.entryCents < p.minEntryCents || c.entryCents > p.maxEntryCents)
    return { viable: false, reason: "entry price out of range" };
  const spread = c.market.yesAskCents - c.market.yesBidCents;
  if (!Number.isFinite(spread) || spread > p.maxSpreadCents) return { viable: false, reason: "spread too wide" };
  return { viable: true };
}
```

- [ ] **Commit** — `feat(live): entry-viability filter`

---

## Group B — Explain-away investigator

### Task 4: Investigator interface + fake, and pipeline integration

**Files:**
- Create: `src/live/investigator.ts` (interface + types + a `KeywordInvestigator` no-AI fallback used only in tests/offline)
- Test: `tests/live/investigator.test.ts`

**Interfaces:**
- Produces:
  - `Verdict = "EXPLAINED" | "UNEXPLAINED" | "AMBIGUOUS"`
  - `Investigation = { verdict: Verdict; rationale: string; sources: string[] }`
  - `Investigator = { investigate(c: LiveCandidate): Promise<Investigation> }` (interface)
  - `keepUnexplained(inv: Investigation): boolean` → `inv.verdict === "UNEXPLAINED"` (probe policy: bet only clearly-unexplained).

- [ ] **TDD:** with a fake `Investigator` returning EXPLAINED/UNEXPLAINED, assert `keepUnexplained` filters correctly. Test the pipeline (Task 6) drops EXPLAINED candidates. Implement the interface + `keepUnexplained`; the fake lives in the test.
- [ ] **Commit** — `feat(live): investigator interface + unexplained filter`

### Task 5: Claude-backed investigator (real implementation)

**Files:**
- Create: `src/live/claudeInvestigator.ts`
- Test: `tests/live/claudeInvestigator.test.ts` (inject a fake Anthropic client — NO network, NO real key)

**Interfaces:**
- Consumes: `Investigator`, `LiveCandidate`, `ANTHROPIC_API_KEY` (from config).
- Produces: `ClaudeInvestigator implements Investigator` — constructor takes an injectable message-runner `(args) => Promise<{verdict, rationale, sources}>` (default: a real Anthropic SDK call with the web-search tool enabled). **Before implementing, read the claude-api skill** for the current model id, SDK import, and how to enable server-side web search + force structured output.

- [ ] **Step 1 (read reference):** load the `claude-api` skill; note the current model id and web-search tool usage.
- [ ] **Step 2 (failing test):** construct `ClaudeInvestigator` with an injected fake runner that returns a fixed structured verdict for a given candidate; assert `investigate()` maps it to `Investigation`. (No real API call.)
- [ ] **Step 3 (implement):** the class builds a prompt from the market title/subject + the anomaly window ("Search the public web/news for anything that would explain a sudden move in this market around <window>. If a clear public catalyst exists → EXPLAINED; if a thorough search finds nothing → UNEXPLAINED; if weak/partial → AMBIGUOUS. Return {verdict, rationale, sources}."), runs it via the injected runner (real default = Anthropic SDK + web_search tool + structured/tool output), and returns the `Investigation`. Enforce a per-call token/άcost ceiling; on error return `{verdict:"AMBIGUOUS", rationale:"investigator error", sources:[]}` (fail safe → not bet, since policy bets only UNEXPLAINED).
- [ ] **Step 4:** tests pass with the fake; `tsc` clean.
- [ ] **Commit** — `feat(live): Claude-backed explain-away investigator (web search)`

---

## Group C — Auth, order client, probe CLI (dry-run + caps)

### Task 6: Kalshi RSA-PSS request signer

**Files:**
- Create: `src/kalshi/auth.ts`
- Test: `tests/kalshi/auth.test.ts`

**Interfaces:**
- Produces:
  - `signRequest(method: string, path: string, timestampMs: string, privateKeyPem: string): string` — returns base64 RSA-PSS(SHA256, MGF1-SHA256, salt=digest) signature of `timestampMs + method.toUpperCase() + path`.
  - `authHeaders(keyId: string, method: string, path: string, privateKeyPem: string, nowMs: number): Record<string,string>` → the three `KALSHI-ACCESS-*` headers. (`nowMs` injected for testability.)

- [ ] **Step 1: Failing test** — generate a keypair in-test, sign, and verify with `crypto.verify` using the SAME PSS params; assert verification passes and headers are present. (This proves the signing params are self-consistent without a real Kalshi key.)

```ts
import { describe, it, expect } from "vitest";
import { generateKeyPairSync, verify, constants } from "node:crypto";
import { signRequest, authHeaders } from "../../src/kalshi/auth";

describe("kalshi auth", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

  it("produces a signature that verifies under the same PSS params", () => {
    const ts = "1703123456789";
    const path = "/trade-api/v2/portfolio/balance";
    const sig = signRequest("GET", path, ts, pem);
    const ok = verify("sha256", Buffer.from(ts + "GET" + path),
      { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST },
      Buffer.from(sig, "base64"));
    expect(ok).toBe(true);
  });

  it("authHeaders returns the three KALSHI-ACCESS-* headers", () => {
    const h = authHeaders("KID", "POST", "/trade-api/v2/portfolio/orders", pem, 1703123456789);
    expect(h["KALSHI-ACCESS-KEY"]).toBe("KID");
    expect(h["KALSHI-ACCESS-TIMESTAMP"]).toBe("1703123456789");
    expect(typeof h["KALSHI-ACCESS-SIGNATURE"]).toBe("string");
  });
});
```

- [ ] **Step 2–4: Implement `src/kalshi/auth.ts`**, run tests, `tsc` clean:

```ts
import { sign, constants } from "node:crypto";

export function signRequest(method: string, path: string, timestampMs: string, privateKeyPem: string): string {
  const msg = Buffer.from(timestampMs + method.toUpperCase() + path);
  const signature = sign("sha256", msg, {
    key: privateKeyPem,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return signature.toString("base64");
}

export function authHeaders(keyId: string, method: string, path: string, privateKeyPem: string, nowMs: number): Record<string, string> {
  const ts = String(nowMs);
  return {
    "KALSHI-ACCESS-KEY": keyId,
    "KALSHI-ACCESS-TIMESTAMP": ts,
    "KALSHI-ACCESS-SIGNATURE": signRequest(method, path, ts, privateKeyPem),
  };
}
```

- [ ] **Commit** — `feat(kalshi): RSA-PSS request signer + auth headers`

### Task 7: Authenticated order client (place order + balance)

**Files:**
- Create: `src/kalshi/orderClient.ts`
- Test: `tests/kalshi/orderClient.test.ts`

**Interfaces:**
- Consumes: `authHeaders`, `Config`, `Side`.
- Produces:
  - `OrderRequest = { ticker: string; side: Side; count: number; priceCents: number; clientOrderId: string; buyMaxCostCents: number }`
  - `AuthedClient` with injectable `fetchFn` + `nowFn`:
    - `getBalanceCents(): Promise<number>` — GET `/portfolio/balance` (signed).
    - `placeLimitBuy(o: OrderRequest): Promise<{ orderId: string; status: string }>` — POST `/portfolio/orders` (signed) with body `{ ticker, action: "buy", side, count, type: "limit", [side==="yes"?"yes_price":"no_price"]: priceCents, client_order_id, buy_max_cost: buyMaxCostCents }`.

- [ ] **TDD:** with an injected fake fetch capturing the request, assert: (a) signed headers present, (b) POST body has `action:"buy"`, `type:"limit"`, the correct price field for the side, `client_order_id`, `buy_max_cost`; (c) the path signed excludes query. Use an in-test generated key. Implement accordingly. `tsc` clean.
- [ ] **Note (build-time verify):** confirm exact create-order field names/path against docs.kalshi.com when wiring live (the reference lists `ticker, action, side, count, type, yes_price/no_price, client_order_id, buy_max_cost`). Keep them centralized in this one module.
- [ ] **Commit** — `feat(kalshi): authenticated limit-buy order client + balance`

### Task 8: Probe orchestrator + CLI (dry-run default, caps, `--live --confirm`)

**Files:**
- Create: `src/live/probe.ts` (orchestration, pure-ish, injectable deps)
- Create: `src/live/cli.ts` (entrypoint; add `"probe": "tsx src/live/cli.ts"` to package.json scripts)
- Test: `tests/live/probe.test.ts`

**Interfaces:**
- Produces:
  - `sizeOrder(entryCents: number): { count: number; costCents: number }` — `count = Math.max(1, Math.floor(100 / entryCents))` capped so `count*entryCents <= 100`; `costCents = count*entryCents`. (≈ $1 notional, never over.)
  - `planProbe(deps, opts): Promise<ProbeCandidate[]>` — scan → detect → viability(nowTs) → investigate → keepUnexplained → rank by anomalyScore desc → take ≤ `maxBets` (default 10); each carries the sized order. **Never places orders.**
  - `executeProbe(client, plan, opts): Promise<Result[]>` — ONLY called when live+confirm; enforces caps (≤10 orders, total costCents ≤ 1000, per-order costCents ≤ 100, and `getBalanceCents() >= totalCost`); places each via `placeLimitBuy` with a fresh `client_order_id`.

- [ ] **TDD (all offline):**
  - `sizeOrder(62)` → `{count:1, costCents:62}`; `sizeOrder(20)` → `{count:5, costCents:100}`; `sizeOrder(40)` → `{count:2, costCents:80}`.
  - `planProbe` with fake scanner/detector/investigator: returns only UNEXPLAINED, viable, ranked, ≤ maxBets, and **the fake order client's place method is NEVER called** (assert call count 0 — dry-run planning places nothing).
  - `executeProbe` respects caps: given a plan of 12, refuses (or truncates to 10) and never exceeds $10; if fake balance < total, throws/aborts before placing any.
- [ ] **CLI (`src/live/cli.ts`):** flags `--min-volume` (default 1000), `--max-markets` (default 300), `--period` (default 60), `--max-bets` (default 10), and `--live --confirm` (BOTH required to place). Default = dry-run: print the ranked plan (ticker, direction, entry, count, cost, anomalyScore, investigator verdict + rationale + sources) and a total; place nothing. With `--live --confirm`: load key from `.env` (error clearly if `KALSHI_API_KEY_ID`/PEM missing), build `AuthedClient`, run `executeProbe`, print order ids/status. Echo the run config + a bold DRY-RUN/LIVE banner. `nowTs`/`nowMs` from `Date.now()` only in the CLI layer (keep `probe.ts` pure by passing them in).
- [ ] **Commit** — `feat(live): probe orchestrator + CLI (dry-run default, hard caps, --live --confirm gate)`

---

## Self-Review (author checklist)
- Dry-run default; `--live` AND `--confirm` both required; hard caps (≤$1×10/≤$10 + `buy_max_cost` + balance check) — Tasks 8, 7. ✅
- No credentials needed through dry-run; live path errors clearly without keys — Task 8. ✅
- Investigator gates bets to UNEXPLAINED; fail-safe on error → AMBIGUOUS (not bet) — Tasks 4, 5. ✅
- Auth signing self-verified with an in-test keypair (no real key in tests) — Task 6. ✅
- Reuses existing detectors (`buildFeatures`/`detectAnomaly`/`slidingWindows`) and parse helpers — Tasks 2, 1. ✅
- Placeholder scan: create-order exact fields flagged build-time-verify (Task 7) with a concrete field list; investigator SDK specifics deferred to the claude-api skill (Task 5) — not vague TODOs. ✅

## Notes for the executor
- **The operator (not the agent) fires live orders.** Deliver a working dry-run; live execution is run by the user via `npm run probe -- --live --confirm` (or on the user's explicit contemporaneous instruction). Do not run `--live` autonomously.
- Verdict thresholds / viability params / anomalyScore are first-pass tuning knobs, not the edge — surface them, don't tune them to force bets.
- Sequence: Group A → C (auth/order/CLI can be built and dry-run-tested before B is finished); B (investigator) can be developed in parallel behind its interface. Recommended order: 1,2,3,6,7,4,8,5 (leave the real Claude call last so the dry-run pipeline works with the fake investigator first).
