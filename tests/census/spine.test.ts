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
