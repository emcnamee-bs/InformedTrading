import { describe, it, expect } from "vitest";
import { categoryOf, bandOf, timeBucketOf, scoreBucketOf, detectorLabel, cellKey } from "../../src/census/cell";
import { FeatureVector } from "../../src/detection/features";

describe("cell bucketing", () => {
  it("categoryOf maps series prefixes; sports detected, unknown -> other", () => {
    expect(categoryOf("KXMLBMENTION")).toBe("sports");
    expect(categoryOf("KXWCMENTION")).toBe("sports");
    expect(categoryOf("KXAOCMENTION")).toBe("mentions");
    expect(categoryOf("KXNETFLIXRANKSHOWRUNNERUP")).toBe("entertainment");
    expect(categoryOf("KXWEIRDUNKNOWN")).toBe("other");
  });
  it("bandOf buckets by whole cent, excludes 0/100", () => {
    expect(bandOf(62)).toBe("b62");
    expect(bandOf(0)).toBe("bNA");
    expect(bandOf(100)).toBe("bNA");
  });
  it("bandOf rounds BEFORE the 0/100 exclusion (99.6 -> bNA, 0.4 -> bNA)", () => {
    expect(bandOf(99.6)).toBe("bNA");
    expect(bandOf(0.4)).toBe("bNA");
    expect(bandOf(62.4)).toBe("b62");
  });
  it("timeBucketOf slices minutes-to-close", () => {
    expect(timeBucketOf(20)).toBe("30m");
    expect(timeBucketOf(90)).toBe("2h");
    expect(timeBucketOf(60 * 20)).toBe("1d");
    expect(timeBucketOf(60 * 24 * 9)).toBe("1wk"); // capped
  });
  it("scoreBucketOf low/med/high", () => {
    expect(scoreBucketOf(0.5)).toBe("low");
    expect(scoreBucketOf(2.0)).toBe("med");
    expect(scoreBucketOf(4.0)).toBe("high");
  });
  it("detectorLabel names the confirming signal(s)", () => {
    const base: FeatureVector = { cusumFired: true, cusumDir: "yes", flowImbalance: 0.5, volumeZ: 0.1, vpin: null } as any;
    expect(detectorLabel(base)).toContain("imbalance");
    expect(detectorLabel({ ...base, flowImbalance: 0.0, volumeZ: 3 } as any)).toContain("volumeZ");
  });
  it("cellKey is a stable pipe-joined string", () => {
    expect(cellKey({ category: "mentions", detector: "cusum+imbalance", sensitivity: "medium", direction: "yes", entryBand: "b62", timeBucket: "1d", scoreBucket: "med" }))
      .toBe("mentions|cusum+imbalance|medium|yes|b62|1d|med");
  });
});
