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
    "GET /api/tickets/:ticketId/transcript",
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
  let updateCalls = 0;
  let auditCalls = 0;
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
    recordAudit: async () => {
      auditCalls += 1;
    },
    _getClient: () => client,
    _getModels: () => ({
      TicketModel: {
        findById: () => ({ lean: async () => ticket }),
        updateOne: async (filter, update) => {
          updateCalls += 1;
          assert.equal(filter.guildId, ticket.guildId);
          if (update.$set) Object.assign(ticket, update.$set);
          const activityEvents = update.$push?.activity?.$each || [];
          ticket.activity = [...(ticket.activity || []), ...activityEvents];
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
        labels: [" Bug ", "Support", "bug"],
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
  assert.deepEqual(ticket.labels, ["Bug", "Support"]);
  assert.equal(ticket.activity[0].action, "metadata_updated");
  assert.deepEqual(ticket.activity[0].details.labels, ["Bug", "Support"]);
  assert.ok(ticket.slaDueAt instanceof Date);
  assert.equal(ticket.metadataUpdatedById, "staff-1");

  const initialDueAt = ticket.slaDueAt;
  await handler(
    {
      params: { ticketId: ticket._id },
      body: {
        guildId: ticket.guildId,
        assignedToId: assigneeId,
        priority: "high",
        slaHours: 4,
        labels: ["Bug", "Support"],
      },
      dashboardUser: {
        allowedGuildIds: [ticket.guildId],
        selectedGuildId: ticket.guildId,
      },
    },
    response,
  );

  assert.equal(updateCalls, 1);
  assert.equal(auditCalls, 1);
  assert.equal(ticket.activity.length, 1);
  assert.equal(ticket.slaDueAt, initialDueAt);
});

test("ticket audit returns management and reply events without message content", async () => {
  const routes = new Map();
  const passThrough = (req, res, next) => next();
  const ticket = {
    _id: "ticket-activity",
    guildId: "12345678901",
    userId: "22222222222",
    activity: [
      {
        action: "metadata_updated",
        actorId: "staff-1",
        actorUsername: "Staff",
        createdAt: new Date("2026-10-22T11:00:00.000Z"),
        details: { priority: "urgent", labels: ["billing"] },
      },
      {
        action: "staff_reply",
        actorId: "staff-1",
        actorUsername: "Staff",
        createdAt: new Date("2026-10-22T11:01:00.000Z"),
      },
    ],
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
    _getModels: () => ({
      TicketModel: { findById: () => ({ lean: async () => ticket }) },
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
  await routes.get("GET /api/tickets/:ticketId/audit").at(-1)(
    {
      params: { ticketId: ticket._id },
      query: { guildId: ticket.guildId },
      dashboardUser: {
        allowedGuildIds: [ticket.guildId],
        selectedGuildId: ticket.guildId,
      },
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    response.body.items.map((event) => event.action),
    ["metadata_updated", "staff_reply"],
  );
  assert.deepEqual(response.body.items[0].details.labels, ["billing"]);
  assert.equal(JSON.stringify(response.body).includes("reply body"), false);
});

test("ticket management rejects more than eight labels", async () => {
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
  await routes.get("POST /api/tickets/:ticketId/manage").at(-1)(
    {
      params: { ticketId: ticket._id },
      body: {
        guildId: ticket.guildId,
        priority: "normal",
        slaHours: 0,
        labels: Array.from({ length: 9 }, (_, index) => `label-${index}`),
      },
      dashboardUser: {
        allowedGuildIds: [ticket.guildId],
        selectedGuildId: ticket.guildId,
      },
    },
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "INVALID_TICKET_LABELS");
  assert.equal(updateCalled, false);
});

test("ticket transcript export is guild-scoped and includes chronological messages", async () => {
  const routes = new Map();
  const passThrough = (req, res, next) => next();
  const guildId = "12345678901";
  const channelId = "23456789012";
  const ticket = {
    _id: "ticket-1",
    guildId,
    channelId,
    ticketNumber: 42,
    userId: "34567890123",
    username: "Member",
    createdAt: new Date("2026-10-22T10:00:00.000Z"),
  };
  const channel = {
    messages: {
      fetch: async ({ limit }) => {
        assert.equal(limit, 100);
        return new Map([
          [
            "message-2",
            {
              id: "message-2",
              createdTimestamp: 2,
              createdAt: new Date("2026-10-22T10:02:00.000Z"),
              content: "second reply",
              author: { username: "Staff" },
              attachments: new Map(),
            },
          ],
          [
            "message-1",
            {
              id: "message-1",
              createdTimestamp: 1,
              createdAt: new Date("2026-10-22T10:01:00.000Z"),
              content: "first message",
              author: { username: "Member" },
              attachments: new Map(),
            },
          ],
        ]);
      },
    },
  };
  const guild = {
    id: guildId,
    channels: { cache: new Map([[channelId, channel]]) },
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
    _getClient: () => ({ guilds: { cache: new Map([[guildId, guild]]) } }),
    _getModels: () => ({
      TicketModel: { findById: () => ({ lean: async () => ticket }) },
    }),
  });
  const response = {
    statusCode: 200,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
  await routes.get("GET /api/tickets/:ticketId/transcript").at(-1)(
    {
      params: { ticketId: ticket._id },
      query: { guildId },
      dashboardUser: { allowedGuildIds: [guildId], selectedGuildId: guildId },
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["Content-Disposition"], /ticket-42\.txt/);
  assert.ok(
    response.body.indexOf("first message") <
      response.body.indexOf("second reply"),
  );
  assert.match(response.body, /Messages exported: 2/);
  assert.match(response.body, /Export cap: 1000/);
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
