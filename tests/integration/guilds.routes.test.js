const test = require("node:test");
const assert = require("node:assert/strict");
const { registerGuildsRoutes } = require("../../src/dashboard/routes/guilds");
const { startApp, stopApp, passthrough, sanitizeId } = require("./_helpers");

async function createApp(user) {
  return startApp(registerGuildsRoutes, {
    requireDashboardAuth(req, res, next) {
      req.dashboardUser = user;
      next();
    },
    requireGuildAccess: () => passthrough,
    getClient: () => ({ guilds: { cache: new Map() } }),
    sanitizeId,
  });
}

test("bot operators can keep an OAuth session without any eligible guilds", async () => {
  const app = await createApp({
    _id: "987654321098765432",
    role: "BOT_OWNER",
    oauth: true,
    allowedGuildIds: [],
    allowedGuilds: [],
  });
  try {
    const response = await fetch(app.baseUrl + "/api/guilds");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, items: [] });
  } finally {
    await stopApp(app.server);
  }
});

test("regular OAuth users without eligible guilds are still asked to re-authenticate", async () => {
  const app = await createApp({
    _id: "987654321098765432",
    role: "USER",
    oauth: true,
    allowedGuildIds: [],
    allowedGuilds: [],
  });
  try {
    const response = await fetch(app.baseUrl + "/api/guilds");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reason, "NO_ELIGIBLE_GUILDS");
  } finally {
    await stopApp(app.server);
  }
});

test("bot owner sees all installed guilds but only their own admin guild is manageable", async () => {
  const app = await startApp(registerGuildsRoutes, {
    requireDashboardAuth(req, res, next) {
      req.dashboardUser = {
        _id: "987654321098765432",
        role: "BOT_OWNER",
        oauth: true,
        selectedGuildId: null,
        allowedGuildIds: ["111111111111111111"],
        allowedGuilds: [
          {
            id: "111111111111111111",
            name: "Owned admin server",
            owner: true,
            permissions: "0",
            botPresent: true,
          },
        ],
        botGuildInventory: [
          { id: "111111111111111111", name: "Owned admin server" },
          { id: "222222222222222222", name: "Other server" },
        ],
      };
      next();
    },
    requireGuildAccess: () => passthrough,
    getClient: () => ({ guilds: { cache: new Map() } }),
    sanitizeId,
  });

  try {
    const response = await fetch(app.baseUrl + "/api/guilds");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(
      body.items.map((guild) => [guild.id, guild.manageable]),
      [
        ["111111111111111111", true],
        ["222222222222222222", false],
      ],
    );
  } finally {
    await stopApp(app.server);
  }
});
