const test = require("node:test");
const assert = require("node:assert/strict");
const {
  registerFeaturesRoutes,
} = require("../../src/dashboard/routes/features");
const { startApp, stopApp, passthrough, sanitizeId } = require("./_helpers");

test("feature updates are recorded without including custom message content", async () => {
  let auditEntry = null;
  const app = await startApp(registerFeaturesRoutes, {
    requireDashboardAuth(req, res, next) {
      req.dashboardUser = { username: "guild-admin" };
      next();
    },
    requirePerm: () => passthrough,
    requireGuildAccess: () => passthrough,
    sanitizeId,
    GuildConfig: {
      findOneAndUpdate() {
        return { lean: async () => ({}) };
      },
    },
    getClient: () => null,
    getActorFromRequest: (req) => req.dashboardUser.username,
    recordAudit: async (entry) => {
      auditEntry = entry;
    },
  });

  try {
    const response = await fetch(app.baseUrl + "/api/features", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "123456789012345678",
        feature: "welcome",
        value: { enabled: true, message: "custom welcome message" },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(auditEntry.action, "features.update");
    assert.equal(auditEntry.guildId, "123456789012345678");
    assert.equal(auditEntry.actor, "guild-admin");
    assert.deepEqual(auditEntry.payload, { feature: "welcome", enabled: true });
  } finally {
    await stopApp(app.server);
  }
});

test("feature loading distinguishes saved features from normalized defaults", async () => {
  const guildId = "123456789012345678";
  const app = await startApp(registerFeaturesRoutes, {
    requireDashboardAuth: passthrough,
    requirePerm: () => passthrough,
    requireGuildAccess: () => passthrough,
    sanitizeId,
    GuildConfig: {
      findOne() {
        return {
          lean: async () => ({
            guildId,
            ticketThreadChannelId: "22222",
            features: { welcome: { enabled: false, channelId: "11111" } },
          }),
        };
      },
    },
  });

  try {
    const response = await fetch(
      app.baseUrl + "/api/features?guildId=" + guildId,
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.configuredFeatures.welcome, true);
    assert.equal(result.configuredFeatures.messageLogs, false);
    assert.equal(result.configuredFeatures.antiSpam, false);
    assert.equal(result.configuredFeatures.tickets, false);
    assert.equal(result.features.welcome.enabled, false);
    assert.equal(result.features.tickets.enabled, false);
    assert.equal(result.features.tickets.channelId, null);
    assert.equal(
      result.features.antiSpam.intervalSeconds,
      Math.round(
        require("../../src/config/defaultConfig").antiSpam.interval / 1000,
      ),
    );
  } finally {
    await stopApp(app.server);
  }
});

test("antiSpam feature updates are clamped and saved per server", async () => {
  let update;
  const app = await startApp(registerFeaturesRoutes, {
    requireDashboardAuth: passthrough,
    requirePerm: () => passthrough,
    requireGuildAccess: () => passthrough,
    sanitizeId,
    GuildConfig: {
      findOneAndUpdate(filter, value) {
        update = { filter, value };
        return { lean: async () => ({}) };
      },
    },
    getClient: () => null,
  });

  try {
    const response = await fetch(app.baseUrl + "/api/features", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "123456789012345678",
        feature: "antiSpam",
        value: {
          enabled: true,
          maxMessages: 1,
          intervalSeconds: 500,
          muteDurationMinutes: 0,
          similarityThreshold: 2,
          softActionsEnabled: true,
        },
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.value, {
      enabled: true,
      intervalSeconds: 120,
      maxMessages: 2,
      muteDurationMinutes: 1,
      actionCooldownSeconds: 120,
      softActionsEnabled: true,
      strikeWindowSeconds: 600,
      strikesToMute: 2,
      minLength: 6,
      similarityThreshold: 1,
      ignoreAttachments: true,
      bypassAdmins: true,
      sendMessage: true,
    });
    assert.equal(update.filter.guildId, "123456789012345678");
    assert.deepEqual(update.value.$addToSet.featuresConfigured, "antiSpam");
  } finally {
    await stopApp(app.server);
  }
});

test("AutoMod simulation uses the unsaved draft without persisting it", async () => {
  const guildId = "123456789012345678";
  let writes = 0;
  const app = await startApp(registerFeaturesRoutes, {
    requireDashboardAuth: passthrough,
    requirePerm: () => passthrough,
    requireGuildAccess: () => passthrough,
    sanitizeId,
    GuildConfig: {
      findOne: () => ({ lean: async () => ({ guildId, features: {} }) }),
      findOneAndUpdate: async () => {
        writes++;
      },
    },
    getClient: () => ({ guilds: { fetch: async () => ({ id: guildId }) } }),
  });

  try {
    const response = await fetch(
      app.baseUrl + "/api/features/autoModeration/test",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          testMessage: "This sample contains a testphrase.",
          config: {
            enabled: true,
            maxWarnings: 4,
            muteDurationMinutes: 12,
            bannedWordsEn: "testphrase",
            bannedWordsPt: "",
          },
        }),
      },
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.info, "autoModerationMatched");
    assert.equal(result.data.word, "testphrase");
    assert.equal(writes, 0);
  } finally {
    await stopApp(app.server);
  }
});

test("AutoMod rules are deduplicated and bounded before persistence", async () => {
  let update;
  const app = await startApp(registerFeaturesRoutes, {
    requireDashboardAuth: passthrough,
    requirePerm: () => passthrough,
    requireGuildAccess: () => passthrough,
    sanitizeId,
    GuildConfig: {
      findOneAndUpdate(filter, value) {
        update = { filter, value };
        return { lean: async () => ({}) };
      },
    },
    getClient: () => null,
  });

  try {
    const response = await fetch(app.baseUrl + "/api/features", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "123456789012345678",
        feature: "autoModeration",
        value: {
          enabled: true,
          maxWarnings: 99,
          muteDurationMinutes: 0,
          bannedWordsPt: "Termo\ntermo\n" + "x".repeat(80),
          bannedWordsEn: "word",
          bypassRoleIds: [
            "222222222222222222",
            "invalid",
            "222222222222222222",
          ],
          bypassChannelIds: ["333333333333333333", "invalid"],
        },
      }),
    });
    assert.equal(response.status, 200);
    const { value } = await response.json();
    assert.equal(value.maxWarnings, 10);
    assert.equal(value.muteDurationMinutes, 1);
    assert.equal(value.bannedWordsPt, `Termo\n${"x".repeat(64)}`);
    assert.equal(value.bannedWordsEn, "word");
    assert.deepEqual(value.bypassRoleIds, ["222222222222222222"]);
    assert.deepEqual(value.bypassChannelIds, ["333333333333333333"]);
    assert.equal(update.value.$addToSet.featuresConfigured, "autoModeration");
  } finally {
    await stopApp(app.server);
  }
});

test("memes and Twitch feature updates are normalized before persistence", async () => {
  const updates = [];
  const app = await startApp(registerFeaturesRoutes, {
    requireDashboardAuth: passthrough,
    requirePerm: () => passthrough,
    requireGuildAccess: () => passthrough,
    sanitizeId,
    GuildConfig: {
      findOneAndUpdate(filter, update) {
        updates.push({ filter, update });
        return { lean: async () => ({}) };
      },
    },
    getClient: () => null,
  });

  async function updateFeature(feature, value) {
    return fetch(app.baseUrl + "/api/features", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: "123456789012345678", feature, value }),
    });
  }

  try {
    const memesResponse = await updateFeature("memes", {
      enabled: true,
      channelId: "123456789012345678",
      intervalMinutes: 5,
    });
    assert.equal(memesResponse.status, 200);
    assert.deepEqual((await memesResponse.json()).value, {
      enabled: true,
      channelId: "123456789012345678",
      intervalMinutes: 15,
    });
    assert.equal(updates[0].update.$addToSet.featuresConfigured, "memes");

    const twitchResponse = await updateFeature("twitch", {
      enabled: true,
      streamerName: "@Example_Stream",
      channelId: "123456789012345678",
      roleId: "987654321098765432",
    });
    assert.equal(twitchResponse.status, 200);
    assert.deepEqual((await twitchResponse.json()).value, {
      enabled: true,
      streamerName: "example_stream",
      channelId: "123456789012345678",
      roleId: "987654321098765432",
    });
    assert.equal(updates[1].update.$addToSet.featuresConfigured, "twitch");
    assert.equal(updates.length, 2);
  } finally {
    await stopApp(app.server);
  }
});

test("feature diagnostics report missing setup and Discord permissions", async () => {
  const originalTwitchClientId = process.env.TWITCH_CLIENT_ID;
  const originalTwitchClientSecret = process.env.TWITCH_CLIENT_SECRET;
  delete process.env.TWITCH_CLIENT_ID;
  delete process.env.TWITCH_CLIENT_SECRET;
  const guildId = "123456789012345678";
  const config = {
    enabled: true,
    channelId: "987654321098765432",
    intervalMinutes: 60,
  };
  const channel = {
    guildId,
    permissionsFor: () => ({ has: () => false }),
  };
  const guild = {
    id: guildId,
    members: { me: { permissions: { has: () => true } } },
    roles: { cache: { get: () => null } },
  };
  const app = await startApp(registerFeaturesRoutes, {
    requireDashboardAuth: passthrough,
    requirePerm: () => passthrough,
    requireGuildAccess: () => passthrough,
    sanitizeId,
    GuildConfig: {
      findOne: () => ({
        lean: async () => ({
          features: {
            memes: config,
            autoModeration: {
              enabled: true,
              bannedWordsPt: "",
              bannedWordsEn: "",
            },
          },
        }),
      }),
    },
    getClient: () => ({
      guilds: { fetch: async () => guild },
      channels: { fetch: async () => channel },
    }),
  });

  try {
    const blockedResponse = await fetch(
      app.baseUrl + `/api/features/memes/diagnose?guildId=${guildId}`,
    );
    assert.equal(blockedResponse.status, 200);
    const blocked = (await blockedResponse.json()).diagnosis;
    assert.equal(blocked.status, "blocked");
    assert.ok(
      blocked.issues.some((issue) => issue.code === "permission_missing"),
    );

    const disabledResponse = await fetch(
      app.baseUrl + `/api/features/twitch/diagnose?guildId=${guildId}`,
    );
    assert.equal(disabledResponse.status, 200);
    const disabledTwitch = (await disabledResponse.json()).diagnosis;
    assert.equal(disabledTwitch.status, "disabled");
    assert.ok(
      disabledTwitch.issues.some((issue) => issue.code === "missing_streamer"),
    );
    assert.ok(
      disabledTwitch.issues.some(
        (issue) => issue.code === "missing_twitch_credentials",
      ),
    );

    const autoModerationResponse = await fetch(
      app.baseUrl + `/api/features/autoModeration/diagnose?guildId=${guildId}`,
    );
    assert.equal(autoModerationResponse.status, 200);
    const autoModeration = (await autoModerationResponse.json()).diagnosis;
    assert.equal(autoModeration.status, "incomplete");
    assert.ok(
      autoModeration.issues.some(
        (issue) => issue.code === "missing_automod_rules",
      ),
    );
  } finally {
    await stopApp(app.server);
    if (originalTwitchClientId === undefined)
      delete process.env.TWITCH_CLIENT_ID;
    else process.env.TWITCH_CLIENT_ID = originalTwitchClientId;
    if (originalTwitchClientSecret === undefined)
      delete process.env.TWITCH_CLIENT_SECRET;
    else process.env.TWITCH_CLIENT_SECRET = originalTwitchClientSecret;
  }
});
