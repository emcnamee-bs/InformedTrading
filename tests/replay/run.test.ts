import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReplay, ReplayClient } from "../../src/replay/run";
import { Candle, Trade, ResolvedMarket } from "../../src/kalshi/types";

const candle = (ts: number, close: number, vol: number, oi: number): Candle => ({
  marketTicker: "M", seriesTicker: "S", endPeriodTs: ts, periodMinutes: 1,
  price: { open: close, high: close, low: close, close, mean: close },
  yesBid: { open: close - 1, high: close - 1, low: close - 1, close: close - 1 },
  yesAsk: { open: close + 1, high: close + 1, low: close + 1, close: close + 1 },
  volume: vol, openInterest: oi,
});

const flatCandles = Array.from({ length: 20 }, (_, i) => candle(i, 50, 5, 100));

const market = (ticker: string): ResolvedMarket => ({
  marketTicker: ticker, seriesTicker: "S", category: "Sports",
  outcome: "no", openTs: 0, closeTs: 21, liquidityVolume: 10_000,
});

describe("runReplay", () => {
  let cacheDir: string;
  afterEach(() => {
    if (cacheDir) rmSync(cacheDir, { recursive: true, force: true });
  });

  it("skips a market whose fetch throws and still returns good markets' observations", async () => {
    cacheDir = mkdtempSync(join(tmpdir(), "run-replay-test-"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const client: ReplayClient = {
      getCandles: vi.fn(async (_series: string, ticker: string) => {
        if (ticker === "BAD") throw new Error("boom: candles unavailable");
        return flatCandles;
      }),
      getTrades: vi.fn(async () => [] as Trade[]),
    };

    const markets = [market("GOOD1"), market("BAD"), market("GOOD2")];
    const obs = await runReplay(client, markets, { cacheDir });

    expect(obs.length).toBeGreaterThan(0);
    // both good markets contributed observations; only 2 distinct tickers succeeded
    expect(client.getCandles).toHaveBeenCalledTimes(3);

    const errorCalls = errSpy.mock.calls.map((c) => String(c[0]));
    expect(errorCalls.some((m) => m.includes("skip BAD") && m.includes("boom: candles unavailable"))).toBe(true);
    expect(errorCalls.some((m) => /2 processed, 1 skipped/.test(m))).toBe(true);

    errSpy.mockRestore();
  });

  it("does not throw when every market fails, and returns an empty observation list", async () => {
    cacheDir = mkdtempSync(join(tmpdir(), "run-replay-test-"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const client: ReplayClient = {
      getCandles: vi.fn(async () => {
        throw new Error("network down");
      }),
      getTrades: vi.fn(async () => [] as Trade[]),
    };

    const obs = await runReplay(client, [market("BAD1"), market("BAD2")], { cacheDir });
    expect(obs).toEqual([]);

    errSpy.mockRestore();
  });
});
