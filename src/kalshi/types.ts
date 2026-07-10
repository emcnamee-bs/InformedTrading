export type Side = "yes" | "no";

export interface Ohlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Candle {
  marketTicker: string;
  seriesTicker: string;
  endPeriodTs: number; // unix seconds
  periodMinutes: 1 | 60 | 1440;
  price: Ohlc & { mean: number | null }; // YES price, cents 1..99
  yesBid: Ohlc; // cents
  yesAsk: Ohlc; // cents
  volume: number; // contracts traded this period
  openInterest: number; // outstanding contracts
}

export interface Trade {
  tradeId: string;
  ticker: string;
  yesPriceCents: number;
  count: number; // contracts
  takerSide: Side; // aggressor side
  createdTs: number; // unix seconds
}

export interface ResolvedMarket {
  marketTicker: string;
  seriesTicker: string;
  category: string;
  outcome: Side; // "yes" if settled YES, else "no"
  openTs: number;
  closeTs: number;
  liquidityVolume: number; // total traded contracts (Kalshi's liquidity_dollars field is deprecated/dead)
}

export interface LiveMarket {
  marketTicker: string;
  seriesTicker: string;
  category: string;
  openTs: number;
  closeTs: number;
  liquidityVolume: number;
  yesBidCents: number;
  yesAskCents: number;
}
