// tests/unit/authMiddleware.test.js
// Testa o middleware de auth/RBAC extraído para src/dashboard/authMiddleware.js.
// Não valida JWT real: injeta um `jwt` falso.

const { test, ok, eq } = require("./_harness");
const { createAuthMiddleware } = require("../../src/dashboard/authMiddleware");

// sanitizeId mínimo equivalente ao da dashboard (apenas dígitos, máx. 20).
function sanitizeId(value) {
  const s = String(value == null ? "" : value)
    .replace(/<[^>]*>/g, "")
    .trim();
  return s.replace(/\D/g, "").slice(0, 20);
}

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    },
  };
}

function makeMw(opts) {
  const config = {
    dashboard: {
      requireAuth: opts && opts.requireAuth === false ? false : true,
    },
  };
  return createAuthMiddleware({
    jwt: { verify: () => (opts && opts.payload) || { t: "oauth", sub: "1" } },
    JWT_SECRET: "test-secret",
    sanitizeId,
    config,
  });
}

// -----------------------------
// extractToken
// -----------------------------
test("extractToken lê o cookie dash_token", () => {
  const { extractToken } = makeMw();
  eq(
    extractToken({ headers: { cookie: "foo=1; dash_token=abc123; bar=2" } }),
    "abc123",
  );
});

test("extractToken lê Authorization: Bearer", () => {
  const { extractToken } = makeMw();
  eq(extractToken({ headers: { authorization: "Bearer xyz" } }), "xyz");
});

test("extractToken lê x-dashboard-token e é null-safe", () => {
  const { extractToken } = makeMw();
  eq(extractToken({ headers: { "x-dashboard-token": "tok" } }), "tok");
  eq(extractToken({ headers: {} }), null);
  eq(extractToken(null), null);
});

// -----------------------------
// requirePerm
// -----------------------------
test("requirePerm deixa passar quando a permissão existe", () => {
  const { requirePerm } = makeMw();
  const req = { dashboardUser: { permissions: { canViewLogs: true } } };
  const res = makeRes();
  let passed = false;
  requirePerm({ anyOf: ["canViewLogs"] })(req, res, () => {
    passed = true;
  });
  ok(passed, "esperava next() quando a permissão existe");
  eq(res.statusCode, null);
});

test("requirePerm deixa o owner do bot ignorar permissões granulares", () => {
  const { requirePerm } = makeMw();
  const req = { dashboardUser: { role: "BOT_OWNER", permissions: {} } };
  const res = makeRes();
  let passed = false;
  requirePerm({ anyOf: ["canManageUsers"] })(req, res, () => {
    passed = true;
  });
  ok(passed);
});

test("requirePerm não permite que um bot admin ignore permissões granulares", () => {
  const { requirePerm } = makeMw();
  const req = { dashboardUser: { role: "BOT_ADMIN", permissions: {} } };
  const res = makeRes();
  requirePerm({ anyOf: ["canManageUsers"] })(req, res, () => {
    throw new Error("não devia passar");
  });
  eq(res.statusCode, 403);
});

test("requirePerm não trata o perfil legado ADMIN como administrador do bot", () => {
  const { requirePerm } = makeMw();
  const req = { dashboardUser: { role: "ADMIN", permissions: {} } };
  const res = makeRes();
  requirePerm({ anyOf: ["canManageUsers"] })(req, res, () => {
    throw new Error("não devia passar");
  });
  eq(res.statusCode, 403);
});

test("decodeDashboardToken assume USER quando o token não define perfil", async () => {
  const { decodeDashboardToken } = makeMw({
    payload: { t: "oauth", sub: "1" },
  });
  const user = await decodeDashboardToken("token");
  eq(user.role, "USER");
});

test("decodeDashboardToken promotes the configured owner from a versioned token", async () => {
  const previousBotOwnerIds = process.env.BOT_OWNER_IDS;
  process.env.BOT_OWNER_IDS = "234567890123456789";
  try {
    const { decodeDashboardToken } = makeMw({
      payload: {
        t: "oauth",
        sub: "234567890123456789",
        role: "USER",
        guildScopeVersion: 2,
      },
    });
    const user = await decodeDashboardToken("token");
    eq(user.role, "BOT_OWNER");
  } finally {
    if (previousBotOwnerIds === undefined) delete process.env.BOT_OWNER_IDS;
    else process.env.BOT_OWNER_IDS = previousBotOwnerIds;
  }
});

test("decodeDashboardToken does not promote the built-in owner when overridden", async () => {
  const previousBotOwnerIds = process.env.BOT_OWNER_IDS;
  process.env.BOT_OWNER_IDS = "234567890123456789";
  try {
    const { decodeDashboardToken } = makeMw({
      payload: {
        t: "oauth",
        sub: "810243963574550558",
        role: "USER",
      },
    });
    const user = await decodeDashboardToken("token");
    eq(user.role, "USER");
  } finally {
    if (previousBotOwnerIds === undefined) delete process.env.BOT_OWNER_IDS;
    else process.env.BOT_OWNER_IDS = previousBotOwnerIds;
  }
});

test("decodeDashboardToken recognizes a legacy configured owner for session migration", async () => {
  const previousBotOwnerIds = process.env.BOT_OWNER_IDS;
  process.env.BOT_OWNER_IDS = "234567890123456789";
  try {
    const { decodeDashboardToken } = makeMw({
      payload: {
        t: "oauth",
        sub: "234567890123456789",
        role: "USER",
        profile: "UNSCOPED",
      },
    });
    const user = await decodeDashboardToken("token");
    eq(user.role, "BOT_OWNER");
    eq(user.guildScopeVersion, null);
  } finally {
    if (previousBotOwnerIds === undefined) delete process.env.BOT_OWNER_IDS;
    else process.env.BOT_OWNER_IDS = previousBotOwnerIds;
  }
});

test("decodeDashboardToken accepts the configured owner in a versioned global session", async () => {
  const previousBotOwnerIds = process.env.BOT_OWNER_IDS;
  process.env.BOT_OWNER_IDS = "234567890123456789";
  try {
    const { decodeDashboardToken } = makeMw({
      payload: {
        t: "oauth",
        sub: "234567890123456789",
        role: "BOT_OWNER",
        profile: "UNSCOPED",
        selectedGuildId: null,
        guildScopeVersion: 2,
      },
    });
    const user = await decodeDashboardToken("token");
    eq(user.role, "BOT_OWNER");
    eq(user.selectedGuildId, null);
  } finally {
    if (previousBotOwnerIds === undefined) delete process.env.BOT_OWNER_IDS;
    else process.env.BOT_OWNER_IDS = previousBotOwnerIds;
  }
});

test("requirePerm devolve 403 quando falta a permissão", () => {
  const { requirePerm } = makeMw();
  const req = { dashboardUser: { permissions: {} } };
  const res = makeRes();
  requirePerm({ anyOf: ["canViewLogs"] })(req, res, () => {
    throw new Error("não devia passar");
  });
  eq(res.statusCode, 403);
  eq(res.body.error, "NO_PERMISSION");
});

test("requirePerm devolve 401 sem utilizador autenticado", () => {
  const { requirePerm } = makeMw();
  const res = makeRes();
  requirePerm({ anyOf: ["canViewLogs"] })({ dashboardUser: null }, res, () => {
    throw new Error("não devia passar");
  });
  eq(res.statusCode, 401);
});

test("requirePerm sem anyOf apenas exige sessão válida", () => {
  const { requirePerm } = makeMw();
  const res = makeRes();
  let passed = false;
  requirePerm({})({ dashboardUser: { permissions: {} } }, res, () => {
    passed = true;
  });
  ok(passed);
});

test("requirePerm não bloqueia quando a auth está desativada", () => {
  const { requirePerm } = makeMw({ requireAuth: false });
  const res = makeRes();
  let passed = false;
  requirePerm({ anyOf: ["canViewLogs"] })({}, res, () => {
    passed = true;
  });
  ok(passed);
});

test("requireDashboardAuth não pode ser desativado em produção", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const { requireDashboardAuth } = makeMw({ requireAuth: false });
    const res = makeRes();
    requireDashboardAuth({ headers: {} }, res, () => {
      throw new Error("não devia passar");
    });
    eq(res.statusCode, 401);
    eq(res.body.error, "Unauthorized");
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

// -----------------------------
// requireGuildAccess
// -----------------------------
test("requireGuildAccess deixa passar a guild selecionada", () => {
  const { requireGuildAccess } = makeMw();
  const req = {
    dashboardUser: {
      selectedGuildId: "111",
      allowedGuildIds: ["111"],
      allowedGuilds: [{ id: "111", owner: true, permissions: "0" }],
      role: "GUILD_ADMIN",
    },
    params: { guildId: "111" },
  };
  const res = makeRes();
  let passed = false;
  requireGuildAccess()(req, res, () => {
    passed = true;
  });
  ok(passed);
});

test("requireGuildAccess exige seleção de guild quando não é opcional", () => {
  const { requireGuildAccess } = makeMw();
  const req = {
    dashboardUser: { selectedGuildId: null, allowedGuildIds: [] },
    params: { guildId: "111" },
  };
  const res = makeRes();
  requireGuildAccess()(req, res, () => {
    throw new Error("não devia passar");
  });
  eq(res.statusCode, 403);
  eq(res.body.error, "NO_GUILD_SELECTED");
});

test("requireGuildAccess bloqueia guild diferente da selecionada", () => {
  const { requireGuildAccess } = makeMw();
  const req = {
    dashboardUser: {
      selectedGuildId: "111",
      allowedGuildIds: ["111"],
      role: "GUILD_ADMIN",
    },
    params: { guildId: "222" },
  };
  const res = makeRes();
  requireGuildAccess()(req, res, () => {
    throw new Error("não devia passar");
  });
  eq(res.statusCode, 403);
  eq(res.body.error, "NO_GUILD_SELECTED");
});

test("requireGuildAccess aplica a allow-list", () => {
  const { requireGuildAccess } = makeMw();
  const req = {
    dashboardUser: {
      selectedGuildId: "222",
      allowedGuildIds: ["111"],
      role: "GUILD_ADMIN",
    },
    params: { guildId: "222" },
  };
  const res = makeRes();
  requireGuildAccess()(req, res, () => {
    throw new Error("não devia passar");
  });
  eq(res.statusCode, 403);
  eq(res.body.error, "NO_GUILD_ACCESS");
});

test("requireGuildAccess opcional uses the selected guild when guildId is omitted", () => {
  const { requireGuildAccess } = makeMw();
  const req = {
    dashboardUser: {
      role: "GUILD_ADMIN",
      selectedGuildId: "111",
      allowedGuildIds: ["111"],
      allowedGuilds: [{ id: "111", owner: true, permissions: "0" }],
    },
    query: { guildId: "" },
  };
  const res = makeRes();
  let passed = false;
  requireGuildAccess({ from: "query", optional: true })(req, res, () => {
    passed = true;
  });
  ok(passed);
});

test("requireGuildAccess optional still requires a selected server scope", () => {
  const { requireGuildAccess } = makeMw();
  const req = {
    dashboardUser: { selectedGuildId: null, allowedGuildIds: [] },
    query: { guildId: "" },
  };
  const res = makeRes();
  requireGuildAccess({ from: "query", optional: true })(req, res, () => {
    throw new Error("não devia passar");
  });
  eq(res.statusCode, 403);
  eq(res.body.error, "NO_GUILD_SELECTED");
});

test("requireGuildAccess rejects a bot owner from guilds they do not administer", () => {
  const { requireGuildAccess } = makeMw();
  const req = {
    dashboardUser: {
      role: "BOT_OWNER",
      selectedGuildId: "111",
      allowedGuildIds: ["111"],
      allowedGuilds: [{ id: "111", owner: false, permissions: "0" }],
    },
    params: { guildId: "111" },
  };
  const res = makeRes();
  requireGuildAccess()(req, res, () => {
    throw new Error("não devia passar");
  });
  eq(res.statusCode, 403);
  eq(res.body.error, "NO_GUILD_ACCESS");
});

test("requireGuildAccess permits bot owner in a guild they also administer", () => {
  const { requireGuildAccess } = makeMw();
  const req = {
    dashboardUser: {
      role: "BOT_OWNER",
      selectedGuildId: "111",
      allowedGuildIds: ["111"],
      allowedGuilds: [{ id: "111", owner: false, permissions: "8" }],
    },
    params: { guildId: "111" },
  };
  const res = makeRes();
  let passed = false;
  requireGuildAccess()(req, res, () => {
    passed = true;
  });
  ok(passed);
});

test("requireGuildAccess devolve 400 quando falta guildId e não é opcional", () => {
  const { requireGuildAccess } = makeMw();
  const req = {
    dashboardUser: { selectedGuildId: "111", allowedGuildIds: [] },
    params: { guildId: "" },
  };
  const res = makeRes();
  requireGuildAccess()(req, res, () => {
    throw new Error("não devia passar");
  });
  eq(res.statusCode, 400);
});
