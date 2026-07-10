import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, loadTradingCredentials, loadDotEnv, resolveCategories } from "../../src/live/cli";

describe("parseArgs", () => {
  it("applies defaults when no flags are given", () => {
    const args = parseArgs([]);
    expect(args).toEqual({
      minVolume: 1000,
      maxMarkets: 300,
      period: 60,
      maxBets: 10,
      windowSize: 3,
      baselineSize: 5,
      minReturn: 0.05,
      maxHorizonDays: 31,
      maxSpreadCents: undefined,
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
      "--window", "24",
      "--baseline", "24",
      "--min-return", "8",
      "--horizon-days", "14",
      "--max-spread", "15",
      "--live",
      "--confirm",
    ]);
    expect(args).toEqual({
      minVolume: 2500,
      maxMarkets: 50,
      period: 1440,
      maxBets: 3,
      windowSize: 24,
      baselineSize: 24,
      minReturn: 0.08,
      maxHorizonDays: 14,
      maxSpreadCents: 15,
      live: true,
      confirm: true,
    });
  });

  it("parses --min-return as a percent and stores it as a fraction", () => {
    const args = parseArgs(["--min-return", "8"]);
    expect(args.minReturn).toBe(0.08);
  });

  it("parses --horizon-days correctly", () => {
    const args = parseArgs(["--horizon-days", "14"]);
    expect(args.maxHorizonDays).toBe(14);
  });

  it("defaults --min-return to 5% (0.05) and --horizon-days to 31 when omitted", () => {
    const args = parseArgs([]);
    expect(args.minReturn).toBe(0.05);
    expect(args.maxHorizonDays).toBe(31);
  });

  it("defaults --max-spread to undefined when omitted", () => {
    const args = parseArgs([]);
    expect(args.maxSpreadCents).toBeUndefined();
  });

  it("throws on a negative --min-return value", () => {
    expect(() => parseArgs(["--min-return", "-1"])).toThrow(/min-return/i);
  });

  it("throws on a non-numeric --min-return value", () => {
    expect(() => parseArgs(["--min-return", "abc"])).toThrow(/min-return/i);
  });

  it("accepts a --min-return value of 0", () => {
    const args = parseArgs(["--min-return", "0"]);
    expect(args.minReturn).toBe(0);
  });

  it("throws on a non-positive --horizon-days value", () => {
    expect(() => parseArgs(["--horizon-days", "0"])).toThrow(/horizon-days/i);
  });

  it("throws on a non-integer --horizon-days value", () => {
    expect(() => parseArgs(["--horizon-days", "2.5"])).toThrow(/horizon-days/i);
  });

  it("throws on a non-positive --max-spread value", () => {
    expect(() => parseArgs(["--max-spread", "0"])).toThrow(/max-spread/i);
  });

  it("--window and --baseline default to 3 and 5 when omitted", () => {
    const args = parseArgs([]);
    expect(args.windowSize).toBe(3);
    expect(args.baselineSize).toBe(5);
  });

  it("throws on a non-positive --window value", () => {
    expect(() => parseArgs(["--window", "0"])).toThrow(/window/i);
  });

  it("throws on a non-integer --window value", () => {
    expect(() => parseArgs(["--window", "abc"])).toThrow(/window/i);
  });

  it("throws on a non-positive --baseline value", () => {
    expect(() => parseArgs(["--baseline", "-1"])).toThrow(/baseline/i);
  });

  it("throws on a non-integer --baseline value", () => {
    expect(() => parseArgs(["--baseline", "1.5"])).toThrow(/baseline/i);
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

describe("loadDotEnv", () => {
  const written: string[] = [];

  afterEach(() => {
    for (const key of written.splice(0)) delete process.env[key];
  });

  it("sets a var from a .env file into process.env (regression: must run before loadConfig)", () => {
    const dir = mkdtempSync(join(tmpdir(), "dotenv-test-"));
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "KALSHI_BASE_URL=https://demo.example.test/trade-api/v2\n");
    written.push("KALSHI_BASE_URL");

    expect(process.env.KALSHI_BASE_URL).toBeUndefined();
    loadDotEnv(envPath);
    expect(process.env.KALSHI_BASE_URL).toBe("https://demo.example.test/trade-api/v2");

    rmSync(dir, { recursive: true, force: true });
  });

  it("never overrides a variable already present in process.env", () => {
    const dir = mkdtempSync(join(tmpdir(), "dotenv-test-"));
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "KALSHI_BASE_URL=https://should-not-apply.test\n");
    written.push("KALSHI_BASE_URL");
    process.env.KALSHI_BASE_URL = "https://already-set.test";

    loadDotEnv(envPath);
    expect(process.env.KALSHI_BASE_URL).toBe("https://already-set.test");

    rmSync(dir, { recursive: true, force: true });
  });

  it("is a no-op when the file does not exist", () => {
    expect(() => loadDotEnv(join(tmpdir(), "definitely-not-a-real-dotenv-file"))).not.toThrow();
  });
});

describe("resolveCategories", () => {
  it("returns undefined when neither --categories nor --section is given", () => {
    expect(resolveCategories(undefined, undefined)).toBeUndefined();
    expect(resolveCategories("", "")).toBeUndefined();
  });

  it("passes through raw --categories names", () => {
    expect(resolveCategories("Entertainment,Mentions", undefined)).toEqual(["Entertainment", "Mentions"]);
  });

  it("maps --section culture,mentions to the underlying API categories", () => {
    expect(resolveCategories(undefined, "culture,mentions")).toEqual(["Entertainment", "Social", "Mentions"]);
  });

  it("merges --categories and --section and dedupes", () => {
    expect(resolveCategories("Social", "culture")).toEqual(["Social", "Entertainment"]);
  });

  it("throws on an unknown section", () => {
    expect(() => resolveCategories(undefined, "sportsball")).toThrow(/unknown --section/);
  });
});

describe("parseArgs categories", () => {
  it("defaults categories to undefined (scan all)", () => {
    expect(parseArgs([]).categories).toBeUndefined();
  });

  it("parses --section into categories", () => {
    expect(parseArgs(["--section", "culture,mentions"]).categories).toEqual([
      "Entertainment",
      "Social",
      "Mentions",
    ]);
  });
});
