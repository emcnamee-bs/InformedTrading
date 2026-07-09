import { sign, constants } from "node:crypto";

export function signRequest(method: string, path: string, timestampMs: string, privateKeyPem: string): string {
  const msg = Buffer.from(timestampMs + method.toUpperCase() + path);
  const signature = sign("sha256", msg, {
    key: privateKeyPem,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return signature.toString("base64");
}

export function authHeaders(keyId: string, method: string, path: string, privateKeyPem: string, nowMs: number): Record<string, string> {
  const ts = String(nowMs);
  return {
    "KALSHI-ACCESS-KEY": keyId,
    "KALSHI-ACCESS-TIMESTAMP": ts,
    "KALSHI-ACCESS-SIGNATURE": signRequest(method, path, ts, privateKeyPem),
  };
}
