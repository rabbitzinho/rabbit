const crypto = require("crypto");

function createPayPalService({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const live =
    String(env.PAYPAL_ENV || "")
      .trim()
      .toLowerCase() === "live";
  const apiBase = live
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
  const priceText = String(env.PAYPAL_PREMIUM_PRICE || "").trim();
  const price = /^\d+(\.\d{1,2})?$/.test(priceText) ? Number(priceText) : NaN;
  const currency = String(env.PAYPAL_CURRENCY || "EUR")
    .trim()
    .toUpperCase();
  const durationText = String(env.PREMIUM_DURATION_DAYS || "30").trim();
  const durationDays = /^\d+$/.test(durationText) ? Number(durationText) : NaN;
  const clientId = String(env.PAYPAL_CLIENT_ID || "").trim();
  const clientSecret = String(env.PAYPAL_CLIENT_SECRET || "").trim();
  let cachedToken = null;
  let tokenExpiresAt = 0;

  function getPlan() {
    const validPrice = Number.isFinite(price) && price > 0;
    return {
      amount: validPrice ? price.toFixed(2) : null,
      currency,
      durationDays:
        Number.isInteger(durationDays) && durationDays > 0
          ? durationDays
          : null,
    };
  }

  function normalizePlan(source = getPlan()) {
    const amountText = String(source.amount || "").trim();
    const currencyCode = String(source.currency || "")
      .trim()
      .toUpperCase();
    const days = Number(source.durationDays);
    if (!/^\d+(\.\d{1,2})?$/.test(amountText) || Number(amountText) <= 0)
      return null;
    if (
      !/^[A-Z]{3}$/.test(currencyCode) ||
      !Number.isInteger(days) ||
      days <= 0 ||
      days > 3660
    )
      return null;
    return {
      amount: Number(amountText).toFixed(2),
      currency: currencyCode,
      durationDays: days,
    };
  }

  function isConfigured(planOverride) {
    const plan = normalizePlan(planOverride || getPlan());
    return Boolean(
      clientId && clientSecret && plan && typeof fetchImpl === "function",
    );
  }

  function hasCredentials() {
    return Boolean(clientId && clientSecret && typeof fetchImpl === "function");
  }

  async function parseResponse(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("PAYPAL_API_ERROR");
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function getAccessToken() {
    if (cachedToken && tokenExpiresAt > Date.now() + 30_000) return cachedToken;
    if (!hasCredentials()) throw new Error("PAYPAL_NOT_CONFIGURED");

    const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64",
    );
    const response = await fetchImpl(`${apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authorization}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const body = await parseResponse(response);
    if (!body.access_token) throw new Error("PAYPAL_AUTH_FAILED");

    cachedToken = body.access_token;
    tokenExpiresAt = Date.now() + (Number(body.expires_in) || 300) * 1000;
    return cachedToken;
  }

  async function request(path, body, requestId) {
    const token = await getAccessToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (requestId) headers["PayPal-Request-Id"] = requestId;

    const response = await fetchImpl(`${apiBase}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return parseResponse(response);
  }

  async function createOrder({
    guildId,
    purchaserDiscordUserId,
    returnUrl,
    cancelUrl,
    plan: planOverride,
  }) {
    const plan = normalizePlan(planOverride || getPlan());
    if (!plan || !isConfigured(plan)) throw new Error("PAYPAL_NOT_CONFIGURED");
    if (!guildId || !purchaserDiscordUserId || !returnUrl || !cancelUrl)
      throw new Error("PAYPAL_ORDER_FIELDS_REQUIRED");

    const invoiceId = `RB-${crypto.randomUUID()}`;
    const order = await request(
      "/v2/checkout/orders",
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: String(guildId),
            custom_id: String(purchaserDiscordUserId),
            invoice_id: invoiceId,
            description: `Rabbit Bot Premium (${plan.durationDays} days)`,
            amount: { currency_code: plan.currency, value: plan.amount },
          },
        ],
        application_context: {
          brand_name: "Rabbit Bot",
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      },
      invoiceId,
    );

    const approval = Array.isArray(order.links)
      ? order.links.find(
          (link) =>
            link && (link.rel === "approve" || link.rel === "payer-action"),
        )
      : null;
    if (!order.id || !approval || !approval.href)
      throw new Error("PAYPAL_APPROVAL_LINK_MISSING");
    return { id: String(order.id), approvalUrl: String(approval.href), plan };
  }

  async function captureOrder(orderId) {
    const id = String(orderId || "");
    if (!/^[A-Za-z0-9-]{6,64}$/.test(id))
      throw new Error("PAYPAL_ORDER_ID_INVALID");
    return request(
      `/v2/checkout/orders/${encodeURIComponent(id)}/capture`,
      {},
      `capture-${id}`,
    );
  }

  async function verifyWebhook({ headers, webhookId, event }) {
    if (!webhookId || !event) throw new Error("PAYPAL_WEBHOOK_NOT_CONFIGURED");
    const source = headers || {};
    const body = {
      auth_algo: source["paypal-auth-algo"],
      cert_url: source["paypal-cert-url"],
      transmission_id: source["paypal-transmission-id"],
      transmission_sig: source["paypal-transmission-sig"],
      transmission_time: source["paypal-transmission-time"],
      webhook_id: webhookId,
      webhook_event: event,
    };
    if (Object.values(body).some((value) => !value)) return false;

    const result = await request(
      "/v1/notifications/verify-webhook-signature",
      body,
    );
    return result.verification_status === "SUCCESS";
  }

  return {
    createOrder,
    captureOrder,
    getPlan,
    normalizePlan,
    isConfigured,
    verifyWebhook,
  };
}

module.exports = { createPayPalService };
