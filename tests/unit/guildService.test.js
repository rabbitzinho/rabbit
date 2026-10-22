// tests/unit/guildService.test.js
// Testa os helpers null-safe da camada de serviços do Discord (guild/canal/membro).
// Não faz pedidos REST: usa um client falso e valida o caminho síncrono (cache).

const { test, ok, eq } = require("./_harness");
const gs = require("../../src/services/guildService");

function makeClient() {
  const channel = { id: "chan-1", name: "geral" };
  const member = {
    id: "user-1",
    user: { id: "user-1", username: "ana", discriminator: "0" },
  };
  const user = { id: "user-2", username: "bruno", discriminator: "4321" };
  const guild = {
    id: "guild-1",
    channels: { cache: new Map([["chan-1", channel]]) },
    members: { cache: new Map([["user-1", member]]) },
  };

  return {
    guilds: { cache: new Map([["guild-1", guild]]) },
    channels: {
      cache: new Map([["chan-global", { id: "chan-global", name: "global" }]]),
    },
    users: { cache: new Map([["user-2", user]]) },
  };
}

// -----------------------------
// normalizeId
// -----------------------------
test("normalizeId trata null/undefined/números/espaços", () => {
  eq(gs.normalizeId(null), "");
  eq(gs.normalizeId(undefined), "");
  eq(gs.normalizeId("  abc  "), "abc");
  eq(gs.normalizeId(123), "123");
  eq(gs.normalizeId("   "), "");
});

// -----------------------------
// getGuild
// -----------------------------
test("getGuild devolve a guild quando existe no cache", () => {
  const client = makeClient();
  eq(gs.getGuild(client, "guild-1").id, "guild-1");
});

test("getGuild é null-safe (client/guildId/cache em falta)", () => {
  const client = makeClient();
  eq(gs.getGuild(null, "guild-1"), null);
  eq(gs.getGuild(client, ""), null);
  eq(gs.getGuild(client, "nao-existe"), null);
  eq(gs.getGuild({}, "guild-1"), null);
});

// -----------------------------
// getCachedChannel
// -----------------------------
test("getCachedChannel encontra canal na guild e faz fallback ao cache global", () => {
  const client = makeClient();
  eq(gs.getCachedChannel(client, "guild-1", "chan-1").name, "geral");
  eq(gs.getCachedChannel(client, "guild-1", "chan-global").name, "global");
});

test("getCachedChannel devolve null para entradas inválidas", () => {
  const client = makeClient();
  eq(gs.getCachedChannel(client, "guild-1", "nao-existe"), null);
  eq(gs.getCachedChannel(client, "guild-1", ""), null);
  eq(gs.getCachedChannel(null, "guild-1", "chan-1"), null);
});

// -----------------------------
// getCachedMember / getCachedUser
// -----------------------------
test("getCachedMember devolve o membro da guild", () => {
  const client = makeClient();
  eq(gs.getCachedMember(client, "guild-1", "user-1").id, "user-1");
  eq(gs.getCachedMember(client, "guild-1", "user-2"), null);
});

test("getCachedUser devolve o utilizador do cache global", () => {
  const client = makeClient();
  eq(gs.getCachedUser(client, "user-2").username, "bruno");
  eq(gs.getCachedUser(client, "user-1"), null);
});

// -----------------------------
// formatUserTag
// -----------------------------
test("formatUserTag usa discriminator apenas quando relevante", () => {
  eq(gs.formatUserTag({ username: "ana", discriminator: "0" }), "ana");
  eq(
    gs.formatUserTag({ username: "bruno", discriminator: "4321" }),
    "bruno#4321",
  );
  eq(gs.formatUserTag({ tag: "legacy#1234", username: "x" }), "legacy#1234");
  eq(gs.formatUserTag(null), null);
  eq(gs.formatUserTag({}), null);
});

// -----------------------------
// resolve* (caminho de cache é síncrono)
// -----------------------------
test("resolveChannel devolve o canal em cache sem ir ao REST", () => {
  const client = makeClient();
  const ch = gs.resolveChannel(client, "guild-1", "chan-1");
  ok(!(ch instanceof Promise), "esperava valor síncrono do cache");
  eq(ch.name, "geral");
});

test("resolveChannel com fetch:false nunca devolve Promise", () => {
  const client = makeClient();
  eq(
    gs.resolveChannel(client, "guild-1", "nao-existe", { fetch: false }),
    null,
  );
});

test("resolveMember devolve o membro em cache sem ir ao REST", () => {
  const client = makeClient();
  const m = gs.resolveMember(client, "guild-1", "user-1");
  ok(!(m instanceof Promise), "esperava valor síncrono do cache");
  eq(m.id, "user-1");
});

test("resolveMember devolve null quando a guild não existe (sem fetch)", () => {
  const client = makeClient();
  eq(gs.resolveMember(client, "guild-x", "user-1", { fetch: false }), null);
});

test("resolveUser devolve o utilizador em cache sem ir ao REST", () => {
  const client = makeClient();
  const u = gs.resolveUser(client, "user-2");
  ok(!(u instanceof Promise), "esperava valor síncrono do cache");
  eq(u.username, "bruno");
});
