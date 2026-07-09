import { Candle, Side } from "../kalshi/types";
import { feePerContract } from "./fees";

/**
 * Realized net-of-fee fractional return of following `direction` at a realistic
 * spread-crossed entry on `entry`, held to `outcome`. (§8, #9)
 *  - buy YES  -> entry price = yesAsk.close
 *  - buy NO   -> entry price = 100 - yesBid.close
 *  - payout $1 if direction === outcome, else $0
 */
export function realizedDrift(entry: Candle, direction: Side, outcome: Side): number {
  const entryCents =
    direction === "yes" ? entry.yesAsk.close : 100 - entry.yesBid.close;
  // Out-of-domain / degenerate book (e.g. empty ask -> 0c, empty bid -> 100c NO entry):
  // return NaN rather than letting entryCost hit 0 and produce +/-Infinity downstream.
  if (!Number.isFinite(entryCents) || entryCents <= 0 || entryCents >= 100) return NaN;
  const fee = feePerContract(entryCents);
  const entryCost = entryCents / 100 + fee; // dollars per contract
  const payout = direction === outcome ? 1 : 0;
  return (payout - entryCost) / entryCost;
}
