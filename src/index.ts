// Plaxswap API client for JavaScript and TypeScript.
// Docs: https://plaxswap.com/developers/payments (payment gateway) and https://plaxswap.com/developers (swap API).
// No dependencies: it uses the global fetch of Node.js 18+, Deno, Bun and browsers.

export const DEFAULT_BASE_URL = "https://plaxswap.com";
export const VERSION = "0.1.0";

export interface PlaxswapOptions {
  /** Merchant key (pxs_test_... or pxs_live_...) for the payment gateway, or a partner key (pxk_...) for swaps. Keep it on your server. */
  apiKey?: string;
  /** Defaults to https://plaxswap.com */
  baseUrl?: string;
  /** Partners: the end user's public IP address, sent as x-user-ip so their country rules apply. */
  userIp?: string;
  /** Request timeout in milliseconds (default 30 000). */
  timeoutMs?: number;
  /** Your own fetch, for tests or older runtimes. */
  fetch?: typeof fetch;
}

/** Every API error: an HTTP status plus the stable code and plain-English message from the API. */
export class PlaxswapError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "PlaxswapError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** A coin on one network, for example "usdt-tron", "btc" or "eth-base". */
export type MethodId = string;

export type PaymentStatus = "pending" | "paid" | "partially_paid" | "overpaid" | "late" | "expired" | "failed" | "cancelled" | string;

export interface CreatePaymentParams {
  /** The price as a decimal string, for example "100" or "25.50". */
  amount: string;
  /** A fiat code (USD, EUR, INR...) or a coin (USDT, BTC...). */
  currency: string;
  /** The coin and network you receive, for example "usdt-tron". Default: the one saved on your account. */
  receive?: MethodId;
  receiveAddress?: string;
  receiveMemo?: string;
  /** Your own reference, shown to the payer and searchable. */
  orderId?: string;
  description?: string;
  returnUrl?: string;
  customer?: { name?: string; email?: string; note?: string };
  [extra: string]: unknown;
}

export interface Payment {
  id: string;
  object: "payment";
  livemode: boolean;
  status: PaymentStatus;
  amount: string;
  currency: string;
  receiveAmount?: string;
  expectedAmount?: string;
  orderId?: string | null;
  checkoutUrl?: string;
  trackingUrl?: string;
  expiresAt?: string;
  [extra: string]: unknown;
}

export interface PaymentList {
  data: Payment[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ListPaymentsParams {
  status?: string;
  orderId?: string;
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
  cursor?: string;
}

export type TestOutcome = "paid" | "partially_paid" | "overpaid" | "late" | "expired" | "failed" | string;

export interface CreatePaymentLinkParams {
  branding: { name: string; logo?: string | null };
  title: string;
  description?: string;
  settleMethodId: MethodId;
  settleAmount: string;
  settleAddress: string;
  settleMemo?: string;
  expiresIn: "1h" | "24h" | "7d" | "30d" | "never";
  reusable?: boolean;
  [extra: string]: unknown;
}

export interface RoutesParams {
  from: MethodId;
  to: MethodId;
  /** Decimal string in coin units, for example "0.015". */
  amount: string;
  /** The paying wallet, to dry-run the routes for it. */
  account?: string;
  /** Where the new coin goes. */
  toAccount?: string;
  slippageBps?: 30 | 50 | 100;
  /** send: a one-time deposit address; connect: the customer's wallet signs. */
  pay?: "send" | "connect";
  /** Partners only: 0 to 200 basis points, paid by the route to commissionTo. */
  commissionBps?: number;
  commissionTo?: string;
}

type Query = Record<string, string | number | boolean | undefined>;

export class Plaxswap {
  readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly userIp?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  readonly payments: PaymentsApi;
  readonly paymentLinks: PaymentLinksApi;
  readonly gateway: GatewayApi;
  readonly swap: SwapApi;

  constructor(options: PlaxswapOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.userIp = options.userIp;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    const f = options.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (!f) throw new Error("plaxswap: no fetch available. Use Node.js 18+ or pass options.fetch.");
    this.fetchImpl = f;
    this.payments = new PaymentsApi(this);
    this.paymentLinks = new PaymentLinksApi(this);
    this.gateway = new GatewayApi(this);
    this.swap = new SwapApi(this);
  }

  /** Service mode, the caller's country rules and time limits. */
  meta(): Promise<Record<string, unknown>> {
    return this.request("GET", "/api/v1/meta");
  }

  /** Coins, networks and methods. */
  coins(): Promise<Record<string, unknown>> {
    return this.request("GET", "/api/v1/coins");
  }

  /** Low-level call for any endpoint in https://plaxswap.com/api/v1/openapi.json */
  async request<T = any>(method: string, path: string, options: { body?: unknown; query?: Query; headers?: Record<string, string> } = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { accept: "application/json", "user-agent": `plaxswap-js/${VERSION}`, ...options.headers };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    if (this.userIp) headers["x-user-ip"] = this.userIp;
    let body: string | undefined;
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), { method, headers, body, signal: ctrl.signal });
    } catch (err) {
      throw new PlaxswapError(0, (err as Error).name === "AbortError" ? "timeout" : "network_error", (err as Error).message);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let data: any = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (!res.ok) {
      const e = data?.error;
      throw new PlaxswapError(res.status, e?.code ?? `http_${res.status}`, e?.message ?? (text.slice(0, 200) || res.statusText), e?.details);
    }
    return data as T;
  }
}

class PaymentsApi {
  constructor(private readonly c: Plaxswap) {}
  /** Ask for a payment; send the payer to payment.checkoutUrl. Pass an idempotencyKey (for example your order number) so retries are safe. */
  create(params: CreatePaymentParams, opts: { idempotencyKey?: string } = {}): Promise<Payment> {
    return this.c.request("POST", "/api/v1/payments", { body: params, headers: opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : undefined });
  }
  retrieve(id: string): Promise<Payment> {
    return this.c.request("GET", `/api/v1/payments/${encodeURIComponent(id)}`);
  }
  list(params: ListPaymentsParams = {}): Promise<PaymentList> {
    return this.c.request("GET", "/api/v1/payments", { query: params as Query });
  }
  /** Cancel a payment nothing was paid to. */
  cancel(id: string): Promise<Payment> {
    return this.c.request("POST", `/api/v1/payments/${encodeURIComponent(id)}/cancel`, { body: {} });
  }
  /** Test keys only: act out an outcome and receive the webhook a live payment would send. */
  simulate(id: string, outcome: TestOutcome, payCurrency?: string): Promise<Payment> {
    return this.c.request("POST", `/api/v1/payments/${encodeURIComponent(id)}/simulate`, { body: payCurrency ? { outcome, payCurrency } : { outcome } });
  }
}

class PaymentLinksApi {
  constructor(private readonly c: Plaxswap) {}
  /** Create a "pay me exactly this amount" link. Keep manageToken: it is shown once. */
  create(params: CreatePaymentLinkParams): Promise<{ link: Record<string, unknown>; manageToken: string; payUrl: string; manageUrl: string }> {
    return this.c.request("POST", "/api/v1/payment-links", { body: params });
  }
  retrieve(id: string): Promise<Record<string, unknown>> {
    return this.c.request("GET", `/api/v1/payment-links/${encodeURIComponent(id)}`);
  }
  /** Coins and networks a link can be paid in. */
  coins(): Promise<Record<string, unknown>> {
    return this.c.request("GET", "/api/v1/payment-links/coins");
  }
}

class GatewayApi {
  constructor(private readonly c: Plaxswap) {}
  /** Coins you can receive, and what payers can pay each with. No key needed. */
  coins(): Promise<{ catalogue: unknown[]; receive: unknown[] }> {
    return this.c.request("GET", "/api/v1/gateway/coins");
  }
}

class SwapApi {
  constructor(private readonly c: Plaxswap) {}
  /** The swap form's coins. */
  coins(): Promise<Record<string, unknown>> {
    return this.c.request("GET", "/api/v1/dex/coins");
  }
  /** Routes for a pair and amount, best first, each with its fees and time. */
  routes(params: RoutesParams): Promise<Record<string, unknown>> {
    return this.c.request("POST", "/api/v1/dex/routes", { body: params });
  }
  /** The transaction for the customer's wallet, or a one-time deposit address, for a chosen route. */
  build(routeId: string): Promise<Record<string, unknown>> {
    return this.c.request("POST", "/api/v1/dex/build", { body: { routeId } });
  }
  /** Progress of a swap paid to a one-time deposit address. */
  status(depositAddress: string): Promise<Record<string, unknown>> {
    return this.c.request("GET", "/api/v1/dex/status", { query: { depositAddress } });
  }
}

export default Plaxswap;
