const test = require("node:test");
const assert = require("node:assert/strict");
const { registerTrustRoutes } = require("../../src/dashboard/routes/trust");
const { startApp, stopApp, passthrough } = require("./_helpers");

const GUILD_ID = "123456789012345678";
const OTHER_GUILD_ID = "222222222222222222";

function createTrustApp(options = {}) {
  const saved = new Map();
  let auditEntry = null;
  const baseConfig = {
    enabled: true,
    base: 50,
    min: 0,
    max: 100,
    lowThreshold: 25,
    highThreshold: 75,
  };
  const appPromise = startApp(registerTrustRoutes, {
    requireDashboardAuth(req, res, next) {
      req.dashboardUser = {
        username: "guild-admin",
        role: "GUILD_ADMIN",
        selectedGuildId: GUILD_ID,
      };
      next();
    },
    requirePerm: () => passthrough,
    requireGuildAccess:
      ({ from }) =>
      (req, res, next) => {
        const requested =
          from === "params" ? req.params.guildId : req.query.guildId;
        if (requested !== GUILD_ID)
          return res.status(403).json({ ok: false, error: "NO_GUILD_ACCESS" });
        next();
      },
    requirePremium: () => (req, res, next) => {
      if (options.premiumActive === false)
        return res.status(402).json({ ok: false, error: "PREMIUM_REQUIRED" });
      next();
    },
    GuildConfig: {
      findOneAndUpdate: (filter, update) => ({
        lean: async () => {
          saved.set(filter.guildId, update.$set.trustOverrides);
          return { guildId: filter.guildId };
        },
      }),
    },
    resolveGuildTrustConfig: async (guildId) =>
      Object.assign({}, baseConfig, saved.get(guildId) || {}),
    recordAudit: async (entry) => {
      auditEntry = entry;
    },
    getActorFromRequest: (req) => req.dashboardUser.username,
    UserModel: {
      countDocuments: async () => 0,
    },
    getTrustLabel: () => "medium",
  });
  return { appPromise, saved, getAuditEntry: () => auditEntry };
}

test("Trust overrides save and read only inside the selected licensed guild", async () => {
  const harness = createTrustApp();
  const app = await harness.appPromise;
  try {
    const update = await fetch(
      app.baseUrl + "/api/guilds/" + GUILD_ID + "/trust-config",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trustOverrides: { base: 42, lowThreshold: 20, highThreshold: 80 },
        }),
      },
    );
    assert.equal(update.status, 200);
    assert.equal((await update.json()).trust.base, 42);
    assert.deepEqual(harness.saved.get(GUILD_ID), {
      base: 42,
      lowThreshold: 20,
      highThreshold: 80,
    });
    assert.equal(harness.getAuditEntry().guildId, GUILD_ID);

    const otherGuild = await fetch(
      app.baseUrl + "/api/guilds/" + OTHER_GUILD_ID + "/trust-config",
    );
    assert.equal(otherGuild.status, 403);
  } finally {
    await stopApp(app.server);
  }
});

test("Trust overrides reject malformed values and require an active Premium license", async () => {
  const validationHarness = createTrustApp();
  const validationApp = await validationHarness.appPromise;
  try {
    const invalid = await fetch(
      validationApp.baseUrl + "/api/guilds/" + GUILD_ID + "/trust-config",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trustOverrides: { base: 500 } }),
      },
    );
    assert.equal(invalid.status, 400);
  } finally {
    await stopApp(validationApp.server);
  }

  const lockedHarness = createTrustApp({ premiumActive: false });
  const lockedApp = await lockedHarness.appPromise;
  try {
    const locked = await fetch(
      lockedApp.baseUrl + "/api/guilds/" + GUILD_ID + "/trust-config",
    );
    assert.equal(locked.status, 402);
    assert.equal((await locked.json()).error, "PREMIUM_REQUIRED");
  } finally {
    await stopApp(lockedApp.server);
  }
});
