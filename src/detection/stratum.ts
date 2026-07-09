import { ResolvedMarket } from "../kalshi/types";

export type LiquidityBand = "thin" | "mid" | "deep";

/** Coarse liquidity banding (cents of Kalshi liquidity). Tune in Phase 2. */
export function liquidityBand(liquidityCents: number): LiquidityBand {
  if (liquidityCents < 50_000) return "thin";
  if (liquidityCents < 500_000) return "mid";
  return "deep";
}

export function stratumKey(market: ResolvedMarket): string {
  return `${market.category}|${liquidityBand(market.liquidityCents)}`;
}
