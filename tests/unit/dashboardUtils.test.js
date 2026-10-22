// tests/unit/dashboardUtils.test.js
// Testa os utilitários puros extraídos de src/dashboard.js:
// sanitização (sanitize.js), schemas Zod (schemas.js) e extração do ator (audit.js).
// Sem dependências externas.

const { test, ok, eq, deepEq } = require("./_harness");
const {
  sanitizeText,
  sanitizeId,
  safeAuditPayload,
} = require("../../src/dashboard/sanitize");
const { getActorFromRequest } = require("../../src/dashboard/audit");
const {
  GuildConfigSchema,
  ModWarnSchema,
  ModMuteSchema,
  LogsQuerySchema,
  GameNewsFeedSchema,
} = require("../../src/dashboard/schemas");

// -----------------------------
// sanitizeText
// -----------------------------
test("sanitizeText trata valores nulos/indefinidos", () => {
  eq(sanitizeText(null), "");
  eq(sanitizeText(undefined), "");
});

test("sanitizeText remove tags HTML e caracteres de controlo", () => {
  eq(sanitizeText("<b>hi</b>"), "hi");
  eq(sanitizeText("a\u0000b"), "ab");
});

test("sanitizeText trunca ao maxLen e faz trim", () => {
  eq(sanitizeText("   abcdef   ", { maxLen: 3 }), "abc");
  eq(sanitizeText("  x  "), "x");
});

test("sanitizeText permite desativar o strip de HTML", () => {
  eq(sanitizeText("<b>x</b>", { stripHtml: false }), "<b>x</b>");
});

// -----------------------------
// sanitizeId
// -----------------------------
test("sanitizeId mantém apenas dígitos", () => {
  eq(sanitizeId("abc123def456"), "123456");
  eq(sanitizeId("<@987654321098765432>"), "987654321098765432");
});

test("sanitizeId trunca a 20 dígitos", () => {
  eq(sanitizeId("1".repeat(30)).length, 20);
});

test("sanitizeId devolve string vazia para entradas sem dígitos", () => {
  eq(sanitizeId("abc"), "");
  eq(sanitizeId(null), "");
});

// -----------------------------
// safeAuditPayload
// -----------------------------
test("safeAuditPayload devolve null para payload vazio", () => {
  eq(safeAuditPayload(null), null);
  eq(safeAuditPayload(undefined), null);
});

test("safeAuditPayload devolve o payload intacto quando é pequeno", () => {
  const p = { a: 1 };
  eq(safeAuditPayload(p), p);
});

test("safeAuditPayload trunca payloads grandes", () => {
  const big = { data: "x".repeat(6000) };
  const out = safeAuditPayload(big);
  eq(out._trimmed, true);
  ok(
    typeof out.preview === "string" && out.preview.length === 5000,
    "preview deve ter 5000 chars",
  );
});

test("safeAuditPayload marca payloads não serializáveis", () => {
  const circular = {};
  circular.self = circular;
  eq(safeAuditPayload(circular)._unserializable, true);
});

// -----------------------------
// getActorFromRequest
// -----------------------------
test("getActorFromRequest devolve null sem pedido", () => {
  eq(getActorFromRequest(null), null);
});

test("getActorFromRequest prefere o utilizador do JWT", () => {
  const req = {
    dashboardUser: { username: "jwtUser" },
    body: { actor: "bodyUser" },
    headers: { "x-dashboard-actor": "headerUser" },
  };
  eq(getActorFromRequest(req), "jwtUser");
});

test("getActorFromRequest usa body e depois header como fallback", () => {
  eq(
    getActorFromRequest({ body: { actor: "bodyUser" }, headers: {} }),
    "bodyUser",
  );
  eq(
    getActorFromRequest({ headers: { "x-dashboard-actor": "headerUser" } }),
    "headerUser",
  );
});

test("getActorFromRequest trunca a 64 caracteres", () => {
  const long = "a".repeat(100);
  eq(getActorFromRequest({ body: { actor: long } }).length, 64);
});

test("getActorFromRequest devolve null quando não há ator", () => {
  eq(getActorFromRequest({ headers: {}, body: {} }), null);
});

// -----------------------------
// schemas
// -----------------------------
test("ModWarnSchema aceita payload válido e rejeita sem guildId", () => {
  ok(ModWarnSchema.safeParse({ guildId: "1", userId: "2" }).success);
  eq(ModWarnSchema.safeParse({ userId: "2" }).success, false);
});

test("ModMuteSchema aceita duration opcional", () => {
  ok(
    ModMuteSchema.safeParse({ guildId: "1", userId: "2", duration: "10m" })
      .success,
  );
  ok(ModMuteSchema.safeParse({ guildId: "1", userId: "2" }).success);
});

test("LogsQuerySchema aceita query vazia e campos extra (passthrough)", () => {
  ok(LogsQuerySchema.safeParse({}).success);
  ok(
    LogsQuerySchema.safeParse({ guildId: "1", page: "2", extra: "x" }).success,
  );
});

test("GuildConfigSchema rejeita chaves desconhecidas (strict)", () => {
  eq(GuildConfigSchema.safeParse({ unknownKey: true }).success, false);
  ok(GuildConfigSchema.safeParse({ language: "pt" }).success);
});

test("GameNewsFeedSchema valida o URL e os limites de canal", () => {
  const valid = {
    name: "Feed",
    feedUrl: "https://example.com/rss",
    channelId: "1234567890",
  };
  ok(GameNewsFeedSchema.safeParse(valid).success);

  const badUrl = { ...valid, feedUrl: "ftp:/bad" };
  eq(GameNewsFeedSchema.safeParse(badUrl).success, false);
});

test("GameNewsFeedSchema normaliza excludeKeywords com limites", () => {
  const base = {
    name: "F",
    feedUrl: "https://e.com/rss",
    channelId: "1234567890",
  };
  ok(
    GameNewsFeedSchema.safeParse({ ...base, excludeKeywords: ["spam", "ads"] })
      .success,
  );
  // mais de 50 keywords deve falhar
  const tooMany = Array.from({ length: 51 }, (_, i) => "k" + i);
  eq(
    GameNewsFeedSchema.safeParse({ ...base, excludeKeywords: tooMany }).success,
    false,
  );
});

test("deepEq é usado para comparar objetos (sanidade do harness)", () => {
  deepEq({ a: [1, 2] }, { a: [1, 2] });
});
