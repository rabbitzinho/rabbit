const express = require("express");
const test = require("node:test");
const assert = require("node:assert/strict");
const { registerModRoutes } = require("../../src/dashboard/routes/mod");
const {
  ModBanSchema,
  ModUnbanSchema,
  ModMuteSchema,
  ModUnmuteSchema,
  ModWarnSchema,
} = require("../../src/dashboard/schemas");
const {
  startApp,
  stopApp,
  passthrough,
  sanitizeId,
  sanitizeText,
} = require("./_helpers");

const GUILD_ID = "111111111111111111";
const USER_ID = "222222222222222222";

async function createApp(executeMemberAction = async () => ({}), options = {}) {
  const actions = [];
  const unbanActions = [];
  const audits = [];
  const app = await startApp(registerModRoutes, {
    express,
    requireDashboardAuth(req, res, next) {
      req.dashboardUser = { _id: "333333333333333333" };
      next();
    },
    requirePerm: () => passthrough,
    requireGuildAccess: () => passthrough,
    rateLimit: () => passthrough,
    sanitizeId,
    sanitizeText,
    getActorFromRequest: () => "dashboard moderator",
    async recordAudit(entry) {
      audits.push(entry);
    },
    ModWarnSchema,
    ModBanSchema,
    ModUnbanSchema,
    ModMuteSchema,
    ModUnmuteSchema,
    parseDuration: options.parseDuration || (() => null),
    formatDuration: () => "1m",
    config: {},
    dashboardWarn: async () => ({}),
    executeMemberAction: async (params) => {
      actions.push(params);
      return executeMemberAction(params);
    },
    executeUnbanAction: async (params) => {
      unbanActions.push(params);
      return options.executeUnbanAction
        ? options.executeUnbanAction(params)
        : { infraction: { caseId: 42 } };
    },
    resolveGuildMember: async () => ({}),
    mongoose: {},
    logger: async () => {},
    warningsService: {},
    infractionsService: {},
    _getClient: () => ({}),
    _getModels: () => ({}),
  });
  return { ...app, actions, audits, unbanActions };
}

test("dashboard ban parses and returns a temporary expiration", async () => {
  const expiresAt = new Date("2026-10-22T00:00:00.000Z");
  const app = await createApp(
    async () => ({ infraction: { caseId: 43 }, expiresAt }),
    { parseDuration: (value) => (value === "1d" ? 86_400_000 : null) },
  );
  try {
    const response = await fetch(`${app.baseUrl}/api/mod/ban`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: GUILD_ID,
        userId: USER_ID,
        duration: "1d",
        reason: "Temporary ban",
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      caseId: 43,
      expiresAt: expiresAt.toISOString(),
    });
    assert.equal(app.actions[0].durationMs, 86_400_000);
  } finally {
    await stopApp(app.server);
  }
});

test("dashboard rejects an invalid temporary ban duration before the action", async () => {
  const app = await createApp(async () => ({ ok: true }));
  try {
    const response = await fetch(`${app.baseUrl}/api/mod/ban`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: GUILD_ID,
        userId: USER_ID,
        duration: "invalid",
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(app.actions.length, 0);
  } finally {
    await stopApp(app.server);
  }
});

test("dashboard treats an empty ban duration as permanent", async () => {
  const app = await createApp(async () => ({ infraction: { caseId: 45 } }));
  try {
    const response = await fetch(`${app.baseUrl}/api/mod/ban`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: GUILD_ID,
        userId: USER_ID,
        duration: "",
      }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).caseId, 45);
    assert.equal(app.actions[0].durationMs, null);
  } finally {
    await stopApp(app.server);
  }
});

test("dashboard unban records the action and audit entry", async () => {
  const app = await createApp(undefined, {
    executeUnbanAction: async () => ({ infraction: { caseId: 44 } }),
  });
  try {
    const response = await fetch(`${app.baseUrl}/api/mod/unban`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: GUILD_ID, userId: USER_ID }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, caseId: 44 });
    assert.equal(app.unbanActions[0].userId, USER_ID);
    assert.equal(app.unbanActions[0].source, "dashboard");
    assert.equal(app.audits[0].action, "mod.unban");
  } finally {
    await stopApp(app.server);
  }
});

for (const action of ["kick", "ban"]) {
  test(`dashboard ${action} records the scoped action and case`, async () => {
    const app = await createApp(async () => ({ infraction: { caseId: 42 } }));
    try {
      const response = await fetch(`${app.baseUrl}/api/mod/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId: GUILD_ID,
          userId: USER_ID,
          reason: "Repeated harassment",
        }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, caseId: 42 });
      assert.equal(app.actions.length, 1);
      assert.equal(app.actions[0].action, action.toUpperCase());
      assert.equal(app.actions[0].source, "dashboard");
      assert.equal(app.actions[0].executorId, "333333333333333333");
      assert.equal(app.audits[0].action, `mod.${action}`);
    } finally {
      await stopApp(app.server);
    }
  });
}
