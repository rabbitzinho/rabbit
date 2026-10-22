const PRIMARY_BOT_OWNER_ID = "810243963574550558";

function getBotOwnerId(value) {
  const ownerId = String(value || "")
    .split(/[\s,;]+/)
    .map((id) => id.trim())
    .find((id) => /^\d{10,32}$/.test(id));
  return ownerId || PRIMARY_BOT_OWNER_ID;
}

function isGuildAdministrator(guild) {
  if (!guild) return false;
  if (guild.owner === true) return true;
  try {
    return (BigInt(String(guild.permissions || "0")) & 8n) === 8n;
  } catch {
    return false;
  }
}

function isBotOwner(user) {
  return Boolean(user && user.role === "BOT_OWNER");
}

function isGlobalBotOwner(user) {
  return Boolean(
    isBotOwner(user) &&
    !user.selectedGuildId &&
    user.profile === "UNSCOPED" &&
    user.guildScopeVersion === 2,
  );
}

module.exports = {
  PRIMARY_BOT_OWNER_ID,
  getBotOwnerId,
  isGuildAdministrator,
  isBotOwner,
  isGlobalBotOwner,
};
