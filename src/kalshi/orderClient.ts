import { Config } from "../config";
import { Side } from "./types";
import { authHeaders } from "./auth";

export interface OrderRequest {
  ticker: string;
  side: Side;
  count: number;
  priceCents: number;
  clientOrderId: string;
  buyMaxCostCents: number;
}

type FetchLike = (
  url: string,
  init?: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

/**
 * Places REAL orders against the authenticated Kalshi trading API. `cfg.kalshiBaseUrl` already
 * ends in `/trade-api/v2`; the path we sign must match that exactly (scheme+host stripped) and
 * must exclude any query string, per Kalshi's RSA-PSS request-signing scheme (see auth.ts).
 */
export class AuthedClient {
  /** pathname portion of the base URL, e.g. "/trade-api/v2" — prefixed onto every signed path. */
  private readonly basePath: string;

  constructor(
    private readonly cfg: Config,
    private readonly keyId: string,
    private readonly privateKeyPem: string,
    private readonly fetchFn: FetchLike = fetch as unknown as FetchLike,
    private readonly nowFn: () => number = () => Date.now(),
  ) {
    this.basePath = new URL(cfg.kalshiBaseUrl).pathname;
  }

  private async request(method: "GET" | "POST", endpoint: string, body?: unknown): Promise<any> {
    const signedPath = `${this.basePath}${endpoint}`; // no query string — endpoint here never carries one
    const url = `${this.cfg.kalshiBaseUrl}${endpoint}`;
    const headers: Record<string, string> = authHeaders(this.keyId, method, signedPath, this.privateKeyPem, this.nowFn());
    const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const res = await this.fetchFn(url, init);
    if (!res.ok) throw new Error(`Kalshi ${method} ${endpoint} -> HTTP ${res.status}`);
    return res.json();
  }

  async getBalanceCents(): Promise<number> {
    const body = await this.request("GET", "/portfolio/balance");
    return body.balance;
  }

  async placeLimitBuy(o: OrderRequest): Promise<{ orderId: string; status: string }> {
    const priceField = o.side === "yes" ? "yes_price" : "no_price";
    const body = await this.request("POST", "/portfolio/orders", {
      ticker: o.ticker,
      action: "buy",
      side: o.side,
      count: o.count,
      type: "limit",
      [priceField]: o.priceCents,
      client_order_id: o.clientOrderId,
      buy_max_cost: o.buyMaxCostCents,
    });
    return { orderId: body.order.order_id, status: body.order.status };
  }
}
