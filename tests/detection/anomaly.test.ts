import { describe, it, expect } from "vitest";
import { detectAnomaly, DEFAULT_ANOMALY_PARAMS } from "../../src/detection/anomaly";
import { FeatureVector } from "../../src/detection/features";

const base: FeatureVector = {
  cusumFired: false, cusumDir: null, flowImbalance: null,
  volumeZ: null, oiDelta: null, vpin: null,
};

describe("detectAnomaly", () => {
  it("no anomaly when nothing fires", () => {
    expect(detectAnomaly(base).isAnomaly).toBe(false);
  });

  it("anomaly when CUSUM fires AND flow/volume confirms, direction from CUSUM", () => {
    const f: FeatureVector = {
      ...base, cusumFired: true, cusumDir: "yes", flowImbalance: 0.8, volumeZ: 4,
    };
    const r = detectAnomaly(f);
    expect(r.isAnomaly).toBe(true);
    expect(r.direction).toBe("yes");
  });

  it("no anomaly when CUSUM fires but flow/volume do NOT confirm", () => {
    const f: FeatureVector = {
      ...base, cusumFired: true, cusumDir: "yes", flowImbalance: 0.05, volumeZ: 0.5,
    };
    expect(detectAnomaly(f).isAnomaly).toBe(false);
  });

  it("respects VPIN when present (abstained VPIN does not block)", () => {
    const withVpin: FeatureVector = {
      ...base, cusumFired: true, cusumDir: "no", flowImbalance: -0.9, volumeZ: 5, vpin: 0.9,
    };
    expect(detectAnomaly(withVpin).isAnomaly).toBe(true);
    const lowVpin: FeatureVector = { ...withVpin, vpin: 0.05 };
    expect(detectAnomaly(lowVpin).isAnomaly).toBe(false);
  });
});
