const test = require("node:test");
const assert = require("node:assert/strict");
const { registerConfigRoutes } = require("../../src/dashboard/routes/config");
const { startApp, stopApp, passthrough, sanitizeId } = require("./_helpers");

const GUILD_ID = "123456789012345678";

function createConfigApp(user) {
  let maintenanceMode = { enabled: false, message: null, allowStaff: true };
  const serverConfig = {
    language: "auto",
    timezone: null,
    staffRoleIds: [],
    staffRolesByFeature: {},
  };
  return startApp(registerConfigRoutes, {
    requireDashboardAuth(req, res, next) {
      req.dashboardUser = user;
      next();
    },
    requirePerm: () => passthrough,
    requireGuildAccess: () => passthrough,
    rateLimit: () => passthrough,
    sanitizeId,
    GuildConfig: {
      findOne() {
        return {
          select() {
            return this;
          },
          lean: async () => ({
            guildId: GUILD_ID,
            maintenanceMode,
            ...serverConfig,
          }),
        };
      },
      findOneAndUpdate(filter, update) {
        if (update.$set.maintenanceMode)
          maintenanceMode = update.$set.maintenanceMode;
        Object.assign(serverConfig, update.$set);
        return {
          lean: async () => ({ guildId: filter.guildId, ...update.$set }),
        };
      },
    },
    GuildConfigSchema: {
      safeParse: (value) => ({
        success: !Object.prototype.hasOwnProperty.call(
          value,
          "maintenanceMode",
        ),
      }),
    },
    resolveGuildTrustConfig: async () => ({ enabled: true, base: 50 }),
    config: { trust: {} },
  });
}

test("guild administrators cannot manage per-server maintenance mode", async () => {
  const app = await createConfigApp({ role: "GUILD_ADMIN" });
  try {
    const response = await fetch(
      app.baseUrl + "/api/guilds/" + GUILD_ID + "/maintenance",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maintenanceMode: { enabled: true } }),
      },
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "BOT_OWNER_REQUIRED");
  } finally {
    await stopApp(app.server);
  }
});

test("guild configuration stores server locale and feature-specific staff roles", async () => {
  const app = await createConfigApp({ role: "GUILD_ADMIN" });
  try {
    const response = await fetch(
      app.baseUrl + "/api/guilds/" + GUILD_ID + "/config",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: "en",
          timezone: "Europe/Lisbon",
          staffRoleIds: ["111111111111111111"],
          staffRolesByFeature: {
            moderation: ["222222222222222222"],
            tickets: [],
            logs: [],
            gamenews: [],
            config: [],
          },
        }),
      },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.config.language, "en");
    assert.deepEqual(body.config.staffRolesByFeature.moderation, [
      "222222222222222222",
    ]);
  } finally {
    await stopApp(app.server);
  }
});

test("bot owner can read and save maintenance mode for the selected guild", async () => {
  const app = await createConfigApp({ role: "BOT_OWNER" });
  try {
    const save = await fetch(
      app.baseUrl + "/api/guilds/" + GUILD_ID + "/maintenance",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maintenanceMode: {
            enabled: true,
            message: "Deploying",
            allowStaff: false,
          },
        }),
      },
    );
    assert.equal(save.status, 200);
    assert.deepEqual((await save.json()).maintenanceMode, {
      enabled: true,
      message: "Deploying",
      allowStaff: false,
    });

    const read = await fetch(
      app.baseUrl + "/api/guilds/" + GUILD_ID + "/maintenance",
    );
    assert.equal(read.status, 200);
    assert.deepEqual((await read.json()).maintenanceMode, {
      enabled: true,
      message: "Deploying",
      allowStaff: false,
    });
  } finally {
    await stopApp(app.server);
  }
});
