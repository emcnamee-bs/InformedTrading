/** Small parse helpers for mapping Kalshi API's string-encoded fields into our numeric domain types. */

/** Kalshi dollar strings (e.g. "0.54") -> integer cents. NaN-safe: bad input -> NaN. */
export function dollarsToCents(s: string | null | undefined): number {
  if (s === null || s === undefined || s === "") return NaN;
  const n = Number(s);
  if (Number.isNaN(n)) return NaN;
  return Math.round(n * 100);
}

/** Kalshi `_fp` fixed-point strings (e.g. volume_fp, count_fp) -> number. NaN-safe. */
export function parseFp(s: string | null | undefined): number {
  if (s === null || s === undefined || s === "") return NaN;
  return Number(s);
}

/** ISO 8601 string -> unix seconds. */
export function isoToUnix(s: string): number {
  return Math.floor(new Date(s).getTime() / 1000);
}

/** Derive the series ticker from an event ticker: substring before the first "-". */
export function seriesFromEvent(eventTicker: string): string {
  const idx = eventTicker.indexOf("-");
  return idx === -1 ? eventTicker : eventTicker.slice(0, idx);
}
