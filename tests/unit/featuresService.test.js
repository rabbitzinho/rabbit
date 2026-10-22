const { test, eq } = require("./_harness");
const {
  FEATURE_DEFAULTS,
  normalizeFeature,
} = require("../../src/systems/featuresService");
const { resolveGuildAntiSpamConfig } = require("../../src/systems/antiSpam");

test("serverStats keeps all metrics enabled for existing guild configs", () => {
  const feature = normalizeFeature("serverStats", { enabled: true });
  eq(feature.showMembers, true);
  eq(feature.showJoins, true);
  eq(feature.showLeaves, true);
});

test("serverStats preserves independently disabled metrics", () => {
  const feature = normalizeFeature("serverStats", {
    showMembers: true,
    showJoins: false,
    showLeaves: false,
  });
  eq(feature.showMembers, true);
  eq(feature.showJoins, false);
  eq(feature.showLeaves, false);
});

test("antiSpam is disabled until configured for a guild", () => {
  const feature = normalizeFeature("antiSpam", null);
  eq(feature.enabled, false);
  eq(feature.maxMessages, 5);
  eq(feature.intervalSeconds, 10);
});

test("antiSpam normalizes guild overrides and converts units at runtime", () => {
  const feature = normalizeFeature("antiSpam", {
    enabled: true,
    maxMessages: 4,
    intervalSeconds: 20,
    muteDurationMinutes: 8,
    actionCooldownSeconds: 30,
    softActionsEnabled: false,
    strikeWindowSeconds: 90,
    strikesToMute: 3,
    minLength: 4,
    similarityThreshold: 0.9,
    ignoreAttachments: false,
    bypassAdmins: true,
    sendMessage: false,
  });
  const runtime = resolveGuildAntiSpamConfig(feature);

  eq(runtime.enabled, true);
  eq(runtime.maxMessages, 4);
  eq(runtime.interval, 20_000);
  eq(runtime.muteDuration, 8 * 60_000);
  eq(runtime.actionCooldown, 30_000);
  eq(runtime.softActions.enabled, false);
  eq(runtime.softActions.strikeWindowMs, 90_000);
  eq(runtime.softActions.strikesToMute, 3);
  eq(Object.keys(runtime.channels).length, 0);
  eq(runtime.bypassRoles.length, 0);
});

test("antiSpam defaults are independent of global activation", () => {
  eq(FEATURE_DEFAULTS.antiSpam.enabled, false);
  eq(FEATURE_DEFAULTS.antiSpam.similarityThreshold, 0.85);
});

test("antiSpam partial overrides retain local defaults without activation", () => {
  const feature = normalizeFeature("antiSpam", {
    maxMessages: 7,
    enabled: null,
    similarityThreshold: null,
  });

  eq(feature.enabled, false);
  eq(feature.maxMessages, 7);
  eq(feature.similarityThreshold, 0.85);
});

test("autoModeration is disabled with no inherited global word lists", () => {
  const feature = normalizeFeature("autoModeration", null);
  eq(feature.enabled, false);
  eq(feature.maxWarnings, 3);
  eq(feature.muteDurationMinutes, 10);
  eq(feature.bannedWordsPt, "");
  eq(feature.bannedWordsEn, "");
});
