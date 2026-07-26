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
