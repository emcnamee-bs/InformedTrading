import { describe, it, expect } from "vitest";
import { dollarsToCents, parseFp, isoToUnix, seriesFromEvent } from "../../src/kalshi/parse";

describe("dollarsToCents", () => {
  it("converts a dollar string to integer cents", () => {
    expect(dollarsToCents("0.54")).toBe(54);
  });
  it("returns NaN for null/undefined/empty input", () => {
    expect(dollarsToCents(null)).toBeNaN();
    expect(dollarsToCents(undefined)).toBeNaN();
    expect(dollarsToCents("")).toBeNaN();
  });
});

describe("parseFp", () => {
  it("parses a numeric string", () => {
    expect(parseFp("42")).toBe(42);
  });
  it("returns NaN for null/undefined/bad input", () => {
    expect(parseFp(null)).toBeNaN();
    expect(parseFp(undefined)).toBeNaN();
    expect(parseFp("")).toBeNaN();
  });
});

describe("isoToUnix", () => {
  it("converts an ISO 8601 string to unix seconds", () => {
    expect(isoToUnix("1970-01-01T00:00:00Z")).toBe(0);
    expect(isoToUnix("1970-01-01T00:00:10Z")).toBe(10);
  });
});

describe("seriesFromEvent", () => {
  it("takes the substring before the first dash", () => {
    expect(seriesFromEvent("KXHIGHNY-24DEC31")).toBe("KXHIGHNY");
  });
  it("returns the whole string when there is no dash", () => {
    expect(seriesFromEvent("KXHIGHNY")).toBe("KXHIGHNY");
  });
});
