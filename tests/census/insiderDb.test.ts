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

  it("settles one ticker/side spanning multiple cells: each cell folds independently and both open rows clear", () => {
    const db = new InsiderDb(tmpDb());
    db.openBet(bet({ cellKey: "entertainment|cusum+imbalance|medium|yes|b62|1d|med" }));
    db.openBet(bet({ cellKey: "entertainment|cusum+imbalance|high|yes|b62|1d|med", sensitivity: "high" }));
    db.settle("KXT-26JUL30-A", "yes", true, 3000, "market-result");
    const cells = db.listCells();
    expect(cells).toHaveLength(2);
    for (const c of cells) expect(c.n).toBe(1);
    expect(db.listOpen()).toHaveLength(0);
    db.close();
  });

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
});
