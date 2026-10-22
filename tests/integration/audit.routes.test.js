const test = require("node:test");
const assert = require("node:assert/strict");
const { registerAuditRoutes } = require("../../src/dashboard/routes/audit");
const { startApp, stopApp, passthrough, sanitizeId } = require("./_helpers");
const GUILD_ID = "123456789012345678";

test("audit route sorts by the stored timestamp and paginates results", async () => {
  const recorded = { query: null, sort: null, skip: null, limit: null };
  const auditModel = {
    countDocuments: async () => 1,
    find(query) {
      recorded.query = query;
      const chain = {
        sort(value) {
          recorded.sort = value;
          return chain;
        },
        skip(value) {
          recorded.skip = value;
          return chain;
        },
        limit(value) {
          recorded.limit = value;
          return chain;
        },
        lean: async () => [
          { at: "2026-10-20T12:00:00.000Z", action: "config.patch" },
        ],
      };
      return chain;
    },
    distinct: async () => ["config.patch"],
  };
  const app = await startApp(registerAuditRoutes, {
    requireDashboardAuth(req, res, next) {
      req.dashboardUser = { role: "GUILD_ADMIN", selectedGuildId: GUILD_ID };
      next();
    },
    requirePerm: () => passthrough,
    requireGuildAccess: () => passthrough,
    sanitizeId,
    DashboardAudit: auditModel,
  });

  try {
    const response = await fetch(
      app.baseUrl + "/api/audit?page=2&limit=50&guildId=123456789012345678",
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.items[0].at, "2026-10-20T12:00:00.000Z");
    assert.deepEqual(recorded.query, { guildId: "123456789012345678" });
    assert.deepEqual(recorded.sort, { at: -1 });
    assert.equal(recorded.skip, 50);
    assert.equal(recorded.limit, 50);
  } finally {
    await stopApp(app.server);
  }
});

test("audit route scopes requests without guildId to the selected guild", async () => {
  let query = null;
  const auditModel = {
    countDocuments: async (value) => {
      query = value;
      return 0;
    },
    find() {
      return {
        sort() {
          return this;
        },
        skip() {
          return this;
        },
        limit() {
          return this;
        },
        lean: async () => [],
      };
    },
    distinct: async () => [],
  };
  const app = await startApp(registerAuditRoutes, {
    requireDashboardAuth(req, res, next) {
      req.dashboardUser = {
        role: "GUILD_ADMIN",
        selectedGuildId: "123456789012345678",
      };
      next();
    },
    requirePerm: () => passthrough,
    requireGuildAccess: () => passthrough,
    sanitizeId,
    DashboardAudit: auditModel,
  });

  try {
    const response = await fetch(app.baseUrl + "/api/audit");
    assert.equal(response.status, 200);
    assert.deepEqual(query, { guildId: "123456789012345678" });
  } finally {
    await stopApp(app.server);
  }
});

test("audit route rejects an unscoped non-owner session", async () => {
  const app = await startApp(registerAuditRoutes, {
    requireDashboardAuth(req, res, next) {
      req.dashboardUser = { role: "GUILD_ADMIN", selectedGuildId: null };
      next();
    },
    requirePerm: () => passthrough,
    requireGuildAccess: () => passthrough,
    sanitizeId,
    DashboardAudit: { countDocuments: async () => 0 },
  });

  try {
    const response = await fetch(app.baseUrl + "/api/audit");
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "NO_GUILD_SELECTED");
  } finally {
    await stopApp(app.server);
  }
});

test("audit route never returns dashboard-wide records, even to the bot owner", async () => {
  const app = await startApp(registerAuditRoutes, {
    requireDashboardAuth(req, res, next) {
      req.dashboardUser = { role: "BOT_OWNER", selectedGuildId: null };
      next();
    },
    requirePerm: () => passthrough,
    requireGuildAccess: () => passthrough,
    sanitizeId,
    DashboardAudit: { countDocuments: async () => 0 },
  });

  try {
    const response = await fetch(app.baseUrl + "/api/audit");
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "NO_GUILD_SELECTED");
  } finally {
    await stopApp(app.server);
  }
});
