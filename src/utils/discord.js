// src/utils/discord.js
//
// Helpers for safely replying to interactions (handles deferred/replied)
// and for consistent ephemeral replies.

const { MessageFlags } = require("discord.js");

/**
 * Safely reply or follow up to an interaction.
 * - If the interaction was already replied/deferred, uses followUp
 * - Otherwise uses reply
 * - Swallows network/Discord errors to avoid crashing the handler
 *
 * @param {impor'discord.js'.Interaction} interaction
 * @param {impor'discord.js'.InteractionReplyOptions|impor'discord.js'.MessagePayload|Object} payload
 * @param {{ ephemeral?: boolean }} [options]
 */
function safeReply(interaction, payload = {}, options = {}) {
  const { ephemeral = false } = options || {};

  if (!interaction) return null;

  const finalPayload = {
    ...payload,
  };

  if (ephemeral) {
    // Default to Ephemeral if not explicitly set
    if (finalPayload.flags == null) {
      finalPayload.flags = MessageFlags.Ephemeral;
    }
  }

  try {
    if (interaction.deferred || interaction.replied) {
      return interaction.followUp(finalPayload).catch(() => null);
    }

    return interaction.reply(finalPayload).catch(() => null);
  } catch {
    return null;
  }
}

/**
 * Convenience helper for common "ephemeral only" replies
 */
function replyEphemeral(interaction, content) {
  const payload = typeof content === "string" ? { content } : content || {};
  return safeReply(interaction, payload, { ephemeral: true });
}

module.exports = {
  safeReply,
  replyEphemeral,
};
