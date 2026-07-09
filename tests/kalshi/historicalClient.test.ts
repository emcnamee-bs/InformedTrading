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
  it("maps candle API shape into our Candle type (dollars -> cents, _fp -> number)", async () => {
    const fetchFn = fakeFetch({
      "/trade-api/v2/series/S/markets/M/candlesticks": {
        ticker: "M",
        candlesticks: [
          {
            end_period_ts: 1000,
            price: { open_dollars: "0.50", high_dollars: "0.55", low_dollars: "0.49", close_dollars: "0.54", mean_dollars: "0.52" },
            yes_bid: { open_dollars: "0.49", high_dollars: "0.54", low_dollars: "0.48", close_dollars: "0.53" },
            yes_ask: { open_dollars: "0.51", high_dollars: "0.56", low_dollars: "0.50", close_dollars: "0.55" },
            volume_fp: "42",
            open_interest_fp: "300",
          },
        ],
      },
    }) as unknown as typeof fetch;
    const client = new HistoricalClient(
      { kalshiBaseUrl: "https://x/trade-api/v2", cacheDir: ".cache", requestsPerSecond: 1000 },
      fetchFn,
    );
    const candles = await client.getCandles("S", "M", 0, 2000);
    expect(candles).toHaveLength(1);
    expect(candles[0]!.endPeriodTs).toBe(1000);
    expect(candles[0]!.periodMinutes).toBe(60);
    expect(candles[0]!.price.close).toBe(54);
    expect(candles[0]!.price.mean).toBe(52);
    expect(candles[0]!.yesBid.close).toBe(53);
    expect(candles[0]!.yesAsk.close).toBe(55);
    expect(candles[0]!.volume).toBe(42);
    expect(candles[0]!.openInterest).toBe(300);
  });

  it("treats a null mean_dollars as null (not NaN)", async () => {
    const fetchFn = fakeFetch({
      "/trade-api/v2/series/S/markets/M/candlesticks": {
        ticker: "M",
        candlesticks: [
          {
            end_period_ts: 1000,
            price: { open_dollars: "0.50", high_dollars: "0.55", low_dollars: "0.49", close_dollars: "0.54", mean_dollars: null },
            yes_bid: { open_dollars: "0.49", high_dollars: "0.54", low_dollars: "0.48", close_dollars: "0.53" },
            yes_ask: { open_dollars: "0.51", high_dollars: "0.56", low_dollars: "0.50", close_dollars: "0.55" },
            volume_fp: "42",
            open_interest_fp: "300",
          },
        ],
      },
    }) as unknown as typeof fetch;
    const client = new HistoricalClient(
      { kalshiBaseUrl: "https://x/trade-api/v2", cacheDir: ".cache", requestsPerSecond: 1000 },
      fetchFn,
    );
    const candles = await client.getCandles("S", "M", 0, 2000);
    expect(candles[0]!.price.mean).toBeNull();
  });

  it("sends the required start_ts, end_ts, and period_interval query params", async () => {
    let capturedUrl = "";
    const fetchFn = (async (url: string) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ticker: "M", candlesticks: [] }),
      };
    }) as unknown as typeof fetch;
    const client = new HistoricalClient(
      { kalshiBaseUrl: "https://x/trade-api/v2", cacheDir: ".cache", requestsPerSecond: 1000 },
      fetchFn,
    );
    await client.getCandles("S", "M", 100, 200, 1440);
    const q = new URL(capturedUrl).searchParams;
    expect(q.get("start_ts")).toBe("100");
    expect(q.get("end_ts")).toBe("200");
    expect(q.get("period_interval")).toBe("1440");
  });

  it("defaults period_interval to 60 (hourly)", async () => {
    let capturedUrl = "";
    const fetchFn = (async (url: string) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => ({ ticker: "M", candlesticks: [] }) };
    }) as unknown as typeof fetch;
    const client = new HistoricalClient(
      { kalshiBaseUrl: "https://x/trade-api/v2", cacheDir: ".cache", requestsPerSecond: 1000 },
      fetchFn,
    );
    await client.getCandles("S", "M", 100, 200);
    expect(new URL(capturedUrl).searchParams.get("period_interval")).toBe("60");
  });

  it("maps trades: dollars -> cents, count_fp -> number, taker_outcome_side -> takerSide", async () => {
    const fetchFn = fakeFetch({
      "/trade-api/v2/markets/trades": {
        trades: [
          {
            trade_id: "t1",
            ticker: "M",
            count_fp: "40",
            yes_price_dollars: "0.62",
            no_price_dollars: "0.38",
            taker_outcome_side: "yes",
            created_time: "1970-01-01T00:00:10Z",
          },
        ],
        cursor: "",
      },
    }) as unknown as typeof fetch;
    const client = new HistoricalClient(
      { kalshiBaseUrl: "https://x/trade-api/v2", cacheDir: ".cache", requestsPerSecond: 1000 },
      fetchFn,
    );
    const trades = await client.getTrades("M");
    expect(trades).toHaveLength(1);
    expect(trades[0]!.tradeId).toBe("t1");
    expect(trades[0]!.ticker).toBe("M");
    expect(trades[0]!.yesPriceCents).toBe(62);
    expect(trades[0]!.count).toBe(40);
    expect(trades[0]!.takerSide).toBe("yes");
    expect(trades[0]!.createdTs).toBe(10);
  });

  it("paginates getTrades via cursor until empty", async () => {
    let calls = 0;
    const fetchFn = (async (url: string) => {
      calls += 1;
      const cursor = new URL(url).searchParams.get("cursor");
      if (!cursor) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            trades: [
              { trade_id: "t1", ticker: "M", count_fp: "1", yes_price_dollars: "0.50", no_price_dollars: "0.50", taker_outcome_side: "yes", created_time: "1970-01-01T00:00:00Z" },
            ],
            cursor: "page2",
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          trades: [
            { trade_id: "t2", ticker: "M", count_fp: "2", yes_price_dollars: "0.51", no_price_dollars: "0.49", taker_outcome_side: "no", created_time: "1970-01-01T00:00:01Z" },
          ],
          cursor: "",
        }),
      };
    }) as unknown as typeof fetch;
    const client = new HistoricalClient(
      { kalshiBaseUrl: "https://x/trade-api/v2", cacheDir: ".cache", requestsPerSecond: 1000 },
      fetchFn,
    );
    const trades = await client.getTrades("M");
    expect(calls).toBe(2);
    expect(trades.map((t) => t.tradeId)).toEqual(["t1", "t2"]);
  });

  it("maps resolved markets: event_ticker -> derived series/category, ISO times -> unix, volume_fp -> liquidityVolume", async () => {
    const fetchFn = fakeFetch({
      "/trade-api/v2/markets": {
        markets: [
          {
            ticker: "KXHIGHNY-24DEC31-B50",
            event_ticker: "KXHIGHNY-24DEC31",
            status: "settled",
            result: "yes",
            open_time: "1970-01-01T00:00:00Z",
            close_time: "1970-01-01T00:00:20Z",
            volume_fp: "123",
          },
        ],
        cursor: "",
      },
    }) as unknown as typeof fetch;
    const client = new HistoricalClient(
      { kalshiBaseUrl: "https://x/trade-api/v2", cacheDir: ".cache", requestsPerSecond: 1000 },
      fetchFn,
    );
    const markets = await client.listResolvedMarkets(0, 100);
    expect(markets).toHaveLength(1);
    const m = markets[0]!;
    expect(m.marketTicker).toBe("KXHIGHNY-24DEC31-B50");
    expect(m.seriesTicker).toBe("KXHIGHNY");
    expect(m.category).toBe("KXHIGHNY");
    expect(m.outcome).toBe("yes");
    expect(m.openTs).toBe(0);
    expect(m.closeTs).toBe(20);
    expect(m.liquidityVolume).toBe(123);
  });

  it("paginates listResolvedMarkets via cursor until empty", async () => {
    let calls = 0;
    const fetchFn = (async (url: string) => {
      calls += 1;
      const cursor = new URL(url).searchParams.get("cursor");
      if (!cursor) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            markets: [
              { ticker: "A", event_ticker: "EV-1", status: "settled", result: "yes", open_time: "1970-01-01T00:00:00Z", close_time: "1970-01-01T00:00:01Z", volume_fp: "1" },
            ],
            cursor: "page2",
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          markets: [
            { ticker: "B", event_ticker: "EV-2", status: "settled", result: "no", open_time: "1970-01-01T00:00:00Z", close_time: "1970-01-01T00:00:01Z", volume_fp: "2" },
          ],
          cursor: "",
        }),
      };
    }) as unknown as typeof fetch;
    const client = new HistoricalClient(
      { kalshiBaseUrl: "https://x/trade-api/v2", cacheDir: ".cache", requestsPerSecond: 1000 },
      fetchFn,
    );
    const markets = await client.listResolvedMarkets(0, 100);
    expect(calls).toBe(2);
    expect(markets.map((m) => m.marketTicker)).toEqual(["A", "B"]);
  });
});
