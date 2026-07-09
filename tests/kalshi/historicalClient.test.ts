import { describe, it, expect } from "vitest";
import { HistoricalClient } from "../../src/kalshi/historicalClient";

function fakeFetch(routes: Record<string, unknown>) {
  return async (url: string) => {
    const path = new URL(url).pathname;
    const body = routes[path];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
}

describe("HistoricalClient", () => {
  it("maps candle API shape into our Candle type", async () => {
    const fetchFn = fakeFetch({
      "/trade-api/v2/series/S/markets/M/candlesticks": {
        candlesticks: [
          {
            end_period_ts: 1000, period_minutes: 1,
            price: { open: 50, high: 55, low: 49, close: 54, mean: 52 },
            yes_bid: { open: 49, high: 54, low: 48, close: 53 },
            yes_ask: { open: 51, high: 56, low: 50, close: 55 },
            volume: 42, open_interest: 300,
          },
        ],
      },
    }) as unknown as typeof fetch;
    const client = new HistoricalClient(
      { kalshiBaseUrl: "https://x/trade-api/v2", cacheDir: ".cache", requestsPerSecond: 1000 },
      fetchFn,
    );
    const candles = await client.getCandles("S", "M");
    expect(candles).toHaveLength(1);
    expect(candles[0].price.close).toBe(54);
    expect(candles[0].yesAsk.close).toBe(55);
    expect(candles[0].volume).toBe(42);
    expect(candles[0].openInterest).toBe(300);
  });
});
