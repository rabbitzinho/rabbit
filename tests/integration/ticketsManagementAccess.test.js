const test = require("node:test");
const assert = require("node:assert/strict");
const { registerTicketsRoutes } = require("../../src/dashboard/routes/tickets");

test("ticket management routes do not require a Premium license", () => {
  const routes = new Map();
  const premiumGuard = function premiumGuard() {};
  const passThrough = function passThrough(req, res, next) {
    if (next) next();
  };
  const app = {
    get(path, ...handlers) {
      routes.set("GET " + path, handlers);
    },
    post(path, ...handlers) {
      routes.set("POST " + path, handlers);
    },
  };

  registerTicketsRoutes({
    app,
    requireDashboardAuth: passThrough,
    requirePerm: () => passThrough,
    requireGuildAccess: () => passThrough,
    requirePremium: () => premiumGuard,
    rateLimit: () => passThrough,
    sanitizeText: (value) => value,
    getActorFromRequest: () => "test",
    recordAudit: async () => {},
    _getClient: () => null,
    _getModels: () => ({}),
  });

  const managementRoutes = [
    "GET /api/tickets/assignees",
    "GET /api/tickets",
    "POST /api/tickets/:ticketId/manage",
    "GET /api/tickets/:ticketId/audit",
    "GET /api/tickets/:ticketId/messages",
    "POST /api/tickets/:ticketId/close",
    "POST /api/tickets/:ticketId/reopen",
    "POST /api/tickets/:ticketId/reply",
  ];

  for (const route of managementRoutes) {
    assert.ok(routes.has(route), `expected route ${route} to be registered`);
    assert.ok(
      !routes.get(route).includes(premiumGuard),
      `${route} must not use the Premium guard`,
    );
  }
});

test("ticket list applies priority and assignee filters before pagination", async () => {
  const routes = new Map();
  const passThrough = (req, res, next) => next();
  let capturedQuery;
  const app = {
    get(path, ...handlers) {
      routes.set("GET " + path, handlers);
    },
    post(path, ...handlers) {
      routes.set("POST " + path, handlers);
    },
  };
  registerTicketsRoutes({
    app,
    requireDashboardAuth: passThrough,
    requirePerm: () => passThrough,
    requireGuildAccess: () => passThrough,
    rateLimit: () => passThrough,
    _getModels: () => ({
      TicketModel: {
        find(query) {
          capturedQuery = query;
          const chain = {
            sort() {
              return chain;
            },
            limit() {
              return chain;
            },
            lean: async () => [],
          };
          return chain;
        },
      },
    }),
  });

  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await routes.get("GET /api/tickets").at(-1)(
    {
      query: {
        guildId: "12345678901",
        status: "all",
        priority: "urgent",
        assignee: "support",
        limit: "10",
      },
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(capturedQuery.guildId, "12345678901");
  assert.equal(capturedQuery.priority, "urgent");
  assert.ok(capturedQuery.$and[0].assignedToName instanceof RegExp);
  assert.equal(
    capturedQuery.$and[0].assignedToName.test("Support Staff"),
    true,
  );
});

test("normal priority filter includes tickets without a stored priority", async () => {
  const routes = new Map();
  const passThrough = (req, res, next) => next();
  let capturedQuery;
  const app = {
    get(path, ...handlers) {
      routes.set("GET " + path, handlers);
    },
    post(path, ...handlers) {
      routes.set("POST " + path, handlers);
    },
  };
  registerTicketsRoutes({
    app,
    requireDashboardAuth: passThrough,
    requirePerm: () => passThrough,
    requireGuildAccess: () => passThrough,
    rateLimit: () => passThrough,
    _getModels: () => ({
      TicketModel: {
        find(query) {
          capturedQuery = query;
          const chain = {
            sort() {
              return chain;
            },
            limit() {
              return chain;
            },
            lean: async () => [],
          };
          return chain;
        },
      },
    }),
  });
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await routes.get("GET /api/tickets").at(-1)(
    { query: { guildId: "12345678901", status: "all", priority: "normal" } },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(capturedQuery.$and[0].$or, [
    { priority: "normal" },
    { priority: null },
  ]);
});

test("SLA ticket ordering returns a stable cursor and hides helper fields", async () => {
  const routes = new Map();
  const passThrough = (req, res, next) => next();
  const dueAt = new Date("2026-10-23T12:00:00.000Z");
  let capturedPipeline;
  const app = {
    get(path, ...handlers) {
      routes.set("GET " + path, handlers);
    },
    post(path, ...handlers) {
      routes.set("POST " + path, handlers);
    },
  };
  registerTicketsRoutes({
    app,
    requireDashboardAuth: passThrough,
    requirePerm: () => passThrough,
    requireGuildAccess: () => passThrough,
    rateLimit: () => passThrough,
    _getModels: () => ({
      TicketModel: {
        aggregate(pipeline) {
          capturedPipeline = pipeline;
          return Promise.resolve([
            {
              _id: "ticket-1",
              ticketSlaSortAt: dueAt,
              ticketSlaSortId: "ticket-1",
            },
            {
              _id: "ticket-2",
              ticketSlaSortAt: new Date(dueAt.getTime() + 60_000),
              ticketSlaSortId: "ticket-2",
            },
          ]);
        },
      },
    }),
  });
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await routes.get("GET /api/tickets").at(-1)(
    {
      query: {
        guildId: "12345678901",
        status: "open",
        sort: "sla",
        limit: "1",
      },
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(capturedPipeline.at(-2).$sort.ticketSlaSortAt, 1);
  assert.equal(response.body.items.length, 1);
  assert.equal(response.body.items[0]._id, "ticket-1");
  assert.equal(response.body.items[0].ticketSlaSortAt, undefined);
  assert.equal(response.body.nextCursor, `${dueAt.toISOString()}|ticket-1`);
});

test("ticket assignee search returns only ticket staff and server admins", async () => {
  const routes = new Map();
  const passThrough = (req, res, next) => next();
  const guildId = "12345678901";
  const makeMember = (id, name, roleIds, isAdmin, isBot = false) => ({
    id,
    displayName: name,
    user: { username: name, bot: isBot },
    roles: { cache: new Map(roleIds.map((roleId) => [roleId, {}])) },
    permissions: { has: () => isAdmin },
  });
  const guild = {
    members: {
      fetch: async () =>
        new Map([
          ["1", makeMember("1", "Ticket Staff", ["ticket-role"], false)],
          ["2", makeMember("2", "General Staff", ["general-role"], false)],
          ["3", makeMember("3", "Server Admin", [], true)],
          ["4", makeMember("4", "Bot", ["ticket-role"], false, true)],
        ]),
    },
  };
  const app = {
    get(path, ...handlers) {
      routes.set("GET " + path, handlers);
    },
    post(path, ...handlers) {
      routes.set("POST " + path, handlers);
    },
  };
  registerTicketsRoutes({
    app,
    requireDashboardAuth: passThrough,
    requirePerm: () => passThrough,
    requireGuildAccess: () => passThrough,
    rateLimit: () => passThrough,
    _getClient: () => ({ guilds: { cache: { get: () => guild } } }),
    _getModels: () => ({
      GuildConfig: {
        findOne: () => ({
          lean: async () => ({
            staffRoleIds: ["general-role"],
            staffRolesByFeature: { tickets: ["ticket-role"] },
          }),
        }),
      },
    }),
  });

  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await routes.get("GET /api/tickets/assignees").at(-1)(
    { query: { guildId, q: "sta" } },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    response.body.items.map((member) => member.id),
    ["3", "1"],
  );
});

test("ticket management updates assignment, priority, and SLA in its guild scope", async () => {
  const routes = new Map();
  const passThrough = (req, res, next) => next();
  const ticket = {
    _id: "ticket-1",
    guildId: "12345678901",
    userId: "22222222222",
  };
  const assigneeId = "33333333333";
  const assignee = {
    displayName: "Support Staff",
    user: { username: "staff" },
  };
  const client = {
    guilds: {
      cache: {
        get: (guildId) =>
          guildId === ticket.guildId
            ? {
                members: {
                  cache: {
                    get: (memberId) =>
                      memberId === assigneeId ? assignee : null,
                  },
                },
              }
            : null,
      },
    },
  };
  const app = {
    get(path, ...handlers) {
      routes.set("GET " + path, handlers);
    },
    post(path, ...handlers) {
      routes.set("POST " + path, handlers);
    },
  };

  registerTicketsRoutes({
    app,
    requireDashboardAuth: passThrough,
    requirePerm: () => passThrough,
    requireGuildAccess: () => passThrough,
    rateLimit: () => passThrough,
    getActorFromRequest: () => "staff-1",
    recordAudit: async () => {},
    _getClient: () => client,
    _getModels: () => ({
      TicketModel: {
        findById: () => ({ lean: async () => ticket }),
        updateOne: async (filter, update) => {
          assert.equal(filter.guildId, ticket.guildId);
          Object.assign(ticket, update.$set);
        },
      },
    }),
  });

  const handler = routes.get("POST /api/tickets/:ticketId/manage").at(-1);
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await handler(
    {
      params: { ticketId: ticket._id },
      body: {
        guildId: ticket.guildId,
        assignedToId: assigneeId,
        priority: "high",
        slaHours: 4,
      },
      dashboardUser: {
        allowedGuildIds: [ticket.guildId],
        selectedGuildId: ticket.guildId,
      },
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(ticket.assignedToId, assigneeId);
  assert.equal(ticket.assignedToName, "Support Staff");
  assert.equal(ticket.priority, "high");
  assert.equal(ticket.slaHours, 4);
  assert.ok(ticket.slaDueAt instanceof Date);
  assert.equal(ticket.metadataUpdatedById, "staff-1");
});

test("ticket management rejects invalid priority values", async () => {
  const routes = new Map();
  const passThrough = (req, res, next) => next();
  const ticket = { _id: "ticket-1", guildId: "12345678901" };
  let updateCalled = false;
  const app = {
    get(path, ...handlers) {
      routes.set("GET " + path, handlers);
    },
    post(path, ...handlers) {
      routes.set("POST " + path, handlers);
    },
  };
  registerTicketsRoutes({
    app,
    requireDashboardAuth: passThrough,
    requirePerm: () => passThrough,
    requireGuildAccess: () => passThrough,
    rateLimit: () => passThrough,
    _getModels: () => ({
      TicketModel: {
        findById: () => ({ lean: async () => ticket }),
        updateOne: async () => {
          updateCalled = true;
        },
      },
    }),
  });

  const handler = routes.get("POST /api/tickets/:ticketId/manage").at(-1);
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await handler(
    {
      params: { ticketId: ticket._id },
      body: { guildId: ticket.guildId, priority: "critical", slaHours: 4 },
      dashboardUser: {
        allowedGuildIds: [ticket.guildId],
        selectedGuildId: ticket.guildId,
      },
    },
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "INVALID_PRIORITY");
  assert.equal(updateCalled, false);
});
