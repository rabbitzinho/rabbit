const { test, eq } = require("./_harness");
const {
  buildBannedWordMatchers,
  evaluateAutoModeration,
  normalizeAutoModerationConfig,
  shouldBypassAutoModeration,
} = require("../../src/systems/autoModeration");

test("autoModeration matches configured words case-insensitively after normalization", () => {
  const result = evaluateAutoModeration(
    "This contains a TEST PHRASE.",
    { bannedWordsEn: "test phrase", bannedWordsPt: "" },
    "automod-normalize",
  );

  eq(result.matchedWord, "test phrase");
});

test("autoModeration treats special characters as literal configured text", () => {
  const result = evaluateAutoModeration(
    "badXXXword should not match",
    { bannedWordsEn: "bad*word", bannedWordsPt: "" },
    "automod-literal",
  );

  eq(result.matchedWord, null);
  eq(buildBannedWordMatchers({ bannedWordsEn: "bad*word" }).length, 1);
});

test("autoModeration does not inherit global thresholds or words", () => {
  const config = normalizeAutoModerationConfig({});

  eq(config.maxWarnings, 3);
  eq(config.muteDuration, 10 * 60_000);
  eq(config.bannedWords.pt.length, 0);
  eq(config.bannedWords.en.length, 0);
  eq(config.bypassRoleIds.length, 0);
  eq(config.bypassChannelIds.length, 0);
});

test("autoModeration bypasses configured channels before evaluating messages", () => {
  const config = normalizeAutoModerationConfig({
    bypassChannelIds: ["123456789012345678"],
  });
  const message = {
    channel: { id: "123456789012345678" },
    member: { roles: { cache: new Map() } },
  };

  eq(shouldBypassAutoModeration(message, config), true);
});

test("autoModeration bypasses configured roles and normalizes invalid IDs", () => {
  const config = normalizeAutoModerationConfig({
    bypassRoleIds: ["987654321098765432", "invalid", "987654321098765432"],
  });
  const message = {
    channel: { id: "111111111111111111" },
    member: {
      roles: {
        cache: new Map([["987654321098765432", { id: "987654321098765432" }]]),
      },
    },
  };

  eq(config.bypassRoleIds.length, 1);
  eq(shouldBypassAutoModeration(message, config), true);
});

test("autoModeration does not bypass members without a configured exception", () => {
  const config = normalizeAutoModerationConfig({});
  const message = {
    channel: { id: "111111111111111111" },
    member: { roles: { cache: new Map() } },
  };

  eq(shouldBypassAutoModeration(message, config), false);
});
