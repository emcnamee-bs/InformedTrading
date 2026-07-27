import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Contract guard for the shared Kalshi spine.
 *
 * `src/census/spine.ts` (SpineReader) reads Fast99's poller-written spine.db READONLY. It does NOT
 * import the spine's Node code — this repo is TS/ESM/better-sqlite3 while the spine is
 * CommonJS/node:sqlite, so the shared contract is the SQLite SCHEMA, not the code. That contract is
 * therefore implicit: the reader hard-codes column names that only exist because Fast99's poller
 * created them. If the spine schema drifts (a column renamed or dropped), the census would break at
 * RUNTIME on ai1 with no compile-time warning.
 *
 * This test makes the contract explicit and CI-enforced: it parses the canonical column set from the
 * `kalshi-spine` submodule's schema and asserts every column SpineReader depends on still exists. If
 * you teach SpineReader to read a new column, add it to REQUIRED below — that keeps the guard honest.
 */

// The canonical schema, straight from the submodule (single source of truth). We read the file as
// text and parse its CREATE TABLE statements rather than importing it — the module needs node:sqlite,
// which this repo's Node-18 runtime does not provide.
const SPINE_SRC = readFileSync(new URL("../../spine/node/spine.js", import.meta.url), "utf8");

/** Columns SpineReader reads, per table (see src/census/spine.ts line refs). Extend when the reader does. */
const REQUIRED: Record<string, string[]> = {
  // listMarketData(): SELECT * FROM latest, then reads these fields off each row.
  latest: ["ticker", "series", "close_ms", "open_interest", "yes_bid", "yes_ask"],
  // candles WHERE ticker=? — endPeriodTs/periodMinutes/close_cents/volume.
  candles: ["ticker", "end_period_ts", "period_minutes", "close_cents", "volume"],
  // trades WHERE ticker=? — trade_id/created_ts/yes_price_cents/count/taker_side.
  trades: ["trade_id", "ticker", "created_ts", "yes_price_cents", "count", "taker_side"],
  // listSettlements(): SELECT * FROM settlement WHERE result IN (...) — result/settled_at/source.
  settlement: ["ticker", "result", "settled_at", "source"],
};

/** Parse `CREATE TABLE IF NOT EXISTS <name> ( ... )` bodies into {table: Set<column>}. */
function parseSchema(src: string): Record<string, Set<string>> {
  const tables: Record<string, Set<string>> = {};
  const tableRe = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\);/g;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(src)) !== null) {
    const [, name, body] = m;
    const cols = new Set<string>();
    // A column definition is `<ident> <TYPE> ...`. Splitting on commas also yields fragments from a
    // trailing `PRIMARY KEY (a, b, c)` clause, but those never match `<ident> <TYPE>`, so they drop.
    for (const frag of body.split(",")) {
      const cm = frag.trim().match(/^(\w+)\s+(INTEGER|TEXT|REAL|BLOB|NUMERIC)\b/i);
      if (cm) cols.add(cm[1]);
    }
    tables[name] = cols;
  }
  return tables;
}

describe("kalshi-spine schema contract (SpineReader depends on it)", () => {
  const schema = parseSchema(SPINE_SRC);

  it("parses the generic spine tables the reader uses", () => {
    for (const table of Object.keys(REQUIRED)) {
      expect(schema[table], `spine schema is missing table \`${table}\``).toBeDefined();
    }
  });

  for (const [table, columns] of Object.entries(REQUIRED)) {
    for (const col of columns) {
      it(`spine.${table} still provides \`${col}\``, () => {
        expect(
          schema[table]?.has(col),
          `SpineReader reads ${table}.${col}, but the kalshi-spine submodule no longer defines it. ` +
            `Either the spine schema drifted (fix the submodule) or SpineReader changed (update REQUIRED).`,
        ).toBe(true);
      });
    }
  }
});
