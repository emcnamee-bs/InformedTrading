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
  const fee = feePerContract(entryCents);
  const entryCost = entryCents / 100 + fee; // dollars per contract
  const payout = direction === outcome ? 1 : 0;
  return (payout - entryCost) / entryCost;
}
