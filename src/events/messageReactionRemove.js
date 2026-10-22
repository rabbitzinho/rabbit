// src/events/messageReactionRemove.js
//
// Remove cargos por reação e atualiza o starboard quando uma reação é retirada.

const { getFeature } = require("../systems/featuresService");
const { emojiMatches } = require("../systems/reactionRoles");

let starboard = null;
try {
  starboard = require("../systems/starboard");
} catch (err) {
  console.warn(
    "[messageReactionRemove] starboard system not available:",
    err?.message || err,
  );
}

/**
 * Remove o cargo correspondente à reação (feature "reactionRoles").
 */
async function handleReactionRolesRemove(reaction, user) {
  const message = reaction.message;
  const guild = message?.guild;
  if (!guild || !user) return;

  const cfg = await getFeature(guild.id, "reactionRoles");
  if (cfg?.enabled !== true) return;

  const matchesMessage = cfg.messageId && message.id === cfg.messageId;
  const matchesChannel = cfg.channelId && message.channelId === cfg.channelId;
  if (!matchesMessage && !matchesChannel) return;

  const entries = Array.isArray(cfg.entries) ? cfg.entries : [];
  if (!entries.length) return;

  for (const entry of entries) {
    if (!entry?.roleId || !entry?.emoji) continue;
    if (!emojiMatches(entry.emoji, reaction.emoji)) continue;

    try {
      const member =
        message.guild.members.cache.get(user.id) ||
        (await message.guild.members.fetch(user.id).catch(() => null));
      if (!member) continue;
      await member.roles.remove(entry.roleId, "Reaction role");
    } catch (err) {
      console.error(
        "[messageReactionRemove] Failed to remove reaction role:",
        err,
      );
    }
  }
}

module.exports = (client) => {
  client.on("messageReactionRemove", async (reaction, user) => {
    try {
      if (!reaction || !reaction.message) return;
      if (user && user.bot) return;

      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch {
          return;
        }
      }

      if (reaction.message.partial) {
        try {
          await reaction.message.fetch();
        } catch {
          return;
        }
      }

      const emojiName = reaction.emoji.name || reaction.emoji.id;
      if (!emojiName) return;

      try {
        await handleReactionRolesRemove(reaction, user);
      } catch (err) {
        console.error("[messageReactionRemove] reaction roles error:", err);
      }

      if (starboard && typeof starboard.handleReactionRemove === "function") {
        try {
          await starboard.handleReactionRemove(reaction, user);
        } catch (err) {
          console.error("[messageReactionRemove] starboard error:", err);
        }
      }
    } catch (err) {
      console.error("[messageReactionRemove] Error:", err);
    }
  });
};
