const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/**
 * Parse the YYMONDD event-date code embedded in a Kalshi mention/event ticker
 * (e.g. "KXWORLDNEWSMENTION-26JUL16-IRAN" -> 2026-07-16 UTC). Kalshi's structured date fields
 * (close_time/expiration/occurrence) reflect the settlement window, NOT the event, so the ticker
 * code is the only reliable event-date signal. Returns null when no parseable code is present.
 * Assumes 20YY.
 */
export function parseEventDate(ticker: string): Date | null {
  const m = /-(\d{2})([A-Z]{3})(\d{2})/.exec(ticker);
  if (!m) return null;
  const month = MONTHS[m[2]!];
  if (month === undefined) return null;
  return new Date(Date.UTC(2000 + Number(m[1]), month, Number(m[3])));
}

/**
 * True only when the ticker's event date is STRICTLY before today's UTC date. Same-day (the event
 * may still be later today), future, or unparseable tickers return false (keep; the investigator
 * `eventStatus` field is the backstop for unparseable past events). `nowTs` is unix seconds.
 */
export function isEventPast(ticker: string, nowTs: number): boolean {
  const eventDate = parseEventDate(ticker);
  if (!eventDate) return false;
  const now = new Date(nowTs * 1000);
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return eventDate.getTime() < todayUTC;
}
