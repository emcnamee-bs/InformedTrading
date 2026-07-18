import { describe, it, expect } from "vitest";
import { parseEventDate, isEventPast } from "../../src/live/eventDate";

// Fixed "today" = 2026-07-18 12:00 UTC, expressed in unix seconds.
const NOW = Math.floor(Date.UTC(2026, 6, 18, 12, 0, 0) / 1000);

describe("parseEventDate", () => {
  it("parses the YYMONDD code from a mention ticker", () => {
    expect(parseEventDate("KXWORLDNEWSMENTION-26JUL16-IRAN")?.getTime()).toBe(Date.UTC(2026, 6, 16));
  });
  it("returns null when there is no date code", () => {
    expect(parseEventDate("KXNOCODEHERE-FOO")).toBeNull();
  });
  it("returns null for an invalid month token", () => {
    expect(parseEventDate("KXX-26XYZ16-A")).toBeNull();
  });
  it("returns null for an out-of-range day (00)", () => {
    expect(parseEventDate("KXX-26JUL00-A")).toBeNull();
  });
});

describe("isEventPast", () => {
  it("is true when the event date is strictly before today (UTC)", () => {
    expect(isEventPast("KXWORLDNEWSMENTION-26JUL16-IRAN", NOW)).toBe(true);
  });
  it("is false for a same-day event", () => {
    expect(isEventPast("KXAOCMENTION-26JUL18-AFFO", NOW)).toBe(false);
  });
  it("is false for a future event", () => {
    expect(isEventPast("KXMLBMENTION-26JUL20STLLAA-WILD", NOW)).toBe(false);
  });
  it("is false when the ticker has no parseable date (investigator backstops it)", () => {
    expect(isEventPast("KXNOCODEHERE-FOO", NOW)).toBe(false);
  });
});
