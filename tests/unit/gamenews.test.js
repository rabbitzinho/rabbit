// tests/unit/gamenews.test.js
// Testa os helpers puros do sistema GameNews (SSRF guards, dedup por hash,
// normalização de links e janelas temporais). Sem dependências externas.

const { test, ok, eq, deepEq } = require("./_harness");
const gamenews = require("../../src/systems/gamenews");

const {
  clampNumber,
  withJitter,
  normalizeIp,
  isPrivateIp,
  isBlockedHostname,
  normalizeLink,
  generateHash,
  getItemDate,
  isItemTooOld,
  makeFeedSourceKey,
  getNewItemsByHashes,
  pushHashAndTrim,
  collectExtraChannelIds,
} = gamenews._internals;

// -----------------------------
// clampNumber
// -----------------------------
test("clampNumber mantém valores dentro do intervalo", () => {
  eq(clampNumber(5, 0, 10), 5);
  eq(clampNumber(-1, 0, 10), 0);
  eq(clampNumber(99, 0, 10), 10);
});

test("clampNumber devolve null para entradas não numéricas", () => {
  eq(clampNumber(NaN, 0, 10), null);
  eq(clampNumber("5", 0, 10), null);
  eq(clampNumber(Infinity, 0, 10), null);
});

// -----------------------------
// withJitter
// -----------------------------
test("withJitter sem jitter devolve o valor base", () => {
  eq(withJitter(1000, 0), 1000);
  eq(withJitter(1000), 1000);
});

test("withJitter aplica jitter dentro dos limites e nunca é negativo", () => {
  for (let i = 0; i < 20; i++) {
    const v = withJitter(1000, 200);
    ok(v >= 800 && v <= 1200, "valor fora do intervalo: " + v);
  }
  for (let i = 0; i < 20; i++) {
    const v = withJitter(50, 500);
    ok(v >= 0 && v <= 550, "valor fora do intervalo: " + v);
  }
});

// -----------------------------
// normalizeIp / isPrivateIp
// -----------------------------
test("normalizeIp desembrulha IPv4 mapeado em IPv6", () => {
  eq(normalizeIp("::ffff:1.2.3.4"), "1.2.3.4");
  eq(normalizeIp("1.2.3.4"), "1.2.3.4");
  eq(normalizeIp(null), "");
  eq(normalizeIp(123), "");
});

test("isPrivateIp deteta intervalos privados/reservados IPv4", () => {
  eq(isPrivateIp("10.0.0.1"), true);
  eq(isPrivateIp("127.0.0.1"), true);
  eq(isPrivateIp("192.168.1.5"), true);
  eq(isPrivateIp("172.16.5.5"), true);
  eq(isPrivateIp("172.31.255.255"), true);
  eq(isPrivateIp("169.254.10.10"), true);
  eq(isPrivateIp("100.64.0.1"), true);
  eq(isPrivateIp("224.0.0.1"), true);
});

test("isPrivateIp não marca IPs públicos IPv4", () => {
  eq(isPrivateIp("8.8.8.8"), false);
  eq(isPrivateIp("172.32.0.1"), false);
  eq(isPrivateIp("100.128.0.1"), false);
  eq(isPrivateIp("203.0.113.10"), false);
});

test("isPrivateIp deteta intervalos IPv6 especiais", () => {
  eq(isPrivateIp("::1"), true);
  eq(isPrivateIp("::"), true);
  eq(isPrivateIp("fd00::1"), true);
  eq(isPrivateIp("fe80::1"), true);
  eq(isPrivateIp("2001:db8::1"), true);
});

test("isPrivateIp não marca IPv6 público e trata IP inválido como público", () => {
  eq(isPrivateIp("2606:4700::1111"), false);
  eq(isPrivateIp("not-an-ip"), false);
});

test("isPrivateIp desembrulha IPv4 mapeado antes de avaliar", () => {
  eq(isPrivateIp("::ffff:10.0.0.1"), true);
  eq(isPrivateIp("::ffff:8.8.8.8"), false);
});

// -----------------------------
// isBlockedHostname
// -----------------------------
test("isBlockedHostname bloqueia localhost e metadata", () => {
  eq(isBlockedHostname("localhost"), true);
  eq(isBlockedHostname("sub.localhost"), true);
  eq(isBlockedHostname("LOCALHOST"), true);
  eq(isBlockedHostname("metadata.google.internal"), true);
});

test("isBlockedHostname permite hostnames normais e rejeita vazios", () => {
  eq(isBlockedHostname("example.com"), false);
  eq(isBlockedHostname(""), true);
  eq(isBlockedHostname(null), true);
});

// -----------------------------
// normalizeLink
// -----------------------------
test("normalizeLink remove query string e fragmento", () => {
  eq(normalizeLink("https://a.com/b/c?x=1#frag"), "https://a.com/b/c");
});

test("normalizeLink resolve links relativos contra a base", () => {
  eq(normalizeLink("/rel", "https://a.com/dir/page"), "https://a.com/rel");
});

test("normalizeLink devolve o original quando não é URL válido", () => {
  eq(normalizeLink("not a url"), "not a url");
  eq(normalizeLink(null), null);
});

// -----------------------------
// generateHash / dedup
// -----------------------------
test("generateHash é determinístico e produz sha256 hex", () => {
  const item = { link: "https://a.com/news/1", title: "Título" };
  const h1 = generateHash(item);
  const h2 = generateHash({ ...item });
  eq(h1, h2);
  eq(h1.length, 64);
  ok(/^[a-f0-9]{64}$/.test(h1), "hash não é hex: " + h1);
});

test("generateHash ignora query string do link (link normalizado)", () => {
  const a = generateHash({ link: "https://a.com/news/1?utm=abc" });
  const b = generateHash({ link: "https://a.com/news/1?utm=xyz" });
  eq(a, b);
});

test("generateHash distingue itens diferentes", () => {
  const a = generateHash({ guid: "g1" });
  const b = generateHash({ guid: "g2" });
  ok(a !== b, "hashes deveriam ser diferentes");
});

test("generateHash dá prioridade a guid/id sobre o link", () => {
  eq(
    generateHash({ guid: "same", link: "https://a.com/1" }),
    generateHash({ guid: "same", link: "https://a.com/2" }),
  );
});

test("getNewItemsByHashes devolve todos os itens quando não há histórico", () => {
  const items = [{ link: "https://a.com/1" }, { link: "https://a.com/2" }];
  deepEq(getNewItemsByHashes(items, []), items);
  eq(getNewItemsByHashes([], []).length, 0);
  eq(getNewItemsByHashes(null, []).length, 0);
});

test("getNewItemsByHashes filtra itens já conhecidos", () => {
  const seen = { link: "https://a.com/1" };
  const fresh = { link: "https://a.com/2" };
  const result = getNewItemsByHashes([seen, fresh], [generateHash(seen)]);
  eq(result.length, 1);
  eq(result[0].link, fresh.link);
});

test("pushHashAndTrim adiciona, deduplica e limita o histórico", () => {
  const rec = {};
  pushHashAndTrim(rec, "a", 5);
  deepEq(rec.lastHashes, ["a"]);

  rec.lastHashes = ["a", "b"];
  pushHashAndTrim(rec, "a", 5);
  deepEq(rec.lastHashes, ["b", "a"]);

  rec.lastHashes = ["a", "b", "c"];
  pushHashAndTrim(rec, "d", 2);
  deepEq(rec.lastHashes, ["c", "d"]);
});

// -----------------------------
// Datas
// -----------------------------
test("getItemDate usa isoDate/pubDate e cai para agora quando inválido", () => {
  const iso = "2024-01-02T03:04:05.000Z";
  eq(getItemDate({ isoDate: iso }).toISOString(), iso);

  const before = Date.now();
  const d = getItemDate({ pubDate: "data-invalida" });
  ok(d.getTime() >= before - 1000, "deveria devolver Date.now()");
});

test("isItemTooOld compara com a janela em dias", () => {
  const old = {
    pubDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const recent = { pubDate: new Date(Date.now() - 60 * 1000).toISOString() };

  eq(isItemTooOld(old, 5), true);
  eq(isItemTooOld(recent, 5), false);
  // Deteção desativada para janelas não positivas
  eq(isItemTooOld(old, 0), false);
  eq(isItemTooOld(old, NaN), false);
});

// -----------------------------
// makeFeedSourceKey
// -----------------------------
test("makeFeedSourceKey é estável e distingue feeds", () => {
  const key = makeFeedSourceKey({
    guildId: "1",
    feed: "https://a.com/rss",
    channelId: "2",
  });
  eq(
    key,
    JSON.stringify({
      guildId: "1",
      feedUrl: "https://a.com/rss",
      channelId: "2",
    }),
  );

  const other = makeFeedSourceKey({
    guildId: "1",
    feed: "https://a.com/rss",
    channelId: "3",
  });
  ok(key !== other, "chaves deveriam diferir por canal");

  // Aceita feedUrl como alternativa a feed
  eq(
    makeFeedSourceKey({
      guildId: "1",
      feedUrl: "https://a.com/rss",
      channelId: "2",
    }),
    key,
  );
});

test("makeFeedSourceKey normaliza campos em falta para null", () => {
  eq(
    makeFeedSourceKey({}),
    JSON.stringify({ guildId: null, feedUrl: null, channelId: null }),
  );
});

// -----------------------------
// collectExtraChannelIds (fan-out multi-canal)
// -----------------------------
test("collectExtraChannelIds exclui o canal principal e deduplica", () => {
  deepEq(
    collectExtraChannelIds({
      channelId: "111",
      extraChannelIds: ["222", "222", "111", "333"],
    }),
    ["222", "333"],
  );
});

test("collectExtraChannelIds limita a 5 canais e ignora entradas vazias", () => {
  deepEq(
    collectExtraChannelIds({
      channelId: "1",
      extraChannelIds: ["2", "", null, "3", "4", "5", "6", "7", "8"],
    }),
    ["2", "3", "4", "5", "6"],
  );
});

test("collectExtraChannelIds faz trim e é null-safe", () => {
  deepEq(
    collectExtraChannelIds({ channelId: "1", extraChannelIds: [" 2 ", "2"] }),
    ["2"],
  );
  deepEq(collectExtraChannelIds(null), []);
  deepEq(collectExtraChannelIds({}), []);
  deepEq(
    collectExtraChannelIds({ channelId: "1", extraChannelIds: "not-an-array" }),
    [],
  );
});
