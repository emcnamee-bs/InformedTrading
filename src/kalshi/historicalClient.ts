import { Config } from "../config";
import { Candle, Trade, ResolvedMarket, LiveMarket, Side } from "./types";
import { RateGovernor } from "./rateGovernor";
import { dollarsToCents, parseFp, isoToUnix, seriesFromEvent, midCents } from "./parse";

type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<any>;
  headers?: { get(name: string): string | null };
}>;

/** Injectable so tests can skip real waiting; defaults to a real setTimeout-based sleep. */
type SleepFn = (ms: number) => Promise<void>;

const realSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** value if finite, else the bid/ask mid (also NaN if that has no book either). */
function fallbackToMid(value: number, bidCents: number, askCents: number): number {
  return Number.isFinite(value) ? value : midCents(bidCents, askCents);
}

export class HistoricalClient {
  private readonly gov: RateGovernor;
  // Small, bounded retry budget for transient failures (rate limiting / server hiccups /
  // network blips). Not a tuning knob for correctness -- just keeps a flaky upstream from
  // aborting an entire sweep on a single 429.
  private readonly maxRetries = 4;

  constructor(
    private readonly cfg: Config,
    private readonly fetchFn: FetchLike = fetch as unknown as FetchLike,
    private readonly sleepFn: SleepFn = realSleep,
    private readonly baseDelayMs = 500,
  ) {
    this.gov = new RateGovernor(cfg.requestsPerSecond);
  }

  /** Exponential backoff with jitter: baseDelayMs * 2^attempt, plus up to baseDelayMs of jitter. */
  private backoffDelayMs(attempt: number): number {
    return this.baseDelayMs * 2 ** attempt + Math.random() * this.baseDelayMs;
  }

  /** Honors a Retry-After header (seconds) if the response carries one. */
  private retryAfterMs(res: { headers?: { get(name: string): string | null } }): number | undefined {
    const raw = res.headers?.get?.("Retry-After");
    if (!raw) return undefined;
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
  }

  private async getJson(path: string, params: Record<string, string | number | undefined>): Promise<any> {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    const url = `${this.cfg.kalshiBaseUrl}${path}${qs ? `?${qs}` : ""}`;

    for (let attempt = 0; ; attempt++) {
      await this.gov.acquire();
      const isLastAttempt = attempt >= this.maxRetries;
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await this.fetchFn(url);
      } catch (err) {
        if (isLastAttempt) throw err;
        await this.sleepFn(this.backoffDelayMs(attempt));
        continue;
      }
      if (res.ok) return res.json();

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || isLastAttempt) throw new Error(`Kalshi ${path} -> HTTP ${res.status}`);

      await this.sleepFn(this.retryAfterMs(res) ?? this.backoffDelayMs(attempt));
    }
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

  /**
   * `minVolume`/`maxMarkets` make a real sweep tractable: they filter the settled-market
   * universe by traded volume and stop paginating as soon as the cap is reached (no further
   * pages fetched). Omitting both preserves the original full-crawl, no-filter behavior.
   */
  async listResolvedMarkets(
    startTs: number,
    endTs: number,
    opts?: { minVolume?: number; maxMarkets?: number },
  ): Promise<ResolvedMarket[]> {
    const minVolume = opts?.minVolume ?? 0;
    const maxMarkets = opts?.maxMarkets;
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
        const resolved: ResolvedMarket = {
          marketTicker: m.ticker,
          seriesTicker,
          category: seriesTicker,
          outcome: (m.result === "yes" ? "yes" : "no") as Side,
          openTs: isoToUnix(m.open_time),
          closeTs: isoToUnix(m.close_time),
          liquidityVolume: parseFp(m.volume_fp),
        };
        if (resolved.liquidityVolume >= minVolume) markets.push(resolved);
      }
      cursor = body.cursor || undefined;
      if (maxMarkets !== undefined && markets.length >= maxMarkets) break;
    } while (cursor);
    return maxMarkets !== undefined ? markets.slice(0, maxMarkets) : markets;
  }

  /**
   * Live-universe analog of `listResolvedMarkets`: scans currently-open markets (status=open)
   * with the same volume-filter + early-stop-at-cap pagination logic, mapping the live order
   * book (yes bid/ask) to cents for downstream anomaly detection.
   */
  async listOpenMarkets(opts?: { minVolume?: number; maxMarkets?: number }): Promise<LiveMarket[]> {
    const minVolume = opts?.minVolume ?? 0;
    const maxMarkets = opts?.maxMarkets;
    const markets: LiveMarket[] = [];
    let cursor: string | undefined;
    do {
      const body = await this.getJson("/markets", {
        status: "open",
        limit: 1000,
        cursor,
      });
      for (const m of body.markets ?? []) {
        const seriesTicker = seriesFromEvent(m.event_ticker ?? "");
        const live: LiveMarket = {
          marketTicker: m.ticker,
          seriesTicker,
          category: seriesTicker,
          openTs: isoToUnix(m.open_time),
          closeTs: isoToUnix(m.close_time),
          liquidityVolume: parseFp(m.volume_fp),
          yesBidCents: dollarsToCents(m.yes_bid_dollars),
          yesAskCents: dollarsToCents(m.yes_ask_dollars),
        };
        if (live.liquidityVolume >= minVolume) markets.push(live);
      }
      cursor = body.cursor || undefined;
      if (maxMarkets !== undefined && markets.length >= maxMarkets) break;
    } while (cursor);
    return maxMarkets !== undefined ? markets.slice(0, maxMarkets) : markets;
  }
}
