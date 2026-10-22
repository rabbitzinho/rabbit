// tests/integration/core.routes.test.js
// Testes de integração das rotas core (health + métricas internas).

const test = require("node:test");
const assert = require("node:assert/strict");

const { registerCoreRoutes } = require("../../src/dashboard/routes/core");
const { startApp, stopApp, passthrough } = require("./_helpers");

function buildCtx(overrides) {
  return Object.assign(
    {
      requireDashboardAuth: passthrough,
      requirePerm: () => passthrough,
      rateLimit: () => passthrough,
      recordAudit: async () => {},
      getActorFromRequest: () => ({ id: "test" }),
      configManager: {
        getPublicConfig: () => ({ ok: true }),
        getEditableSchema: () => ({}),
        applyPatch: () => ({ ok: true }),
      },
      status: {
        getStatus: () => ({
          discordReady: true,
          mongoConnected: true,
          gameNewsRunning: true,
          totalCommandsExecuted: 5,
          totalInfractionsCreated: 2,
          autoModActions: 1,
          antiSpamActions: 0,
        }),
      },
      metrics: {
        getMetrics: () => ({
          generatedAt: new Date().toISOString(),
          uptimeSeconds: 12,
          totals: { requests: 3, errors: 0, routes: 1 },
          routes: [],
        }),
        formatPrometheus: () => "rabbit_up 1\n",
      },
      getClient: () => null,
      Infraction: null,
      requireGuildAccess: () => passthrough,
      sanitizeId: (value) => String(value || ""),
    },
    overrides || {},
  );
}

test("GET /health reporta estado pronto", async () => {
  const app = await startApp(registerCoreRoutes, buildCtx());
  try {
    const res = await fetch(app.baseUrl + "/health");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.discordReady, true);
    assert.equal(body.mongoConnected, true);
    assert.equal(body.metrics.totalCommandsExecuted, 5);
  } finally {
    await stopApp(app.server);
  }
});

test("server administrators cannot request the global overview", async () => {
  const app = await startApp(
    registerCoreRoutes,
    buildCtx({
      requireDashboardAuth(req, res, next) {
        req.dashboardUser = {
          role: "GUILD_ADMIN",
          selectedGuildId: "111111111111111111",
          allowedGuildIds: ["111111111111111111"],
        };
        next();
      },
      requireGuildAccess: () => (req, res, next) => next(),
    }),
  );
  try {
    const response = await fetch(app.baseUrl + "/api/overview");
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "NO_GUILD_SELECTED");
  } finally {
    await stopApp(app.server);
  }
});

test("bot owner receives a global overview only without selecting a server", async () => {
  const app = await startApp(
    registerCoreRoutes,
    buildCtx({
      requireDashboardAuth(req, res, next) {
        req.dashboardUser = {
          role: "BOT_OWNER",
          selectedGuildId: null,
          profile: "UNSCOPED",
          guildScopeVersion: 2,
        };
        next();
      },
      getClient: () => ({ guilds: { cache: new Map() } }),
    }),
  );
  try {
    const response = await fetch(app.baseUrl + "/api/overview");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).scope, "global");
  } finally {
    await stopApp(app.server);
  }
});

test("server overview returns only the selected guild's counts and moderation actions", async () => {
  const guildId = "111111111111111111";
  let infractionQuery = null;
  const app = await startApp(
    registerCoreRoutes,
    buildCtx({
      requireDashboardAuth(req, res, next) {
        req.dashboardUser = {
          role: "GUILD_ADMIN",
          selectedGuildId: guildId,
          allowedGuildIds: [guildId],
        };
        next();
      },
      requireGuildAccess:
        ({ from, key }) =>
        (req, res, next) => {
          const requestedGuildId = from === "query" ? req.query[key] : null;
          if (
            requestedGuildId !== guildId ||
            req.dashboardUser.selectedGuildId !== requestedGuildId
          ) {
            return res
              .status(403)
              .json({ ok: false, error: "NO_GUILD_ACCESS" });
          }
          next();
        },
      getClient: () => ({
        guilds: {
          cache: new Map([
            [guildId, { memberCount: 23 }],
            ["222222222222222222", { memberCount: 91 }],
          ]),
        },
      }),
      Infraction: {
        countDocuments(query) {
          infractionQuery = query;
          return { exec: async () => 4 };
        },
      },
    }),
  );
  try {
    const response = await fetch(
      app.baseUrl + "/api/overview?guildId=" + guildId,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      scope: "guild",
      guilds: 1,
      users: 23,
      actions24h: 4,
    });
    assert.equal(infractionQuery.guildId, guildId);
    assert.ok(infractionQuery.createdAt.$gte instanceof Date);
  } finally {
    await stopApp(app.server);
  }
});

test("global config is unavailable to guild administrators", async () => {
  const app = await startApp(
    registerCoreRoutes,
    buildCtx({
      requireDashboardAuth(req, res, next) {
        req.dashboardUser = { role: "GUILD_ADMIN" };
        next();
      },
    }),
  );
  try {
    const response = await fetch(app.baseUrl + "/api/config");
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "BOT_OWNER_REQUIRED");

    const write = await fetch(app.baseUrl + "/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trust: { base: 10 } }),
    });
    assert.equal(write.status, 403);
    assert.equal((await write.json()).error, "BOT_OWNER_REQUIRED");
  } finally {
    await stopApp(app.server);
  }
});

test("a bot owner with a selected guild cannot read global config", async () => {
  const app = await startApp(
    registerCoreRoutes,
    buildCtx({
      requireDashboardAuth(req, res, next) {
        req.dashboardUser = {
          role: "BOT_OWNER",
          selectedGuildId: "111111111111111111",
          profile: "BOT_OWNER",
          guildScopeVersion: 2,
        };
        next();
      },
    }),
  );
  try {
    const response = await fetch(app.baseUrl + "/api/config");
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "BOT_OWNER_REQUIRED");
  } finally {
    await stopApp(app.server);
  }
});

test("only an unscoped bot owner can save global maintenance settings", async () => {
  const globalMaintenance = {
    enabled: true,
    message: "Scheduled maintenance",
    allowStaff: false,
  };
  let receivedPatch = null;
  const app = await startApp(
    registerCoreRoutes,
    buildCtx({
      requireDashboardAuth(req, res, next) {
        req.dashboardUser = {
          role: "BOT_OWNER",
          selectedGuildId: null,
          profile: "UNSCOPED",
          guildScopeVersion: 2,
        };
        next();
      },
      configManager: {
        getPublicConfig: () => ({ globalMaintenance }),
        getEditableSchema: () => ({}),
        applyPatch: (patch) => {
          receivedPatch = patch;
          return { ok: true, applied: ["globalMaintenance.enabled"] };
        },
      },
    }),
  );
  try {
    const response = await fetch(app.baseUrl + "/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ globalMaintenance }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(receivedPatch, { globalMaintenance });
  } finally {
    await stopApp(app.server);
  }
});

test("GET /api/internal/metrics sem token e sem admin devolve 401", async () => {
  const app = await startApp(registerCoreRoutes, buildCtx());
  try {
    const res = await fetch(app.baseUrl + "/api/internal/metrics");
    // sem METRICS_TOKEN o guard cai no requireDashboardAuth (pass-through aqui)
    // mas sem dashboardUser/role ADMIN -> 403.
    assert.ok(
      res.status === 401 || res.status === 403,
      "esperado 401/403, obtido " + res.status,
    );
  } finally {
    await stopApp(app.server);
  }
});

test("GET /api/internal/metrics aceita Authorization: Bearer (formato do Prometheus)", async () => {
  process.env.METRICS_TOKEN = "secret-token";
  const app = await startApp(registerCoreRoutes, buildCtx());
  try {
    const res = await fetch(
      app.baseUrl + "/api/internal/metrics?format=prometheus",
      {
        headers: { authorization: "Bearer secret-token" },
      },
    );
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/plain/);
    assert.equal(await res.text(), "rabbit_up 1\n");
  } finally {
    delete process.env.METRICS_TOKEN;
    await stopApp(app.server);
  }
});

test("GET /api/internal/metrics rejeita um Bearer inválido", async () => {
  process.env.METRICS_TOKEN = "secret-token";
  const app = await startApp(registerCoreRoutes, buildCtx());
  try {
    const res = await fetch(app.baseUrl + "/api/internal/metrics", {
      headers: { authorization: "Bearer wrong-token" },
    });
    assert.ok(
      res.status === 401 || res.status === 403,
      "esperado 401/403, obtido " + res.status,
    );
  } finally {
    delete process.env.METRICS_TOKEN;
    await stopApp(app.server);
  }
});
