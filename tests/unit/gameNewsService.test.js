// tests/unit/gameNewsService.test.js

const { test, eq, ok, deepEq } = require("./_harness");
const {
  toFeedDto,
  listStaticFeeds,
} = require("../../src/services/gameNewsService");

test("toFeedDto: normaliza um documento completo", () => {
  const dto = toFeedDto({
    _id: "abc123",
    guildId: "g1",
    name: "Notícias",
    feedUrl: "https://example.com/rss",
    channelId: "c1",
    logChannelId: "c2",
    extraChannelIds: ["c3"],
    enabled: false,
    intervalMs: 60000,
    maxPerCycle: 3,
    excludeKeywords: ["spoiler"],
  });

  eq(dto.id, "abc123");
  eq(dto.name, "Notícias");
  eq(dto.feedUrl, "https://example.com/rss");
  eq(dto.logChannelId, "c2");
  eq(dto.enabled, false);
  eq(dto.intervalMs, 60000);
  eq(dto.maxPerCycle, 3);
  eq(dto.excludeKeywords.length, 1);
});

test("toFeedDto: aplica fallbacks e tolera documentos parciais/nulos", () => {
  eq(toFeedDto(null).feedUrl, undefined);
  eq(toFeedDto({}).name, "Feed");
  eq(toFeedDto({}).enabled, true);
  eq(toFeedDto({}).intervalMs, null);
  eq(toFeedDto({}).maxPerCycle, null);
  eq(toFeedDto({}).guildId, null);
  eq(toFeedDto({}).logChannelId, null);
  deepEq(toFeedDto({}).extraChannelIds, []);
  deepEq(toFeedDto({}).excludeKeywords, []);
});

test('toFeedDto: aceita o campo legado "feed"', () => {
  eq(
    toFeedDto({ feed: "https://legacy.example/rss" }).feedUrl,
    "https://legacy.example/rss",
  );
});

test("listStaticFeeds: gera ids sequenciais a partir de config.gameNews.sources", () => {
  const list = listStaticFeeds([
    { name: "A", feed: "https://a/rss", channelId: "c1" },
    { name: "B", feed: "https://b/rss", channelId: "c2" },
  ]);

  eq(list.length, 2);
  eq(list[0].id, "0");
  eq(list[1].id, "1");
  eq(list[0].feedUrl, "https://a/rss");
  eq(list[0].enabled, true);
  eq(list[0].guildId, null);
});

test("listStaticFeeds: omite o id quando pedido (usado pelo endpoint de status)", () => {
  const list = listStaticFeeds(
    [{ name: "A", feed: "https://a/rss", channelId: "c1" }],
    { withId: false },
  );
  eq(list[0].id, undefined);
  eq(list[0].name, "A");
});

test("listStaticFeeds: entrada inválida devolve lista vazia", () => {
  deepEq(listStaticFeeds(null), []);
  deepEq(listStaticFeeds(undefined), []);
  ok(Array.isArray(listStaticFeeds("não é lista")), "deve devolver array");
  eq(listStaticFeeds("não é lista").length, 0);
});
