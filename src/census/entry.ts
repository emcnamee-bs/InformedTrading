import { LiveMarket, Candle, Trade } from "../kalshi/types";
import { InsiderDb, OpenBet } from "./insiderDb";
import { detectCandidateWithFeatures } from "../live/candidate";
import { isEventPast } from "../live/eventDate";
import { categoryOf, bandOf, timeBucketOf, scoreBucketOf, detectorLabel, cellKey, SPORTS_CATEGORY } from "./cell";

export interface MarketData { market: LiveMarket; candles: Candle[]; trades: Trade[] }
export interface EntryFunnel { universe: number; pastEvent: number; sports: number; scanned: number; fired: number; entered: number }

const SENSITIVITY = "medium";

export function runEntryCycle(markets: MarketData[], db: InsiderDb, nowTs: number): EntryFunnel {
  const f: EntryFunnel = { universe: markets.length, pastEvent: 0, sports: 0, scanned: 0, fired: 0, entered: 0 };
  for (const md of markets) {
    const m = md.market;
    if (isEventPast(m.marketTicker, nowTs)) { f.pastEvent++; continue; }
    const category = categoryOf(m.seriesTicker);
    if (category === SPORTS_CATEGORY) { f.sports++; continue; }
    f.scanned++;
    const res = detectCandidateWithFeatures(m, md.candles, md.trades);
    if (!res) continue;
    f.fired++;
    const { candidate, features } = res;
    if (candidate.entryCents <= 0 || candidate.entryCents >= 100) continue; // degenerate price, nothing to bet
    const minsToClose = Math.max(0, (m.closeTs - nowTs) / 60);
    const detector = detectorLabel(features);
    const entryBand = bandOf(candidate.entryCents);
    const timeBucket = timeBucketOf(minsToClose);
    const scoreBucket = scoreBucketOf(candidate.anomalyScore);
    const key = cellKey({ category, detector, sensitivity: SENSITIVITY, direction: candidate.direction, entryBand, timeBucket, scoreBucket });
    const bet: OpenBet = {
      ticker: m.marketTicker, side: candidate.direction, entryPriceCents: candidate.entryCents,
      count: 1 / candidate.entryCents, openedTs: nowTs, closeMs: m.closeTs * 1000,
      category, detector, sensitivity: SENSITIVITY, direction: candidate.direction,
      entryBand, timeBucket, scoreBucket, anomalyScore: candidate.anomalyScore, cellKey: key,
    };
    if (db.openBet(bet)) f.entered++;
  }
  return f;
}
