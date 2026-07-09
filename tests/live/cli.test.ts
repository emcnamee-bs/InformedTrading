import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, loadTradingCredentials, loadDotEnv } from "../../src/live/cli";

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
