import { ResolvedMarket } from "../kalshi/types";

export type LiquidityBand = "thin" | "mid" | "deep";

/** First-pass volume bands; tune in a later phase. */
export function liquidityBand(volume: number): LiquidityBand {
  if (volume < 1_000) return "thin";
  if (volume < 10_000) return "mid";
  return "deep";
}

export function stratumKey(market: ResolvedMarket): string {
  return `${market.category}|${liquidityBand(market.liquidityVolume)}`;
}
