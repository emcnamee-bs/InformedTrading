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
