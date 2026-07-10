import { describe, it, expect } from "vitest";
import { controlDirection } from "../../src/replay/replay";

describe("controlDirection", () => {
  it("uses cusumDir 'no' even when prices net up (cusum wins, ignores prices)", () => {
    expect(controlDirection("no", 50, 90)).toBe("no");
  });

  it("uses cusumDir 'yes' even when prices net down (cusum wins, ignores prices)", () => {
    expect(controlDirection("yes", 90, 50)).toBe("yes");
  });

  it("falls back to the price sign when cusumDir is null and the window net moved down", () => {
    expect(controlDirection(null, 60, 40)).toBe("no");
  });

  it("falls back to the price sign when cusumDir is null and the window net moved up", () => {
    expect(controlDirection(null, 40, 60)).toBe("yes");
  });

  it("falls back to 'yes' on a flat/tied window when cusumDir is null", () => {
    expect(controlDirection(null, 50, 50)).toBe("yes");
  });
});
