import { CellRow, RawRow } from "./insiderDb";

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
