const test = require("node:test");
const assert = require("node:assert/strict");
const { createPayPalService } = require("../../src/dashboard/paypalService");

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function credentials(overrides) {
  return Object.assign(
    {
      PAYPAL_ENV: "sandbox",
      PAYPAL_CLIENT_ID: "client-id",
      PAYPAL_CLIENT_SECRET: "client-secret",
      PAYPAL_PREMIUM_PRICE: "6.50",
      PAYPAL_CURRENCY: "EUR",
      PREMIUM_DURATION_DAYS: "30",
    },
    overrides || {},
  );
}

test("PayPal checkout creates an order with the configured plan and approval URL", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/v1/oauth2/token"))
      return response({ access_token: "access-token", expires_in: 3600 });
    return response({
      id: "ORDER-123456",
      links: [{ rel: "approve", href: "https://paypal.example/approve" }],
    });
  };
  const paypal = createPayPalService({ env: credentials(), fetchImpl });

  const result = await paypal.createOrder({
    guildId: "123456789012345678",
    purchaserDiscordUserId: "987654321098765432",
    returnUrl: "https://dashboard.example/api/premium/paypal/return",
    cancelUrl: "https://dashboard.example/api/premium/paypal/cancel",
  });

  assert.equal(result.id, "ORDER-123456");
  assert.equal(result.approvalUrl, "https://paypal.example/approve");
  assert.deepEqual(result.plan, {
    amount: "6.50",
    currency: "EUR",
    durationDays: 30,
  });
  assert.equal(
    calls[1].url,
    "https://api-m.sandbox.paypal.com/v2/checkout/orders",
  );
  const order = JSON.parse(calls[1].options.body);
  assert.equal(order.purchase_units[0].custom_id, "987654321098765432");
  assert.equal(order.purchase_units[0].reference_id, "123456789012345678");
  assert.deepEqual(order.purchase_units[0].amount, {
    currency_code: "EUR",
    value: "6.50",
  });
  assert.equal(
    order.application_context.return_url,
    "https://dashboard.example/api/premium/paypal/return",
  );
});

test("PayPal checkout stays disabled without valid server credentials and price", () => {
  const paypal = createPayPalService({
    env: credentials({ PAYPAL_CLIENT_SECRET: "", PAYPAL_PREMIUM_PRICE: "0" }),
    fetchImpl: async () => response({}),
  });

  assert.equal(paypal.isConfigured(), false);
  assert.equal(paypal.getPlan().amount, null);

  const invalidPrecision = createPayPalService({
    env: credentials({ PAYPAL_PREMIUM_PRICE: "6.505" }),
    fetchImpl: async () => response({}),
  });
  assert.equal(invalidPrecision.isConfigured(), false);
});

test("PayPal checkout accepts a valid plan configured outside environment variables", async () => {
  const fetchImpl = async (url) =>
    url.endsWith("/v1/oauth2/token")
      ? response({ access_token: "access-token", expires_in: 3600 })
      : response({
          id: "ORDER-CUSTOM",
          links: [{ rel: "approve", href: "https://paypal.example/approve" }],
        });
  const paypal = createPayPalService({
    env: credentials({ PAYPAL_PREMIUM_PRICE: "" }),
    fetchImpl,
  });

  const result = await paypal.createOrder({
    guildId: "123456789012345678",
    purchaserDiscordUserId: "987654321098765432",
    returnUrl: "https://dashboard.example/return",
    cancelUrl: "https://dashboard.example/cancel",
    plan: { amount: "12.00", currency: "EUR", durationDays: 60 },
  });
  assert.equal(result.plan.amount, "12.00");
  assert.equal(result.plan.durationDays, 60);
});

test("PayPal webhook verification requires the expected signature status", async () => {
  let verifiedBody = null;
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/v1/oauth2/token"))
      return response({ access_token: "access-token", expires_in: 3600 });
    verifiedBody = JSON.parse(options.body);
    return response({ verification_status: "SUCCESS" });
  };
  const paypal = createPayPalService({ env: credentials(), fetchImpl });
  const headers = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.paypal.com/cert",
    "paypal-transmission-id": "transmission-id",
    "paypal-transmission-sig": "signature",
    "paypal-transmission-time": "2026-10-18T10:00:00Z",
  };

  assert.equal(
    await paypal.verifyWebhook({
      headers,
      webhookId: "webhook-id",
      event: { id: "event-id" },
    }),
    true,
  );
  assert.equal(verifiedBody.webhook_id, "webhook-id");
  assert.equal(
    await paypal.verifyWebhook({
      headers: {},
      webhookId: "webhook-id",
      event: {},
    }),
    false,
  );
});
