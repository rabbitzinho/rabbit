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
