const test = require("node:test");
const assert = require("node:assert/strict");
const { registerPremiumRoutes } = require("../../src/dashboard/routes/premium");
const { startApp, stopApp, passthrough, sanitizeId } = require("./_helpers");

const GUILD_ID = "123456789012345678";
const USER_ID = "987654321098765432";

function makeHarness(options) {
  const settings = options || {};
  let currentUser = {
    _id: USER_ID,
    username: "guild-admin",
    role: "GUILD_ADMIN",
  };
  let guildConfig = {
    guildId: GUILD_ID,
    premium: settings.guildPremium || { enabled: false },
  };
  let premiumSettings = null;
  const payments = [];
  let sequence = 0;

  function chain(value) {
    let resultValue = value;
    const result = {
      select() {
        return result;
      },
      sort() {
        if (Array.isArray(resultValue)) {
          resultValue = resultValue
            .slice()
            .sort(
              (left, right) =>
                new Date(right.createdAt || right.completedAt || 0) -
                new Date(left.createdAt || left.completedAt || 0),
            );
        }
        return result;
      },
      skip(count) {
        if (Array.isArray(resultValue)) resultValue = resultValue.slice(count);
        return result;
      },
      limit(count) {
        if (Array.isArray(resultValue))
          resultValue = resultValue.slice(0, count);
        return result;
      },
      lean() {
        return Promise.resolve(resultValue);
      },
    };
    return result;
  }

  const GuildConfig = {
    findOne(query) {
      return chain(
        query && query.guildId === guildConfig.guildId ? guildConfig : null,
      );
    },
    find(query) {
      if (!query || Object.keys(query).length === 0)
        return chain([guildConfig]);
      const includeEnabled = query["premium.enabled"] === true;
      return chain(
        includeEnabled && guildConfig.premium.enabled ? [guildConfig] : [],
      );
    },
    findOneAndUpdate(query, update) {
      if (!guildConfig || guildConfig.guildId !== query.guildId) {
        guildConfig = { guildId: query.guildId, premium: { enabled: false } };
      }
      Object.entries(update.$set).forEach(([key, value]) => {
        if (key === "premium") guildConfig.premium = value;
        else if (key.startsWith("premium."))
          guildConfig.premium[key.slice("premium.".length)] = value;
      });
      return chain(guildConfig);
    },
  };

  const PremiumPayment = {
    async create(data) {
      const payment = Object.assign({ _id: "payment-" + ++sequence }, data);
      payments.push(payment);
      return payment;
    },
    findOne(query) {
      return chain(
        payments.find((item) =>
          Object.entries(query).every(([key, value]) => item[key] === value),
        ) || null,
      );
    },
    findById(id) {
      return chain(payments.find((item) => item._id === id) || null);
    },
    findOneAndUpdate(query, update) {
      const payment = payments.find(
        (item) => item._id === query._id && item.status === query.status,
      );
      if (payment) Object.assign(payment, update.$set);
      return chain(payment ? Object.assign({}, payment) : null);
    },
    async updateOne(query, update) {
      const payment = payments.find(
        (item) =>
          item._id === query._id || item.paypalOrderId === query.paypalOrderId,
      );
      if (payment) Object.assign(payment, update.$set);
    },
    find(query) {
      return chain(
        payments.filter(
          (item) => !query || !query.status || item.status === query.status,
        ),
      );
    },
    countDocuments(query) {
      return Promise.resolve(
        payments.filter(
          (item) => !query || !query.status || item.status === query.status,
        ).length,
      );
    },
  };

  const PremiumSettings = {
    findById() {
      return chain(premiumSettings);
    },
    findOneAndUpdate(query, update) {
      premiumSettings = Object.assign({}, premiumSettings || {}, update.$set, {
        _id: query._id,
      });
      return chain(premiumSettings);
    },
  };

  const paypal = {
    isConfigured: () => settings.paypalConfigured !== false,
    getPlan: () => ({ amount: "6.50", currency: "EUR", durationDays: 30 }),
    normalizePlan: (plan) => ({
      amount: Number(plan.amount).toFixed(2),
      currency: String(plan.currency).toUpperCase(),
      durationDays: Number(plan.durationDays),
    }),
    createOrder: async (options) => ({
      id: "ORDER-123456",
      approvalUrl:
        "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-123456",
      plan: options.plan || {
        amount: "6.50",
        currency: "EUR",
        durationDays: 30,
      },
    }),
    captureOrder: async () => ({
      id: "ORDER-123456",
      status: "COMPLETED",
      payer: { payer_id: "PAYER-123", email_address: "payer@example.com" },
      purchase_units: [
        {
          custom_id: settings.captureUserId || USER_ID,
          reference_id: settings.captureGuildId || GUILD_ID,
          payments: {
            captures: [
              {
                id: "CAPTURE-123",
                status: "COMPLETED",
                amount: {
                  value: settings.captureAmount || "10.00",
                  currency_code: "EUR",
                },
              },
            ],
          },
        },
      ],
    }),
    verifyWebhook: async () => true,
  };
  const ownerUser = {
    id: "111111111111111111",
    username: "server-owner",
    globalName: "Server Owner",
  };
  const guild = {
    id: GUILD_ID,
    name: "Rabbit Guild",
    ownerId: ownerUser.id,
    members: {
      cache: new Map([[ownerUser.id, { user: ownerUser }]]),
      fetch: async () => ({ user: ownerUser }),
    },
  };
  const client = {
    guilds: { cache: new Map([[GUILD_ID, guild]]) },
    users: { cache: new Map([[ownerUser.id, ownerUser]]) },
  };

  const appPromise = startApp(registerPremiumRoutes, {
    requireDashboardAuth(req, res, next) {
      req.dashboardUser = currentUser;
      next();
    },
    requirePerm: () => passthrough,
    requireGuildAccess: () => passthrough,
    sanitizeId,
    GuildConfig,
    PremiumPayment,
    PremiumSettings,
    getClient: () => client,
    config: { dashboard: { allowedOrigins: ["https://dashboard.example"] } },
    paypal,
  });

  return {
    appPromise,
    payments,
    getSettings: () => premiumSettings,
    getGuildConfig: () => guildConfig,
    setUser(user) {
      currentUser =
        user && user.role === "BOT_OWNER" && user.selectedGuildId === undefined
          ? Object.assign(
              {
                profile: "UNSCOPED",
                selectedGuildId: null,
                guildScopeVersion: 2,
              },
              user,
            )
          : user;
    },
  };
}

test("Premium checkout creates a pending PayPal order and verified capture activates its guild", async () => {
  const harness = makeHarness();
  const app = await harness.appPromise;
  try {
    const checkout = await fetch(app.baseUrl + "/api/premium/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: GUILD_ID }),
    });
    assert.equal(checkout.status, 200);
    const checkoutBody = await checkout.json();
    assert.equal(
      checkoutBody.approvalUrl,
      "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-123456",
    );
    assert.equal(harness.payments[0].status, "PENDING");
    assert.equal(harness.payments[0].purchaserDiscordUserId, USER_ID);
    assert.equal(harness.payments[0].discordUserId, undefined);

    const returned = await fetch(
      app.baseUrl + "/api/premium/paypal/return?token=ORDER-123456",
      { redirect: "manual" },
    );
    assert.equal(returned.status, 302);
    assert.match(returned.headers.get("location"), /premiumPayment=success/);
    assert.equal(harness.getGuildConfig().premium.enabled, true);
    assert.equal(harness.getGuildConfig().premium.purchasedByUserId, USER_ID);
    assert.equal(harness.payments[0].status, "COMPLETED");
    assert.equal(harness.payments[0].paypalPayerEmail, "payer@example.com");

    const status = await fetch(
      app.baseUrl + "/api/premium?guildId=" + GUILD_ID,
    );
    const statusBody = await status.json();
    assert.equal(statusBody.server.name, "Rabbit Guild");
    assert.equal(statusBody.server.ownerId, "111111111111111111");
    assert.equal(statusBody.server.ownerName, "Server Owner");
    assert.equal(statusBody.server.purchaserDiscordUserId, USER_ID);
    assert.equal(statusBody.server.purchaserDiscordUsername, "guild-admin");
  } finally {
    await stopApp(app.server);
  }
});

test("Premium status reads never create temporary server licenses", async () => {
  const harness = makeHarness();
  const app = await harness.appPromise;
  harness.setUser({ _id: USER_ID, username: "bot-owner", role: "BOT_OWNER" });
  try {
    const response = await fetch(
      app.baseUrl + "/api/premium?guildId=" + GUILD_ID,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.premium.active, false);
    assert.equal(body.premium.effectiveActive, false);
    assert.equal(harness.getGuildConfig().premium.enabled, false);
    assert.equal(harness.getGuildConfig().premium.testBypass, undefined);
  } finally {
    await stopApp(app.server);
  }
});

test("legacy operator test-bypass records are shown as inactive licenses", async () => {
  const harness = makeHarness({
    guildPremium: {
      enabled: true,
      until: new Date(Date.now() + 15 * 60 * 1000),
      testBypass: true,
    },
  });
  const app = await harness.appPromise;
  harness.setUser({ _id: USER_ID, username: "bot-owner", role: "BOT_OWNER" });
  try {
    const response = await fetch(app.baseUrl + "/api/premium/admin/guilds");
    assert.equal(response.status, 200);
    const item = (await response.json()).items.find(
      (entry) => entry.guildId === GUILD_ID,
    );
    assert.equal(item.enabled, false);
    assert.equal(item.active, false);
  } finally {
    await stopApp(app.server);
  }
});

test("Premium payment history is visible only to the bot owner", async () => {
  const harness = makeHarness();
  const app = await harness.appPromise;
  try {
    const denied = await fetch(app.baseUrl + "/api/premium/payments");
    assert.equal(denied.status, 403);

    harness.setUser({ _id: USER_ID, username: "bot-admin", role: "BOT_ADMIN" });
    const stillDenied = await fetch(app.baseUrl + "/api/premium/payments");
    assert.equal(stillDenied.status, 403);

    harness.setUser({
      _id: USER_ID,
      username: "bot-owner",
      role: "BOT_OWNER",
      selectedGuildId: GUILD_ID,
      profile: "BOT_OWNER",
      guildScopeVersion: 2,
    });
    const scopedOwnerDenied = await fetch(
      app.baseUrl + "/api/premium/payments",
    );
    assert.equal(scopedOwnerDenied.status, 403);

    harness.setUser({ _id: USER_ID, username: "bot-owner", role: "BOT_OWNER" });
    const allowed = await fetch(app.baseUrl + "/api/premium/payments");
    assert.equal(allowed.status, 200);
    assert.deepEqual((await allowed.json()).items, []);
  } finally {
    await stopApp(app.server);
  }
});

test("bot owner can page and filter the full Premium payment history", async () => {
  const harness = makeHarness();
  const app = await harness.appPromise;
  const now = new Date();
  harness.payments.push(
    {
      guildId: GUILD_ID,
      status: "COMPLETED",
      purchaserDiscordUsername: "payer",
      amount: "6.50",
      currency: "EUR",
      createdAt: now,
      completedAt: now,
    },
    {
      guildId: GUILD_ID,
      status: "FAILED",
      purchaserDiscordUsername: "failed-payer",
      amount: "6.50",
      currency: "EUR",
      createdAt: new Date(now.getTime() - 1000),
    },
  );
  harness.setUser({ _id: USER_ID, username: "bot-owner", role: "BOT_OWNER" });
  try {
    const allPayments = await fetch(
      app.baseUrl + "/api/premium/payments?page=1&pageSize=1&status=ALL",
    );
    assert.equal(allPayments.status, 200);
    const allBody = await allPayments.json();
    assert.equal(allBody.total, 2);
    assert.equal(allBody.pages, 2);
    assert.equal(allBody.items.length, 1);
    assert.equal(allBody.items[0].status, "COMPLETED");
    assert.equal(allBody.items[0].guildName, "Rabbit Guild");

    const failedPayments = await fetch(
      app.baseUrl + "/api/premium/payments?status=FAILED",
    );
    assert.equal(failedPayments.status, 200);
    const failedBody = await failedPayments.json();
    assert.equal(failedBody.total, 1);
    assert.equal(failedBody.items[0].purchaserDiscordUsername, "failed-payer");

    const invalidStatus = await fetch(
      app.baseUrl + "/api/premium/payments?status=INVALID",
    );
    assert.equal(invalidStatus.status, 400);
  } finally {
    await stopApp(app.server);
  }
});

test("only the bot owner can manage global and per-server Premium licenses", async () => {
  const harness = makeHarness();
  const app = await harness.appPromise;
  harness.setUser({ _id: USER_ID, username: "bot-admin", role: "BOT_ADMIN" });
  try {
    const settingsDenied = await fetch(
      app.baseUrl + "/api/premium/admin/settings",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: "9.99",
          currency: "USD",
          durationDays: 60,
          paymentLink: "https://paypal.me/example",
        }),
      },
    );
    assert.equal(settingsDenied.status, 403);

    const settingsReadDenied = await fetch(
      app.baseUrl + "/api/premium/admin/settings",
    );
    assert.equal(settingsReadDenied.status, 403);

    const grant = await fetch(
      app.baseUrl + "/api/premium/admin/guilds/" + GUILD_ID,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          until: null,
          note: "manual test",
        }),
      },
    );
    assert.equal(grant.status, 403);
    const guilds = await fetch(app.baseUrl + "/api/premium/admin/guilds");
    assert.equal(guilds.status, 403);

    const revoke = await fetch(
      app.baseUrl + "/api/premium/admin/guilds/" + GUILD_ID,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false, until: null, note: "revoked" }),
      },
    );
    assert.equal(revoke.status, 403);
    const revokedGuilds = await fetch(
      app.baseUrl + "/api/premium/admin/guilds",
    );
    assert.equal(revokedGuilds.status, 403);

    harness.setUser({ _id: USER_ID, username: "bot-owner", role: "BOT_OWNER" });
    const settings = await fetch(app.baseUrl + "/api/premium/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: "9.99",
        currency: "USD",
        durationDays: 60,
        paymentLink: "https://paypal.me/example",
      }),
    });
    assert.equal(settings.status, 200);
    assert.equal(harness.getSettings().amount, "10.00");
    assert.equal(harness.getSettings().currency, "EUR");

    harness.setUser({
      _id: USER_ID,
      username: "test-user",
      role: "GUILD_ADMIN",
    });
    const publicStatus = await fetch(
      app.baseUrl + "/api/premium?guildId=" + GUILD_ID,
    );
    const publicBody = await publicStatus.json();
    assert.equal(publicStatus.status, 200);
    assert.equal(publicBody.payment.amount, "10.00");
    assert.equal(publicBody.payment.currency, "EUR");
    assert.equal(publicBody.payment.durationDays, 60);
    assert.equal(publicBody.payment.checkoutAvailable, true);
    assert.equal(publicBody.payment.referenceLinkAvailable, true);
    assert.equal(
      publicBody.payment.paymentLink,
      "https://paypal.me/example/10EUR",
    );

    const checkout = await fetch(app.baseUrl + "/api/premium/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: GUILD_ID }),
    });
    assert.equal(checkout.status, 200);
    assert.equal(harness.payments[harness.payments.length - 1].amount, "10.00");
    assert.equal(
      harness.payments[harness.payments.length - 1].durationDays,
      60,
    );
  } finally {
    await stopApp(app.server);
  }
});

test("a configured PayPal reference link is available when API checkout credentials are absent", async () => {
  const harness = makeHarness({ paypalConfigured: false });
  const app = await harness.appPromise;
  harness.setUser({ _id: USER_ID, username: "bot-owner", role: "BOT_OWNER" });
  try {
    const settings = await fetch(app.baseUrl + "/api/premium/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: "9.99",
        currency: "EUR",
        durationDays: 30,
        paymentLink: "https://paypal.me/example",
      }),
    });
    assert.equal(settings.status, 200);

    harness.setUser({
      _id: USER_ID,
      username: "guild-admin",
      role: "GUILD_ADMIN",
    });
    const response = await fetch(
      app.baseUrl + "/api/premium?guildId=" + GUILD_ID,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.payment.available, true);
    assert.equal(body.payment.checkoutAvailable, false);
    assert.equal(body.payment.referenceLinkAvailable, true);
    assert.equal(body.payment.paymentLink, "https://paypal.me/example/10EUR");
  } finally {
    await stopApp(app.server);
  }
});

test("a guild license applies to everyone in that guild, not to the payer on another guild", async () => {
  const harness = makeHarness();
  const app = await harness.appPromise;
  try {
    harness.setUser({ _id: USER_ID, username: "bot-owner", role: "BOT_OWNER" });
    const grant = await fetch(
      app.baseUrl + "/api/premium/admin/guilds/" + GUILD_ID,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, until: null, note: "paid" }),
      },
    );
    assert.equal(grant.status, 200);

    harness.setUser({
      _id: "111111111111111111",
      username: "other-admin",
      role: "GUILD_ADMIN",
    });
    const guildResponse = await fetch(
      app.baseUrl + "/api/premium?guildId=" + GUILD_ID,
    );
    assert.equal((await guildResponse.json()).premium.active, true);
    const otherGuildResponse = await fetch(
      app.baseUrl + "/api/premium?guildId=222222222222222222",
    );
    assert.equal((await otherGuildResponse.json()).premium.active, false);
  } finally {
    await stopApp(app.server);
  }
});

test("Premium is not activated when the captured amount differs from the order", async () => {
  const harness = makeHarness({ captureAmount: "1.00" });
  const app = await harness.appPromise;
  try {
    await fetch(app.baseUrl + "/api/premium/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: GUILD_ID }),
    });
    const returned = await fetch(
      app.baseUrl + "/api/premium/paypal/return?token=ORDER-123456",
      { redirect: "manual" },
    );
    assert.match(returned.headers.get("location"), /premiumPayment=error/);
    assert.equal(harness.getGuildConfig().premium.enabled, false);
    assert.equal(harness.payments[0].status, "FAILED");
  } finally {
    await stopApp(app.server);
  }
});

test("Premium is not activated when the capture buyer does not match the checkout buyer", async () => {
  const harness = makeHarness({ captureUserId: "111111111111111111" });
  const app = await harness.appPromise;
  try {
    await fetch(app.baseUrl + "/api/premium/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: GUILD_ID }),
    });
    const returned = await fetch(
      app.baseUrl + "/api/premium/paypal/return?token=ORDER-123456",
      { redirect: "manual" },
    );
    assert.match(returned.headers.get("location"), /premiumPayment=error/);
    assert.equal(harness.getGuildConfig().premium.enabled, false);
    assert.equal(harness.payments[0].status, "FAILED");
  } finally {
    await stopApp(app.server);
  }
});

test("A verified PayPal capture webhook activates Premium without a browser return", async () => {
  const harness = makeHarness();
  const app = await harness.appPromise;
  try {
    await fetch(app.baseUrl + "/api/premium/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: GUILD_ID }),
    });
    process.env.PAYPAL_WEBHOOK_ID = "test-webhook-id";
    const webhook = await fetch(app.baseUrl + "/api/premium/paypal/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          id: "CAPTURE-123",
          status: "COMPLETED",
          amount: { value: "10.00", currency_code: "EUR" },
          custom_id: USER_ID,
          payer: { payer_id: "PAYER-123", email_address: "payer@example.com" },
          supplementary_data: { related_ids: { order_id: "ORDER-123456" } },
        },
      }),
    });
    assert.equal(webhook.status, 200);
    assert.equal(harness.getGuildConfig().premium.enabled, true);
    assert.equal(harness.payments[0].status, "COMPLETED");
  } finally {
    delete process.env.PAYPAL_WEBHOOK_ID;
    await stopApp(app.server);
  }
});
