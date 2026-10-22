// src/events/messageReactionAdd.js

const {
  handleTicketOpen,
  handleTicketClose,
  OPEN_EMOJI,
  CLOSE_EMOJI,
} = require("../systems/ticketThreads");

const { getFeature } = require("../systems/featuresService");
const { emojiMatches } = require("../systems/reactionRoles");

let starboard = null;
try {
  starboard = require("../systems/starboard");
} catch (err) {
  console.warn(
    "[messageReactionAdd] starboard system not available:",
    err?.message || err,
  );
}

/**
 * Atribui cargos por reação (feature opcional "reactionRoles").
 * @param {import('discord.js').MessageReaction} reaction
 * @param {import('discord.js').User} user
 */
async function handleReactionRoles(reaction, user) {
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
      await member.roles.add(entry.roleId, "Reaction role");
    } catch (err) {
      console.error("[messageReactionAdd] Failed to add reaction role:", err);
    }
  }
}

module.exports = (client) => {
  client.on("messageReactionAdd", async (reaction, user) => {
    try {
      if (!reaction || !reaction.message) return;
      if (user && user.bot) return;

      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (err) {
          console.warn(
            "[messageReactionAdd] Failed to fetch partial reaction:",
            err,
          );
          return;
        }
      }

      if (reaction.message.partial) {
        try {
          await reaction.message.fetch();
        } catch (err) {
          console.warn(
            "[messageReactionAdd] Failed to fetch partial message:",
            err,
          );
          return;
        }
      }

      const emojiName = reaction.emoji.name || reaction.emoji.id;
      if (!emojiName) return;
      const ticketCfg = reaction.message.guild
        ? await getFeature(reaction.message.guild.id, "tickets").catch(
            () => null,
          )
        : null;

      // Abrir ticket: reação no canal configurado com o emoji de abertura
      if (
        ticketCfg &&
        ticketCfg.enabled === true &&
        emojiMatches(ticketCfg.openEmoji || OPEN_EMOJI, reaction.emoji)
      ) {
        const matchesMessage =
          ticketCfg.messageId && reaction.message.id === ticketCfg.messageId;
        const matchesLegacyChannel =
          !ticketCfg.messageId &&
          ticketCfg.channelId &&
          reaction.message.channelId === ticketCfg.channelId;
        if (matchesMessage || matchesLegacyChannel) {
          const opened = await handleTicketOpen(reaction, user);

          // Remover a reação do utilizador após criar o ticket,
          // para que possa abrir um novo ticket com um único clique da próxima vez.
          if (opened) {
            try {
              await reaction.users.remove(user.id);
            } catch (err) {
              console.error(
                "[messageReactionAdd] Failed to remove user reaction after creating ticket:",
                err,
              );
            }
          }
          return;
        }
      }

      // Fechar ticket: reação dentro da thread no emoji de fecho
      if (
        (!ticketCfg && emojiName === CLOSE_EMOJI) ||
        (ticketCfg &&
          emojiMatches(ticketCfg.closeEmoji || CLOSE_EMOJI, reaction.emoji))
      ) {
        const closed = await handleTicketClose(reaction, user);
        if (closed) return;
      }

      // Cargos por reação (feature opcional "reactionRoles")
      try {
        await handleReactionRoles(reaction, user);
      } catch (err) {
        console.error("[messageReactionAdd] reaction roles error:", err);
      }

      // Starboard (feature opcional)
      if (starboard && typeof starboard.handleReactionAdd === "function") {
        try {
          await starboard.handleReactionAdd(reaction, user);
        } catch (err) {
          console.error("[messageReactionAdd] starboard error:", err);
        }
      }
    } catch (err) {
      console.error("[messageReactionAdd] Error:", err);
    }
  });
};
