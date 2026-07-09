import { Config } from "../config";
import { Candle, Trade, ResolvedMarket, Side } from "./types";
import { RateGovernor } from "./rateGovernor";
import { dollarsToCents, parseFp, isoToUnix, seriesFromEvent, midCents } from "./parse";

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

/** value if finite, else the bid/ask mid (also NaN if that has no book either). */
function fallbackToMid(value: number, bidCents: number, askCents: number): number {
  return Number.isFinite(value) ? value : midCents(bidCents, askCents);
}

export class HistoricalClient {
  private readonly gov: RateGovernor;
  constructor(
    private readonly cfg: Config,
    private readonly fetchFn: FetchLike = fetch as unknown as FetchLike,
  ) {
    this.gov = new RateGovernor(cfg.requestsPerSecond);
  }

  private async getJson(path: string, params: Record<string, string | number | undefined>): Promise<any> {
    await this.gov.acquire();
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    const url = `${this.cfg.kalshiBaseUrl}${path}${qs ? `?${qs}` : ""}`;
    const res = await this.fetchFn(url);
    if (!res.ok) throw new Error(`Kalshi ${path} -> HTTP ${res.status}`);
    return res.json();
  }

  /** period_interval (minutes) defaults to 60 (hourly) — tractable for a retrospective sweep; tunable gate param. */
  async getCandles(
    seriesTicker: string,
    marketTicker: string,
    startTs: number,
    endTs: number,
    periodInterval: 1 | 60 | 1440 = 60,
  ): Promise<Candle[]> {
    const body = await this.getJson(`/series/${seriesTicker}/markets/${marketTicker}/candlesticks`, {
      start_ts: startTs,
      end_ts: endTs,
      period_interval: periodInterval,
    });
    return (body.candlesticks ?? []).map((c: any): Candle => {
      const yesBid = {
        open: dollarsToCents(c.yes_bid.open_dollars),
        high: dollarsToCents(c.yes_bid.high_dollars),
        low: dollarsToCents(c.yes_bid.low_dollars),
        close: dollarsToCents(c.yes_bid.close_dollars),
      };
      const yesAsk = {
        open: dollarsToCents(c.yes_ask.open_dollars),
        high: dollarsToCents(c.yes_ask.high_dollars),
        low: dollarsToCents(c.yes_ask.low_dollars),
        close: dollarsToCents(c.yes_ask.close_dollars),
      };
      // Quiet periods (no trades) carry a null last-trade price from Kalshi; fall back to the
      // order-book mid of the same field so detectors don't see a NaN-riddled price series.
      const open = fallbackToMid(dollarsToCents(c.price.open_dollars), yesBid.open, yesAsk.open);
      const high = fallbackToMid(dollarsToCents(c.price.high_dollars), yesBid.high, yesAsk.high);
      const low = fallbackToMid(dollarsToCents(c.price.low_dollars), yesBid.low, yesAsk.low);
      const close = fallbackToMid(dollarsToCents(c.price.close_dollars), yesBid.close, yesAsk.close);
      return {
        marketTicker,
        seriesTicker,
        endPeriodTs: c.end_period_ts,
        periodMinutes: periodInterval,
        price: {
          open,
          high,
          low,
          close,
          mean: c.price.mean_dollars == null ? null : dollarsToCents(c.price.mean_dollars),
        },
        yesBid,
        yesAsk,
        volume: parseFp(c.volume_fp),
        openInterest: parseFp(c.open_interest_fp),
      };
    });
  }

  async getTrades(marketTicker: string, minTs?: number, maxTs?: number): Promise<Trade[]> {
    const trades: Trade[] = [];
    let cursor: string | undefined;
    do {
      const body = await this.getJson("/markets/trades", {
        ticker: marketTicker,
        min_ts: minTs,
        max_ts: maxTs,
        limit: 1000,
        cursor,
      });
      for (const t of body.trades ?? []) {
        trades.push({
          tradeId: t.trade_id,
          ticker: marketTicker,
          yesPriceCents: dollarsToCents(t.yes_price_dollars),
          count: parseFp(t.count_fp),
          takerSide: t.taker_outcome_side as Side,
          createdTs: isoToUnix(t.created_time),
        });
      }
      cursor = body.cursor || undefined;
    } while (cursor);
    return trades;
  }

  async listResolvedMarkets(startTs: number, endTs: number): Promise<ResolvedMarket[]> {
    const markets: ResolvedMarket[] = [];
    let cursor: string | undefined;
    do {
      const body = await this.getJson("/markets", {
        status: "settled",
        min_close_ts: startTs,
        max_close_ts: endTs,
        limit: 1000,
        cursor,
      });
      for (const m of body.markets ?? []) {
        const seriesTicker = seriesFromEvent(m.event_ticker);
        markets.push({
          marketTicker: m.ticker,
          seriesTicker,
          category: seriesTicker,
          outcome: (m.result === "yes" ? "yes" : "no") as Side,
          openTs: isoToUnix(m.open_time),
          closeTs: isoToUnix(m.close_time),
          liquidityVolume: parseFp(m.volume_fp),
        });
      }
      cursor = body.cursor || undefined;
    } while (cursor);
    return markets;
  }
}
