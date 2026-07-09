import { Candle, Trade, Side } from "../kalshi/types";
import { toLogOdds } from "../math/logOdds";
import { cusum } from "../math/cusum";
import { flowImbalance, volumeZScore, oiDelta } from "../math/orderFlow";
import { vpin } from "../math/vpin";

export interface FeatureVector {
  cusumFired: boolean;
  cusumDir: Side | null;
  flowImbalance: number | null;
  volumeZ: number | null;
  oiDelta: number | null;
  vpin: number | null;
}

export interface FeatureParams {
  cusumK: number;
  cusumH: number;
  bucketSize: number;
  numBuckets: number;
}

export const DEFAULT_FEATURE_PARAMS: FeatureParams = {
  cusumK: 0.5,
  cusumH: 4,
  bucketSize: 20,
  numBuckets: 3,
};

export function buildFeatures(
  window: Candle[],
  windowTrades: Trade[],
  baseline: Candle[],
  params: FeatureParams = DEFAULT_FEATURE_PARAMS,
): FeatureVector {
  const lo = window.map((c) => toLogOdds(c.price.close));
  const c = cusum(lo, params.cusumK, params.cusumH);
  const windowVol = window.reduce((a, b) => a + b.volume, 0);
  return {
    cusumFired: c.fired,
    cusumDir: c.direction,
    flowImbalance: flowImbalance(windowTrades),
    volumeZ: volumeZScore(windowVol, baseline.map((b) => b.volume)),
    oiDelta: oiDelta(window),
    vpin: vpin(windowTrades, params.bucketSize, params.numBuckets),
  };
}
