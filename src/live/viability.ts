import { LiveCandidate } from "./candidate";
import { feePerContract } from "../expectancy/fees";

export interface ViabilityParams {
  maxHorizonDays: number;
  minReturn: number; // fraction, e.g. 0.05 = 5%
  maxSpreadCents: number;
}

export const DEFAULT_VIABILITY: ViabilityParams = {
  maxHorizonDays: 31,
  minReturn: 0.05,
  maxSpreadCents: 8,
};

/**
 * Viability now gates on net-of-fee RETURN rather than an entry-price band: the live strategy
 * is to follow informed flow already detected by `detectCandidate`, as long as enough
 * net-of-fee return remains before resolution -- not to avoid extreme prices per se.
 */
export function isViable(
  c: LiveCandidate,
  nowTs: number,
  p: ViabilityParams = DEFAULT_VIABILITY,
): { viable: boolean; reason?: string } {
  const horizon = c.market.closeTs - nowTs;
  if (horizon <= 0) return { viable: false, reason: "already closed" };
  if (horizon > p.maxHorizonDays * 86400)
    return { viable: false, reason: "beyond horizon" };
  if (!Number.isFinite(c.entryCents) || c.entryCents <= 0 || c.entryCents >= 100)
    return { viable: false, reason: "degenerate entry price" };
  const spread = c.market.yesAskCents - c.market.yesBidCents;
  if (!Number.isFinite(spread) || spread > p.maxSpreadCents)
    return { viable: false, reason: "spread too wide" };

  // Net-of-fee return if the market resolves in the flow direction: payout is $1/contract,
  // cost is entry price plus the Kalshi per-contract fee (both in dollars per contract).
  const cost = c.entryCents / 100 + feePerContract(c.entryCents);
  const ret = (1 - cost) / cost;
  if (ret < p.minReturn) {
    return {
      viable: false,
      reason: `return ${(ret * 100).toFixed(1)}% below min ${(p.minReturn * 100).toFixed(1)}%`,
    };
  }

  return { viable: true };
}
