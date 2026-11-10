// Webhook signature check for Node.js (uses node:crypto).
// Plaxswap signs every webhook with the x-px-signature header: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">,
// keyed with your whole webhook secret (whsec_ included). There can be more than one v1 value.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-px-signature";

/** A webhook body, for example { id: "evt_...", event: "payment.paid", livemode, createdAt, data: { id: "pay_...", object: "payment", status, ... } }. */
export interface WebhookEvent<T = Record<string, unknown>> {
  id: string;
  event: string;
  livemode: boolean;
  createdAt: string;
  data: T & { id: string; object: string };
}

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

function parseHeader(header: string | null | undefined): { t: string | null; v1: string[] } {
  let t: string | null = null;
  const v1: string[] = [];
  for (const part of String(header ?? "").split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t" && /^\d{10}$/.test(v)) t = v;
    if (k === "v1" && /^[0-9a-f]{64}$/.test(v)) v1.push(v);
  }
  return { t, v1 };
}

/** The v1 signature Plaxswap would send for this body and timestamp (useful in your own tests). */
export function sign(rawBody: string | Uint8Array, secret: string, timestamp: number = Math.floor(Date.now() / 1000)): string {
  const h = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
  return `t=${timestamp},v1=${h}`;
}

/**
 * True when the header carries a valid signature for this exact raw body, signed within toleranceSec (default 300).
 * Pass the raw request body (a string or bytes), never a re-serialised JSON object.
 */
export function verifySignature(rawBody: string | Uint8Array, header: string | null | undefined, secret: string, toleranceSec = 300, nowSec: number = Date.now() / 1000): boolean {
  const { t, v1 } = parseHeader(header);
  if (!t || v1.length === 0 || !secret) return false;
  if (Math.abs(nowSec - Number(t)) > toleranceSec) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest("hex"));
  return v1.some((sig) => {
    const b = Buffer.from(sig);
    return b.length === expected.length && timingSafeEqual(b, expected);
  });
}

/** Checks the signature, then parses the event. Throws WebhookSignatureError when the check fails. */
export function constructEvent<T = WebhookEvent>(rawBody: string | Uint8Array, header: string | null | undefined, secret: string, toleranceSec = 300): T {
  if (!verifySignature(rawBody, header, secret, toleranceSec)) throw new WebhookSignatureError("Invalid or expired Plaxswap webhook signature");
  const text = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8");
  return JSON.parse(text) as T;
}
