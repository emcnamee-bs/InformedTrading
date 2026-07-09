import { describe, it, expect } from "vitest";
import { parseArgs, loadTradingCredentials } from "../../src/live/cli";

describe("parseArgs", () => {
  it("applies defaults when no flags are given", () => {
    const args = parseArgs([]);
    expect(args).toEqual({
      minVolume: 1000,
      maxMarkets: 300,
      period: 60,
      maxBets: 10,
      live: false,
      confirm: false,
    });
  });

  it("applies overrides for all flags", () => {
    const args = parseArgs([
      "--min-volume", "2500",
      "--max-markets", "50",
      "--period", "1440",
      "--max-bets", "3",
      "--live",
      "--confirm",
    ]);
    expect(args).toEqual({
      minVolume: 2500,
      maxMarkets: 50,
      period: 1440,
      maxBets: 3,
      live: true,
      confirm: true,
    });
  });

  it("defaults to dry-run (live=false) when --live is omitted, even if --confirm is present", () => {
    const args = parseArgs(["--confirm"]);
    expect(args.live).toBe(false);
    expect(args.confirm).toBe(true);
  });

  it("throws on an invalid --period value", () => {
    expect(() => parseArgs(["--period", "5"])).toThrow(/period/i);
  });

  it("throws on a non-integer --max-bets value", () => {
    expect(() => parseArgs(["--max-bets", "abc"])).toThrow(/max-bets/i);
  });

  it("throws on a negative --min-volume value", () => {
    expect(() => parseArgs(["--min-volume", "-5"])).toThrow(/min-volume/i);
  });
});

describe("loadTradingCredentials", () => {
  it("errors clearly when KALSHI_API_KEY_ID is missing/blank", () => {
    expect(() => loadTradingCredentials({ KALSHI_API_KEY_ID: "  ", KALSHI_PRIVATE_KEY_PATH: "./x.pem" })).toThrow(
      /KALSHI_API_KEY_ID/,
    );
  });

  it("errors clearly when KALSHI_PRIVATE_KEY_PATH is missing/blank", () => {
    expect(() => loadTradingCredentials({ KALSHI_API_KEY_ID: "abc-123" })).toThrow(/KALSHI_PRIVATE_KEY_PATH/);
  });

  it("errors clearly when KALSHI_PRIVATE_KEY_PATH points to a nonexistent file", () => {
    expect(() =>
      loadTradingCredentials({ KALSHI_API_KEY_ID: "abc-123", KALSHI_PRIVATE_KEY_PATH: "./definitely-not-here.pem" }),
    ).toThrow(/does not exist/);
  });
});
