import { test } from "node:test";
import assert from "node:assert/strict";
import { Plaxswap, PlaxswapError } from "../dist/esm/index.js";

function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); const { status = 200, body } = handler(url, init); return new Response(body === undefined ? "" : JSON.stringify(body), { status }); };
  f.calls = calls; return f;
}

test("sends the key, idempotency key and JSON body", async () => {
  const f = fakeFetch(() => ({ status: 201, body: { id: "pay_0000000000000001", object: "payment", status: "pending" } }));
  const px = new Plaxswap({ apiKey: "pxs_test_x", fetch: f });
  const p = await px.payments.create({ amount: "100", currency: "USD", receive: "usdt-tron", orderId: "1042" }, { idempotencyKey: "order-1042" });
  assert.equal(p.id, "pay_0000000000000001");
  const { url, init } = f.calls[0];
  assert.equal(url, "https://plaxswap.com/api/v1/payments");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.authorization, "Bearer pxs_test_x");
  assert.equal(init.headers["idempotency-key"], "order-1042");
  assert.deepEqual(JSON.parse(init.body), { amount: "100", currency: "USD", receive: "usdt-tron", orderId: "1042" });
});

test("builds list queries", async () => {
  const f = fakeFetch(() => ({ body: { data: [], hasMore: false, nextCursor: null } }));
  await new Plaxswap({ apiKey: "pxs_test_x", fetch: f }).payments.list({ status: "paid", limit: 10 });
  assert.equal(f.calls[0].url, "https://plaxswap.com/api/v1/payments?status=paid&limit=10");
});

test("turns API errors into PlaxswapError", async () => {
  const f = fakeFetch(() => ({ status: 401, body: { error: { code: "invalid_api_key", message: "That key is wrong." } } }));
  await assert.rejects(new Plaxswap({ apiKey: "bad", fetch: f }).payments.retrieve("pay_x"), (e) => e instanceof PlaxswapError && e.status === 401 && e.code === "invalid_api_key");
});

test("swap status passes the deposit address", async () => {
  const f = fakeFetch(() => ({ body: { status: "PENDING_DEPOSIT" } }));
  await new Plaxswap({ fetch: f }).swap.status("0xabc");
  assert.equal(f.calls[0].url, "https://plaxswap.com/api/v1/dex/status?depositAddress=0xabc");
});
