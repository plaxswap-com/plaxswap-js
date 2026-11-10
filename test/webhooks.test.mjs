import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySignature, constructEvent, sign } from "../dist/esm/webhooks.js";

const secret = "whsec_test_123";
const body = '{"id":"evt_3k9q2m7x8c1v5b4n","event":"payment.paid","livemode":false,"data":{"id":"pay_7m2k9q4x8c1v5b3n","object":"payment","status":"paid"}}';
const t = 1794000000;
const hex = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");

test("accepts a valid signature", () => assert.equal(verifySignature(body, `t=${t},v1=${hex}`, secret, 300, t + 10), true));
test("accepts when one of several v1 values matches", () => assert.equal(verifySignature(body, `t=${t},v1=${"0".repeat(64)},v1=${hex}`, secret, 300, t), true));
test("refuses a changed body", () => assert.equal(verifySignature(body + " ", `t=${t},v1=${hex}`, secret, 300, t), false));
test("refuses an old timestamp", () => assert.equal(verifySignature(body, `t=${t},v1=${hex}`, secret, 300, t + 301), false));
test("refuses a wrong secret", () => assert.equal(verifySignature(body, `t=${t},v1=${hex}`, "whsec_other", 300, t), false));
test("refuses a missing header", () => assert.equal(verifySignature(body, undefined, secret), false));
test("sign() matches the documented scheme", () => assert.equal(sign(body, secret, t), `t=${t},v1=${hex}`));
test("constructEvent parses after a fresh signature", () => {
  const ev = constructEvent(body, sign(body, secret), secret);
  assert.equal(ev.event, "payment.paid");
  assert.equal(ev.data.id, "pay_7m2k9q4x8c1v5b3n");
});
