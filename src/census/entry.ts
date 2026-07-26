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
    const minsToClose = Math.max(0, (m.closeTs - nowTs) / 60);
    const bet: OpenBet = {
      ticker: m.marketTicker, side: candidate.direction, entryPriceCents: candidate.entryCents,
      count: candidate.entryCents > 0 ? 1 / candidate.entryCents : 0,
      openedTs: nowTs, closeMs: m.closeTs * 1000,
      category, detector: detectorLabel(features), sensitivity: SENSITIVITY, direction: candidate.direction,
      entryBand: bandOf(candidate.entryCents), timeBucket: timeBucketOf(minsToClose),
      scoreBucket: scoreBucketOf(candidate.anomalyScore), anomalyScore: candidate.anomalyScore,
      cellKey: cellKey({
        category, detector: detectorLabel(features), sensitivity: SENSITIVITY, direction: candidate.direction,
        entryBand: bandOf(candidate.entryCents), timeBucket: timeBucketOf(minsToClose), scoreBucket: scoreBucketOf(candidate.anomalyScore),
      }),
    };
    if (db.openBet(bet)) f.entered++;
  }
  return f;
}
