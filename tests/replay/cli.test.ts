import { describe, it, expect } from "vitest";
import { parseArgs } from "../../src/replay/cli";

describe("parseArgs", () => {
  it("applies defaults for maxMarkets, minVolume, period, categories when omitted", () => {
    const args = parseArgs(["--history", "2024-01-01..2024-01-02"]);
    expect(args.maxMarkets).toBe(200);
    expect(args.minVolume).toBe(1000);
    expect(args.period).toBe(60);
    expect(args.categories).toBeNull();
    expect(args.start).toBe(Math.floor(new Date("2024-01-01").getTime() / 1000));
    expect(args.end).toBe(Math.floor(new Date("2024-01-02").getTime() / 1000));
  });

  it("applies overrides for --max-markets, --min-volume, --period, --categories", () => {
    const args = parseArgs([
      "--history", "2024-01-01..2024-01-02",
      "--max-markets", "50",
      "--min-volume", "2500",
      "--period", "1440",
      "--categories", "KXHIGHNY,KXFED",
    ]);
    expect(args.maxMarkets).toBe(50);
    expect(args.minVolume).toBe(2500);
    expect(args.period).toBe(1440);
    expect(args.categories).toEqual(["KXHIGHNY", "KXFED"]);
  });

  it("throws when --history is missing", () => {
    expect(() => parseArgs([])).toThrow();
  });

  it("throws on an invalid --period value", () => {
    expect(() =>
      parseArgs(["--history", "2024-01-01..2024-01-02", "--period", "5"]),
    ).toThrow(/period/i);
  });

  it("throws on a non-integer --max-markets value", () => {
    expect(() =>
      parseArgs(["--history", "2024-01-01..2024-01-02", "--max-markets", "abc"]),
    ).toThrow(/max-markets/i);
  });
});
