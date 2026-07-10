import { describe, it, expect } from "vitest";
import { generateKeyPairSync, verify as cryptoVerify, constants } from "node:crypto";
import { Config } from "../../src/config";
import { AuthedClient, OrderRequest } from "../../src/kalshi/orderClient";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

const cfg: Config = {
  kalshiBaseUrl: "https://api.elections.kalshi.com/trade-api/v2",
  cacheDir: ".cache",
  requestsPerSecond: 5,
};

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function fakeFetch(responseBody: any) {
  const calls: Captured[] = [];
  const fn = async (url: string, init?: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init?.method ?? "GET", headers: init?.headers ?? {}, body: init?.body });
    return {
      ok: true,
      status: 200,
      json: async () => responseBody,
    };
  };
  return { fn, calls };
}

describe("AuthedClient", () => {
  it("getBalanceCents signs a GET to /portfolio/balance and parses balance", async () => {
    const { fn, calls } = fakeFetch({ balance: 12345 });
    const client = new AuthedClient(cfg, "KID", pem, fn as any, () => 1703123456789);

    const balance = await client.getBalanceCents();

    expect(balance).toBe(12345);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.method).toBe("GET");
    expect(call.url).toBe("https://api.elections.kalshi.com/trade-api/v2/portfolio/balance");
    expect(call.headers["KALSHI-ACCESS-KEY"]).toBe("KID");
    expect(call.headers["KALSHI-ACCESS-TIMESTAMP"]).toBe("1703123456789");
    expect(typeof call.headers["KALSHI-ACCESS-SIGNATURE"]).toBe("string");
    expect(call.headers["KALSHI-ACCESS-SIGNATURE"]!.length).toBeGreaterThan(0);
  });

  it("placeLimitBuy signs a POST to /portfolio/orders with a yes_price body for side=yes", async () => {
    const { fn, calls } = fakeFetch({ order: { order_id: "ORD-1", status: "resting" } });
    const client = new AuthedClient(cfg, "KID", pem, fn as any, () => 1703123456789);

    const req: OrderRequest = {
      ticker: "TICKER-YES",
      side: "yes",
      count: 3,
      priceCents: 42,
      clientOrderId: "client-abc-1",
      buyMaxCostCents: 126,
    };
    const result = await client.placeLimitBuy(req);

    expect(result).toEqual({ orderId: "ORD-1", status: "resting" });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://api.elections.kalshi.com/trade-api/v2/portfolio/orders");
    expect(call.headers["Content-Type"]).toBe("application/json");
    expect(call.headers["KALSHI-ACCESS-KEY"]).toBe("KID");
    expect(typeof call.headers["KALSHI-ACCESS-SIGNATURE"]).toBe("string");

    const body = JSON.parse(call.body!);
    expect(body).toEqual({
      ticker: "TICKER-YES",
      action: "buy",
      side: "yes",
      count: 3,
      type: "limit",
      yes_price: 42,
      client_order_id: "client-abc-1",
      buy_max_cost: 126,
    });
    expect(body.no_price).toBeUndefined();
  });

  it("placeLimitBuy uses no_price for side=no", async () => {
    const { fn, calls } = fakeFetch({ order: { order_id: "ORD-2", status: "resting" } });
    const client = new AuthedClient(cfg, "KID", pem, fn as any, () => 1703123456789);

    const req: OrderRequest = {
      ticker: "TICKER-NO",
      side: "no",
      count: 1,
      priceCents: 17,
      clientOrderId: "client-abc-2",
      buyMaxCostCents: 17,
    };
    await client.placeLimitBuy(req);

    const body = JSON.parse(calls[0]!.body!);
    expect(body.no_price).toBe(17);
    expect(body.yes_price).toBeUndefined();
    expect(body.action).toBe("buy");
    expect(body.type).toBe("limit");
    expect(body.client_order_id).toBe("client-abc-2");
    expect(body.buy_max_cost).toBe(17);
  });

  it("signs exactly the pathname (incl. /trade-api/v2, excl. any query string)", async () => {
    const { fn, calls } = fakeFetch({ balance: 0 });
    const nowMs = 1703123456789;
    const client = new AuthedClient(cfg, "KID", pem, fn as any, () => nowMs);
    await client.getBalanceCents();

    const call = calls[0]!;
    expect(call.url).not.toContain("?");
    const fetchedPath = new URL(call.url).pathname;
    expect(fetchedPath).toBe("/trade-api/v2/portfolio/balance");

    // Prove the signature was computed over exactly this path (not the full URL, not with a
    // query string) by re-verifying it under the same PSS params auth.ts uses.
    const msg = Buffer.from(String(nowMs) + "GET" + fetchedPath);
    const ok = cryptoVerify(
      "sha256",
      msg,
      { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST },
      Buffer.from(call.headers["KALSHI-ACCESS-SIGNATURE"]!, "base64"),
    );
    expect(ok).toBe(true);
  });
});
