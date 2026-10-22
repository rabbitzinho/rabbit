const express = require("express");
const test = require("node:test");
const assert = require("node:assert/strict");
const { registerAuthRoutes } = require("../../src/dashboard/routes/auth");
const {
  startApp,
  stopApp,
  passthrough,
  sanitizeId,
  sanitizeText,
} = require("./_helpers");

const OWNER_ID = "234567890123456789";
const ADMIN_GUILD_ID = "111111111111111111";
const OTHER_GUILD_ID = "222222222222222222";

async function createAuthApp(user, clientGuildIds = []) {
  const signedTokens = [];
  const app = await startApp(registerAuthRoutes, {
    express,
    requireDashboardAuth(req, res, next) {
      req.dashboardUser = user;
      next();
    },
    jwt: {
      sign(payload) {
        signedTokens.push(payload);
        return "signed-test-token";
      },
    },
    JWT_SECRET: "test-secret",
    sanitizeText,
    rateLimit: () => passthrough,
    ADMIN_PERMISSIONS: { canViewConfig: true, canEditConfig: true },
    getClient: () => ({
      guilds: { cache: new Map(clientGuildIds.map((id) => [id, { id }])) },
    }),
    sanitizeId,
  });
  return { ...app, signedTokens };
}

test("bot owner can return to the global token without selecting a guild", async () => {
  const previousOwnerIds = process.env.BOT_OWNER_IDS;
  process.env.BOT_OWNER_IDS = OWNER_ID;
  const app = await createAuthApp({
    _id: OWNER_ID,
    username: "owner",
    role: "BOT_OWNER",
    allowedGuildIds: [ADMIN_GUILD_ID],
    allowedGuilds: [
      {
        id: ADMIN_GUILD_ID,
        owner: true,
        permissions: "0",
        botPresent: true,
      },
    ],
    botGuildInventory: [{ id: OTHER_GUILD_ID, name: "Other server" }],
  });
  try {
    const response = await fetch(app.baseUrl + "/api/auth/global", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 200);
    assert.equal(app.signedTokens.length, 1);
    assert.equal(app.signedTokens[0].selectedGuildId, null);
    assert.equal(app.signedTokens[0].guildScopeVersion, 2);
    assert.deepEqual(app.signedTokens[0].allowedGuildIds, [ADMIN_GUILD_ID]);
    assert.deepEqual(app.signedTokens[0].botGuildInventory, [
      { id: OTHER_GUILD_ID, name: "Other server" },
    ]);
  } finally {
    await stopApp(app.server);
    if (previousOwnerIds === undefined) delete process.env.BOT_OWNER_IDS;
    else process.env.BOT_OWNER_IDS = previousOwnerIds;
  }
});

test("server administrator cannot request a global token", async () => {
  const app = await createAuthApp({
    _id: "345678901234567890",
    role: "GUILD_ADMIN",
  });
  try {
    const response = await fetch(app.baseUrl + "/api/auth/global", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "BOT_OWNER_REQUIRED");
    assert.equal(app.signedTokens.length, 0);
  } finally {
    await stopApp(app.server);
  }
});

test("bot owner cannot mint a server token without guild Administrator access", async () => {
  const previousOwnerIds = process.env.BOT_OWNER_IDS;
  process.env.BOT_OWNER_IDS = OWNER_ID;
  const app = await createAuthApp(
    {
      _id: OWNER_ID,
      username: "owner",
      role: "BOT_OWNER",
      selectedGuildId: null,
      allowedGuildIds: [OTHER_GUILD_ID],
      allowedGuilds: [
        {
          id: OTHER_GUILD_ID,
          owner: false,
          permissions: "0",
          botPresent: true,
        },
      ],
    },
    [OTHER_GUILD_ID],
  );
  try {
    const response = await fetch(app.baseUrl + "/api/auth/select-guild", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: OTHER_GUILD_ID }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "NO_GUILD_ACCESS");
    assert.equal(app.signedTokens.length, 0);
  } finally {
    await stopApp(app.server);
    if (previousOwnerIds === undefined) delete process.env.BOT_OWNER_IDS;
    else process.env.BOT_OWNER_IDS = previousOwnerIds;
  }
});

test("bot owner can scope to a server they own and keep guild access metadata", async () => {
  const previousOwnerIds = process.env.BOT_OWNER_IDS;
  process.env.BOT_OWNER_IDS = OWNER_ID;
  const app = await createAuthApp(
    {
      _id: OWNER_ID,
      username: "owner",
      role: "BOT_OWNER",
      selectedGuildId: null,
      allowedGuildIds: [ADMIN_GUILD_ID],
      allowedGuilds: [
        {
          id: ADMIN_GUILD_ID,
          owner: true,
          permissions: "0",
          botPresent: true,
        },
      ],
    },
    [ADMIN_GUILD_ID],
  );
  try {
    const response = await fetch(app.baseUrl + "/api/auth/select-guild", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: ADMIN_GUILD_ID }),
    });
    assert.equal(response.status, 200);
    const payload = app.signedTokens[0];
    assert.equal(payload.selectedGuildId, ADMIN_GUILD_ID);
    assert.equal(payload.guildScopeVersion, 2);
    assert.equal(payload.profile, "BOT_OWNER");
    assert.deepEqual(payload.allowedGuilds, [
      {
        id: ADMIN_GUILD_ID,
        owner: true,
        permissions: "0",
        botPresent: true,
      },
    ]);
  } finally {
    await stopApp(app.server);
    if (previousOwnerIds === undefined) delete process.env.BOT_OWNER_IDS;
    else process.env.BOT_OWNER_IDS = previousOwnerIds;
  }
});
