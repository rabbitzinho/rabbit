const { test, eq } = require("./_harness");
const {
  PRIMARY_BOT_OWNER_ID,
  getBotOwnerId,
  isGuildAdministrator,
  isBotOwner,
  isGlobalBotOwner,
} = require("../../src/dashboard/botRoles");

test("BOT_OWNER_IDS selects one configured global owner", () => {
  eq(
    getBotOwnerId("invalid;234567890123456789,345678901234567890"),
    "234567890123456789",
  );
});

test("guild administrator detection accepts owner and Discord Administrator permission", () => {
  eq(isGuildAdministrator({ owner: true, permissions: "0" }), true);
  eq(isGuildAdministrator({ owner: false, permissions: "8" }), true);
  eq(isGuildAdministrator({ owner: false, permissions: "0" }), false);
  eq(isGuildAdministrator({ owner: false, permissions: "invalid" }), false);
});

test("primary bot owner is the fallback when BOT_OWNER_IDS is invalid", () => {
  eq(getBotOwnerId("invalid"), PRIMARY_BOT_OWNER_ID);
});

test("only the bot owner has global privileges", () => {
  eq(isBotOwner({ role: "BOT_OWNER" }), true);
  eq(isBotOwner({ role: "BOT_ADMIN" }), false);
  eq(isBotOwner({ role: "GUILD_ADMIN" }), false);
  eq(
    isGlobalBotOwner({
      role: "BOT_OWNER",
      selectedGuildId: null,
      profile: "UNSCOPED",
      guildScopeVersion: 2,
    }),
    true,
  );
  eq(
    isGlobalBotOwner({
      role: "BOT_OWNER",
      selectedGuildId: "123456789012345678",
      profile: "BOT_OWNER",
      guildScopeVersion: 2,
    }),
    false,
  );
  eq(isGlobalBotOwner({ role: "BOT_OWNER", profile: "UNSCOPED" }), false);
});
