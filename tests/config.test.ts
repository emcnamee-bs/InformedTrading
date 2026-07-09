import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("falls back to defaults when env is empty", () => {
    const cfg = loadConfig({});
    expect(cfg.kalshiBaseUrl).toContain("kalshi");
    expect(cfg.cacheDir).toBe(".cache");
    expect(cfg.requestsPerSecond).toBe(5);
  });

  it("reads overrides from the provided env object", () => {
    const cfg = loadConfig({ CACHE_DIR: "/tmp/x", REQUESTS_PER_SECOND: "2" });
    expect(cfg.cacheDir).toBe("/tmp/x");
    expect(cfg.requestsPerSecond).toBe(2);
  });
});
