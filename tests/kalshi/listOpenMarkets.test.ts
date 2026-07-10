import { describe, it, expect } from "vitest";
import { HistoricalClient } from "../../src/kalshi/historicalClient";

function fakeFetch(pages: any[]) {
  let i = 0;
  const calls = { n: 0, urls: [] as string[] };
  const fn = async (url: string) => {
    calls.n++;
    calls.urls.push(url);
    const body = pages[Math.min(i, pages.length - 1)];
    i++;
    return { ok: true, status: 200, json: async () => body };
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

const mkt = (ticker: string, vol: string, bid: string, ask: string) => ({
  ticker, event_ticker: "KXFOO-26JUL09", status: "open", result: "",
  open_time: "2026-07-09T00:00:00Z", close_time: "2026-07-20T00:00:00Z",
  volume_fp: vol, yes_bid_dollars: bid, yes_ask_dollars: ask,
});

describe("listOpenMarkets", () => {
  it("filters by volume, derives series, maps book to cents", async () => {
    const { fn } = fakeFetch([{ markets: [mkt("A", "5000", "0.40", "0.42"), mkt("B", "100", "0.10", "0.12")], cursor: "" }]);
    const c = new HistoricalClient({ kalshiBaseUrl: "https://x/trade-api/v2", cacheDir: ".cache", requestsPerSecond: 1000 }, fn);
    const out = await c.listOpenMarkets({ minVolume: 1000 });
    expect(out.map((m) => m.marketTicker)).toEqual(["A"]);
    expect(out[0]!.seriesTicker).toBe("KXFOO");
    expect(out[0]!.yesBidCents).toBe(40);
    expect(out[0]!.yesAskCents).toBe(42);
  });

  it("early-stops at maxMarkets without fetching more pages", async () => {
    const { fn, calls } = fakeFetch([
      { markets: [mkt("A", "5000", "0.40", "0.42")], cursor: "next" },
      { markets: [mkt("B", "5000", "0.50", "0.52")], cursor: "" },
    ]);
    const c = new HistoricalClient({ kalshiBaseUrl: "https://x/trade-api/v2", cacheDir: ".cache", requestsPerSecond: 1000 }, fn);
    const out = await c.listOpenMarkets({ maxMarkets: 1 });
    expect(out).toHaveLength(1);
    expect(calls.n).toBe(1);
  });

  it("requests mve_filter=exclude to drop multivariate-parlay markets server-side", async () => {
    const { fn, calls } = fakeFetch([{ markets: [mkt("A", "5000", "0.40", "0.42")], cursor: "" }]);
    const c = new HistoricalClient({ kalshiBaseUrl: "https://x/trade-api/v2", cacheDir: ".cache", requestsPerSecond: 1000 }, fn);
    await c.listOpenMarkets({});
    expect(calls.urls[0]).toContain("mve_filter=exclude");
  });

  it("excludes untradeable markets (bid=0/ask=1.00) even when volume passes, keeps tradeable ones", async () => {
    const { fn } = fakeFetch([
      {
        markets: [
          mkt("UNTRADEABLE", "9000", "0.00", "1.00"),
          mkt("TRADEABLE", "9000", "0.40", "0.42"),
        ],
        cursor: "",
      },
    ]);
    const c = new HistoricalClient({ kalshiBaseUrl: "https://x/trade-api/v2", cacheDir: ".cache", requestsPerSecond: 1000 }, fn);
    const out = await c.listOpenMarkets({ minVolume: 1000 });
    expect(out.map((m) => m.marketTicker)).toEqual(["TRADEABLE"]);
  });

  it("excludes markets whose spread exceeds maxSpreadCents", async () => {
    const { fn } = fakeFetch([
      {
        markets: [
          mkt("WIDE", "9000", "0.10", "0.90"), // 80c spread, exceeds default 20c cap
          mkt("NARROW", "9000", "0.40", "0.42"),
        ],
        cursor: "",
      },
    ]);
    const c = new HistoricalClient({ kalshiBaseUrl: "https://x/trade-api/v2", cacheDir: ".cache", requestsPerSecond: 1000 }, fn);
    const out = await c.listOpenMarkets({ minVolume: 1000 });
    expect(out.map((m) => m.marketTicker)).toEqual(["NARROW"]);
  });
});
