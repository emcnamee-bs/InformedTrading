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
