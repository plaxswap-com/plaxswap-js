# plaxswap

The official JavaScript and TypeScript client for the [Plaxswap](https://plaxswap.com) API.

- **Accept crypto payments** on your site: create a payment, send the customer to the hosted checkout, and check the signed webhook. Docs: [Crypto payment gateway API](https://plaxswap.com/developers/payments).
- **Payment links**: ask for an exact amount of one coin; the payer can use any supported coin. See [crypto payment links](https://plaxswap.com/pay).
- **Swaps**: quote routes from KyberSwap, 0x, LI.FI, Relay and NEAR Intents, best return first, with every fee shown. See the [swap API guide](https://plaxswap.com/developers).

No dependencies. Works on Node.js 18+, Deno, Bun and in browsers (keep secret keys on your server).

## Install

```bash
npm install plaxswap
```

## Accept a payment

```js
import { Plaxswap } from "plaxswap";

const px = new Plaxswap({ apiKey: process.env.PLAXSWAP_KEY }); // pxs_test_... or pxs_live_...

const payment = await px.payments.create(
  { amount: "100", currency: "USD", receive: "usdt-tron", orderId: "1042", description: "2 x T-shirt", returnUrl: "https://shop.example/orders/1042" },
  { idempotencyKey: "order-1042" } // retries return the same payment
);

// Send the customer here:
console.log(payment.checkoutUrl);
```

With a test key nothing real moves. Act out an outcome and get the same webhook a live payment sends:

```js
await px.payments.simulate(payment.id, "paid");
```

## Check the webhook

Plaxswap signs each webhook with the `x-px-signature` header. Check it against the **raw** body:

```js
import express from "express";
import { constructEvent } from "plaxswap/webhooks";

const app = express();
app.post("/plaxswap-webhook", express.raw({ type: "*/*" }), async (req, res) => {
  let event;
  try {
    event = constructEvent(req.body, req.get("x-px-signature"), process.env.PLAXSWAP_WEBHOOK_SECRET);
  } catch {
    return res.sendStatus(400);
  }
  res.sendStatus(200);
  // Skip events you have seen (event.id), then read the payment back before you ship:
  const payment = await px.payments.retrieve(event.data.id);
  if (payment.status === "paid") {
    // fulfil order payment.orderId
  }
});
```

## Quote a swap

```js
const px = new Plaxswap(); // no key needed for quotes
const { routes } = await px.swap.routes({ from: "usdt-tron", to: "btc", amount: "250" });
```

## Errors

Every failed call throws `PlaxswapError` with `status`, a stable `code` (for example `invalid_api_key`) and a plain-English `message` that is safe to show.

## Fees

Gateway: the customer pays the 1.5% platform fee at checkout; you pay 0.3% plus the network fee when you withdraw. Swaps: Plaxswap's fee is at most 0.3%, plus the route's own fee. Current figures: [plaxswap.com/fees](https://plaxswap.com/fees).

## Links

- [Plaxswap](https://plaxswap.com)
- [Payment gateway docs](https://plaxswap.com/developers/payments)
- [OpenAPI document](https://plaxswap.com/api/v1/openapi.json)
- [WooCommerce plugin](https://plaxswap.com/integrations/woocommerce)
- Support: support@plaxswap.com

MIT licence.
