import { LiveCandidate } from "./candidate";

export interface ViabilityParams {
  maxHorizonDays: number;
  minEntryCents: number;
  maxEntryCents: number;
  maxSpreadCents: number;
}

export const DEFAULT_VIABILITY: ViabilityParams = {
  maxHorizonDays: 31,
  minEntryCents: 5,
  maxEntryCents: 95,
  maxSpreadCents: 8,
};

export function isViable(
  c: LiveCandidate,
  nowTs: number,
  p: ViabilityParams = DEFAULT_VIABILITY,
): { viable: boolean; reason?: string } {
  const horizon = c.market.closeTs - nowTs;
  if (horizon <= 0) return { viable: false, reason: "already closed" };
  if (horizon > p.maxHorizonDays * 86400)
    return { viable: false, reason: "beyond horizon" };
  if (
    !Number.isFinite(c.entryCents) ||
    c.entryCents < p.minEntryCents ||
    c.entryCents > p.maxEntryCents
  )
    return { viable: false, reason: "entry price out of range" };
  const spread = c.market.yesAskCents - c.market.yesBidCents;
  if (!Number.isFinite(spread) || spread > p.maxSpreadCents)
    return { viable: false, reason: "spread too wide" };
  return { viable: true };
}
