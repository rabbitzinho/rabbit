// tests/integration/gamenews.routes.test.js
// Testes de integração das rotas GameNews (node:test nativo, sem BD).

const test = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");

const {
  registerGameNewsRoutes,
} = require("../../src/dashboard/routes/gamenews");
const {
  startApp,
  stopApp,
  passthrough,
  sanitizeId,
  sanitizeText,
  createFakeFeedModel,
  createFakeNewsModel,
} = require("./_helpers");

// Espelha o schema real definido em src/dashboard.js (subconjunto relevante).
const GameNewsFeedSchema = z.object({
  name: z.string().trim().min(1).max(64),
  feedUrl: z
    .string()
    .trim()
    .min(8)
    .max(2048)
    .refine((v) => /^https?:\/\/\S+$/i.test(v), { message: "Invalid URL" }),
  feed: z.string().trim().optional(),
  channelId: z.string().trim().min(10).max(32),
  logChannelId: z.string().trim().min(10).max(32).nullable().optional(),
  extraChannelIds: z.array(z.string().trim().min(10).max(32)).max(5).optional(),
  enabled: z.boolean().optional(),
  intervalMs: z.number().int().positive().nullable().optional(),
  maxPerCycle: z.number().int().positive().nullable().optional(),
  excludeKeywords: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
});

function buildCtx(overrides) {
  return Object.assign(
    {
      requireDashboardAuth: passthrough,
      requirePerm: () => passthrough,
      requireGuildAccess: () => passthrough,
      config: {},
      configManager: { getPublicConfig: () => ({}) },
      gameNewsSystem: { invalidateFeedsCache() {} },
      sanitizeId,
      sanitizeText,
      recordAudit: async () => {},
      getActorFromRequest: () => ({ id: "test" }),
      GameNewsModel: null,
      GameNewsFeed: null,
      GameNewsFeedSchema,
      getClient: () => null,
      gameNewsStatusCache: [],
    },
    overrides || {},
  );
}

const GUILD = "123456789012345678";
const CHANNEL = "987654321098765432";

test("GET /api/gamenews/feeds devolve os feeds do modelo", async () => {
  const GameNewsFeed = createFakeFeedModel([
    {
      guildId: GUILD,
      name: "Steam",
      feedUrl: "https://example.com/rss",
      channelId: CHANNEL,
      logChannelId: null,
      enabled: true,
      intervalMs: null,
      maxPerCycle: null,
      excludeKeywords: ["rumor"],
    },
  ]);

  const app = await startApp(
    registerGameNewsRoutes,
    buildCtx({ GameNewsFeed }),
  );
  try {
    const res = await fetch(
      app.baseUrl + "/api/gamenews/feeds?guildId=" + GUILD,
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].name, "Steam");
    assert.deepEqual(body.items[0].excludeKeywords, ["rumor"]);
  } finally {
    await stopApp(app.server);
  }
});

test("POST /api/gamenews/feeds normaliza palavras-chave e persiste", async () => {
  const GameNewsFeed = createFakeFeedModel([]);
  let feedsCacheInvalidated = false;
  const app = await startApp(
    registerGameNewsRoutes,
    buildCtx({
      GameNewsFeed,
      gameNewsSystem: {
        invalidateFeedsCache() {
          feedsCacheInvalidated = true;
        },
      },
    }),
  );
  try {
    const res = await fetch(app.baseUrl + "/api/gamenews/feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: GUILD,
        feeds: [
          {
            name: "IGN",
            feedUrl: "https://example.com/rss",
            channelId: CHANNEL,
            excludeKeywords: "Rumor, leaked , rumor",
          },
        ],
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.items.length, 1);
    // normalizadas para minúsculas e duplicados removidos
    assert.deepEqual(body.items[0].excludeKeywords, ["rumor", "leaked"]);

    const stored = GameNewsFeed._all()[0];
    assert.deepEqual(stored.excludeKeywords, ["rumor", "leaked"]);
    assert.equal(feedsCacheInvalidated, true);
  } finally {
    await stopApp(app.server);
  }
});

test("POST /api/gamenews/feeds normaliza canais adicionais (dedupe, limite e exclusão do principal)", async () => {
  const GameNewsFeed = createFakeFeedModel([]);
  const app = await startApp(
    registerGameNewsRoutes,
    buildCtx({ GameNewsFeed }),
  );
  const EXTRA_A = "111111111111111111";
  const EXTRA_B = "222222222222222222";
  try {
    const res = await fetch(app.baseUrl + "/api/gamenews/feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: GUILD,
        feeds: [
          {
            name: "IGN",
            feedUrl: "https://example.com/rss",
            channelId: CHANNEL,
            // mention + duplicado + o próprio canal principal + inválido
            extraChannelIds: [
              "<#" + EXTRA_A + ">",
              EXTRA_A,
              CHANNEL,
              "123",
              EXTRA_B,
            ],
          },
        ],
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.items[0].extraChannelIds, [EXTRA_A, EXTRA_B]);

    const stored = GameNewsFeed._all()[0];
    assert.deepEqual(stored.extraChannelIds, [EXTRA_A, EXTRA_B]);
  } finally {
    await stopApp(app.server);
  }
});

test("POST /api/gamenews/feeds exige guildId", async () => {
  const GameNewsFeed = createFakeFeedModel([]);
  const app = await startApp(
    registerGameNewsRoutes,
    buildCtx({ GameNewsFeed }),
  );
  try {
    const res = await fetch(app.baseUrl + "/api/gamenews/feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feeds: [] }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
  } finally {
    await stopApp(app.server);
  }
});

test("GET /api/gamenews-status expõe lastError e sentHistory", async () => {
  const source = JSON.stringify({
    guildId: GUILD,
    feedUrl: "https://example.com/rss",
    channelId: CHANNEL,
  });

  const GameNewsFeed = createFakeFeedModel([
    {
      guildId: GUILD,
      name: "Steam",
      feedUrl: "https://example.com/rss",
      channelId: CHANNEL,
      logChannelId: null,
      enabled: true,
      intervalMs: null,
      maxPerCycle: null,
      excludeKeywords: [],
    },
  ]);

  const GameNewsModel = createFakeNewsModel([
    {
      source,
      failCount: 2,
      pausedUntil: null,
      lastSentAt: new Date("2026-01-02T10:00:00Z"),
      lastError: "HTTP 500",
      sentHistory: [{ day: "2026-01-01", count: 3 }],
      lastHashes: ["a", "b"],
      updatedAt: new Date("2026-01-02T10:00:00Z"),
    },
  ]);

  const app = await startApp(
    registerGameNewsRoutes,
    buildCtx({ GameNewsFeed, GameNewsModel }),
  );
  try {
    const res = await fetch(
      app.baseUrl + "/api/gamenews-status?guildId=" + GUILD,
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.items.length, 1);
    const item = body.items[0];
    assert.equal(item.lastError, "HTTP 500");
    assert.equal(item.failCount, 2);
    assert.deepEqual(item.sentHistory, [{ day: "2026-01-01", count: 3 }]);
    assert.equal(item.lastHashesCount, 2);
  } finally {
    await stopApp(app.server);
  }
});
