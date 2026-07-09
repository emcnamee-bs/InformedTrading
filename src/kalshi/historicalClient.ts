import { Config } from "../config";
import { Candle, Trade, ResolvedMarket, Side } from "./types";
import { RateGovernor } from "./rateGovernor";

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export class HistoricalClient {
  private readonly gov: RateGovernor;
  constructor(
    private readonly cfg: Config,
    private readonly fetchFn: FetchLike = fetch as unknown as FetchLike,
  ) {
    this.gov = new RateGovernor(cfg.requestsPerSecond);
  }

  private async getJson(path: string): Promise<any> {
    await this.gov.acquire();
    const res = await this.fetchFn(`${this.cfg.kalshiBaseUrl}${path}`);
    if (!res.ok) throw new Error(`Kalshi ${path} -> HTTP ${res.status}`);
    return res.json();
  }

  async getCandles(seriesTicker: string, marketTicker: string): Promise<Candle[]> {
    const body = await this.getJson(`/series/${seriesTicker}/markets/${marketTicker}/candlesticks`);
    return (body.candlesticks ?? []).map((c: any): Candle => ({
      marketTicker,
      seriesTicker,
      endPeriodTs: c.end_period_ts,
      periodMinutes: c.period_minutes,
      price: c.price,
      yesBid: c.yes_bid,
      yesAsk: c.yes_ask,
      volume: c.volume,
      openInterest: c.open_interest,
    }));
  }

  async getTrades(marketTicker: string): Promise<Trade[]> {
    const body = await this.getJson(`/markets/trades?ticker=${marketTicker}`);
    return (body.trades ?? []).map((t: any): Trade => ({
      tradeId: t.trade_id,
      ticker: marketTicker,
      yesPriceCents: t.yes_price,
      count: t.count,
      takerSide: t.taker_side as Side,
      createdTs: t.created_time_ts ?? Math.floor(new Date(t.created_time).getTime() / 1000),
    }));
  }

  async listResolvedMarkets(startTs: number, endTs: number): Promise<ResolvedMarket[]> {
    const body = await this.getJson(`/markets?status=settled&min_close_ts=${startTs}&max_close_ts=${endTs}`);
    return (body.markets ?? []).map((m: any): ResolvedMarket => ({
      marketTicker: m.ticker,
      seriesTicker: m.event_ticker ?? m.series_ticker,
      category: m.category ?? "Unknown",
      outcome: (m.result === "yes" ? "yes" : "no") as Side,
      openTs: m.open_time_ts ?? 0,
      closeTs: m.close_time_ts ?? 0,
      liquidityCents: m.liquidity ?? 0,
    }));
  }
}
