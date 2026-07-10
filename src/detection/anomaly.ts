import { Side } from "../kalshi/types";
import { FeatureVector } from "./features";

export interface AnomalyParams {
  imbalanceTau: number; // min |flowImbalance| to confirm
  volumeZTau: number; // min volume z-score to confirm
  vpinTau: number; // min VPIN when present
}

export const DEFAULT_ANOMALY_PARAMS: AnomalyParams = {
  imbalanceTau: 0.3,
  volumeZTau: 2,
  vpinTau: 0.2,
};

export interface AnomalyResult {
  isAnomaly: boolean;
  direction: Side | null;
}

/**
 * A math-anomaly requires a fired price-jump (CUSUM) CONFIRMED by at least one
 * order-flow signal (imbalance or volume spike). VPIN, when present (not
 * abstained), must also clear its floor; an abstained VPIN neither confirms nor
 * blocks. Direction comes from CUSUM. (§5.4 candidate-feature confirmation.)
 */
export function detectAnomaly(
  f: FeatureVector,
  p: AnomalyParams = DEFAULT_ANOMALY_PARAMS,
): AnomalyResult {
  if (!f.cusumFired || f.cusumDir === null) return { isAnomaly: false, direction: null };

  const imbalanceConfirms =
    f.flowImbalance !== null && Math.abs(f.flowImbalance) >= p.imbalanceTau;
  const volumeConfirms = f.volumeZ !== null && f.volumeZ >= p.volumeZTau;
  if (!imbalanceConfirms && !volumeConfirms) return { isAnomaly: false, direction: null };

  if (f.vpin !== null && f.vpin < p.vpinTau) return { isAnomaly: false, direction: null };

  return { isAnomaly: true, direction: f.cusumDir };
}
