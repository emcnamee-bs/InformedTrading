import { describe, it, expect } from "vitest";
import { generateKeyPairSync, verify, constants } from "node:crypto";
import { signRequest, authHeaders } from "../../src/kalshi/auth";

describe("kalshi auth", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

  it("produces a signature that verifies under the same PSS params", () => {
    const ts = "1703123456789";
    const path = "/trade-api/v2/portfolio/balance";
    const sig = signRequest("GET", path, ts, pem);
    const ok = verify("sha256", Buffer.from(ts + "GET" + path),
      { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST },
      Buffer.from(sig, "base64"));
    expect(ok).toBe(true);
  });

  it("authHeaders returns the three KALSHI-ACCESS-* headers", () => {
    const h = authHeaders("KID", "POST", "/trade-api/v2/portfolio/orders", pem, 1703123456789);
    expect(h["KALSHI-ACCESS-KEY"]).toBe("KID");
    expect(h["KALSHI-ACCESS-TIMESTAMP"]).toBe("1703123456789");
    expect(typeof h["KALSHI-ACCESS-SIGNATURE"]).toBe("string");
  });
});
