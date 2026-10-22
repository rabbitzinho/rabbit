// src/events/interactionCreate.js
//
// Central handler for all slash commands.

const config = require("../config/defaultConfig");
const { tGuild, tContext } = require("../systems/i18n");
const logger = require("../systems/logger");
const { getGuildConfig } = require("../systems/guildConfigService");
const { isStaff } = require("../utils/staff");
const { safeReply } = require("../utils/discord");
const { getBotOwnerId } = require("../dashboard/botRoles");

const warnSlash = require("../slash/warn");
const muteSlash = require("../slash/mute");
const memberActionSlash = require("../slash/memberAction");
const unbanSlash = require("../slash/unban");
const unmuteSlash = require("../slash/unmute");
const clearSlash = require("../slash/clear");
const userinfoSlash = require("../slash/userinfo");
const historySlash = require("../slash/history");
const helpSlash = require("../slash/help");
const pollSlash = require("../slash/poll");
const rankSlash = require("../slash/rank");
const leaderboardSlash = require("../slash/leaderboard");

const { getFeature } = require("../systems/featuresService");

let Poll = null;
try {
  Poll = require("../database/models/Poll");
} catch (err) {
  console.warn(
    "[interactionCreate] Poll model not available:",
    err?.message || err,
  );
}

// Simple command registry instead of a long if/else chain
const commandHandlers = new Map([
  ["warn", warnSlash],
  ["mute", muteSlash],
  ["kick", memberActionSlash("KICK")],
  ["ban", memberActionSlash("BAN")],
  ["unban", unbanSlash],
  ["unmute", unmuteSlash],
  ["clear", clearSlash],
  ["userinfo", userinfoSlash],
  ["history", historySlash],
  ["help", helpSlash],
  ["poll", pollSlash],
  ["rank", rankSlash],
  ["leaderboard", leaderboardSlash],
]);

// Botão de verificação: "verify:<roleId>"
async function handleVerifyButton(interaction, roleId) {
  try {
    if (!interaction.guild || !roleId) return;

    const cfg = await getFeature(interaction.guild.id, "verification");
    if (cfg?.enabled !== true) {
      return safeReply(
        interaction,
        { content: await tGuild(interaction.guild.id, "verify.disabled") },
        { ephemeral: true },
      );
    }

    const member =
      interaction.member ||
      (await interaction.guild.members
        .fetch(interaction.user.id)
        .catch(() => null));
    if (!member) {
      return safeReply(
        interaction,
        {
          content: await tGuild(
            interaction.guild.id,
            "common.cannotResolveUser",
          ),
        },
        { ephemeral: true },
      );
    }

    const role =
      interaction.guild.roles.cache.get(roleId) ||
      (await interaction.guild.roles.fetch(roleId).catch(() => null));
    if (!role) {
      return safeReply(
        interaction,
        { content: await tGuild(interaction.guild.id, "verify.disabled") },
        { ephemeral: true },
      );
    }

    await member.roles.add(role, "Verificação").catch(() => null);
    return safeReply(
      interaction,
      { content: await tGuild(interaction.guild.id, "verify.success") },
      { ephemeral: true },
    );
  } catch (err) {
    console.error("[interactionCreate] verify button error:", err);
    return safeReply(
      interaction,
      { content: await tGuild(interaction.guild.id, "common.unexpectedError") },
      { ephemeral: true },
    );
  }
}

// Botão de poll: "poll:<pollId>:<index>"
async function handlePollButton(interaction, customId) {
  try {
    if (!Poll) {
      return safeReply(
        interaction,
        { content: await tContext(interaction, "common.unexpectedError") },
        { ephemeral: true },
      );
    }

    const parts = String(customId).split(":");
    const pollId = parts[1];
    const index = parseInt(parts[2], 10);
    if (!pollId || !Number.isFinite(index)) return;

    const poll = await Poll.findById(pollId).catch(() => null);
    if (!poll || poll.closed) {
      return safeReply(
        interaction,
        { content: await tContext(interaction, "poll.disabled") },
        { ephemeral: true },
      );
    }

    const optionCount = Array.isArray(poll.options) ? poll.options.length : 0;
    if (index < 0 || index >= optionCount) return;

    const userId = interaction.user.id;
    const counts =
      Array.isArray(poll.counts) && poll.counts.length === optionCount
        ? poll.counts.map((n) => Number(n) || 0)
        : new Array(optionCount).fill(0);

    const prev = poll.votes ? poll.votes.get(userId) : undefined;

    // Sem voto duplicado: se já votou, remove o voto anterior antes de registar o novo.
    if (prev !== undefined && prev !== null && Number(prev) !== index) {
      const p = Number(prev);
      if (p >= 0 && p < counts.length) counts[p] = Math.max(0, counts[p] - 1);
    }

    if (Number(prev) !== index) {
      counts[index] = (counts[index] || 0) + 1;
      if (!poll.votes) poll.votes = new Map();
      poll.votes.set(userId, index);
    }

    poll.counts = counts;
    await poll.save().catch(() => null);

    // Atualiza a mensagem do poll, se possível.
    try {
      if (interaction.guild && poll.channelId) {
        const channel =
          interaction.guild.channels.cache.get(poll.channelId) ||
          (await interaction.guild.channels
            .fetch(poll.channelId)
            .catch(() => null));
        const msg =
          channel && poll.messageId
            ? await channel.messages.fetch(poll.messageId).catch(() => null)
            : null;
        if (msg && typeof pollSlash.buildPollMessage === "function") {
          await msg.edit(pollSlash.buildPollMessage(poll)).catch(() => null);
        }
      }
    } catch (err) {
      console.error("[interactionCreate] Failed to refresh poll message:", err);
    }

    return safeReply(
      interaction,
      { content: await tContext(interaction, "poll.voted") },
      { ephemeral: true },
    );
  } catch (err) {
    console.error("[interactionCreate] poll button error:", err);
    return safeReply(
      interaction,
      { content: await tContext(interaction, "common.unexpectedError") },
      { ephemeral: true },
    );
  }
}

// Tratamento de botões (verificação / polls) antes dos slash commands.
async function handleButton(interaction) {
  const id = String(interaction.customId || "");
  if (id.startsWith("verify:")) {
    return handleVerifyButton(interaction, id.slice("verify:".length));
  }
  if (id.startsWith("poll:")) {
    return handlePollButton(interaction, id);
  }
  return null;
}

module.exports = (client) => {
  client.on("interactionCreate", async (interaction) => {
    try {
      // Botões (verificação / polls) são componentes independentes dos slash commands.
      if (interaction?.isButton?.()) {
        return handleButton(interaction);
      }

      if (!config.slash?.enabled) return;
      if (!interaction?.isChatInputCommand?.()) return;

      const name = interaction.commandName;

      // Apply bot-wide maintenance before the optional per-guild restriction.
      try {
        const guildId = interaction.guildId;
        if (guildId) {
          const globalMaintenance = config.globalMaintenance || {};
          const isBotOwner =
            String(interaction.user && interaction.user.id) ===
            getBotOwnerId(process.env.BOT_OWNER_IDS);
          if (globalMaintenance.enabled === true && !isBotOwner) {
            const allowed =
              globalMaintenance.allowStaff !== false &&
              (await isStaff(interaction.member));
            if (!allowed) {
              const message =
                typeof globalMaintenance.message === "string" &&
                globalMaintenance.message.trim()
                  ? globalMaintenance.message.trim()
                  : await tContext(interaction, "common.maintenance");
              await safeReply(
                interaction,
                { content: message },
                { ephemeral: true },
              );
              return;
            }
          }

          const guildCfg = await getGuildConfig(guildId);
          const mm =
            guildCfg && guildCfg.maintenanceMode
              ? guildCfg.maintenanceMode
              : null;
          if (mm && mm.enabled === true) {
            const allowStaff = mm.allowStaff !== false;
            const ok = allowStaff ? await isStaff(interaction.member) : false;
            if (!ok) {
              const msg =
                typeof mm.message === "string" && mm.message.trim()
                  ? mm.message.trim()
                  : await tContext(interaction, "common.maintenance");
              await safeReply(
                interaction,
                { content: msg },
                { ephemeral: true },
              );
              return;
            }
          }
        }
      } catch {
        // If anything fails, do not block the command.
      }

      // Log all slash commands to the moderation log + dashboard
      try {
        const user = interaction.user;
        const guild = interaction.guild;
        const rawOptions =
          (interaction.options && interaction.options.data) || [];
        const optStr = rawOptions
          .map((opt) => {
            const v = opt.value;
            return `${opt.name}=${typeof v === "string" ? v : (v ?? "")}`;
          })
          .join(", ");

        const desc = optStr ? `Options: ${optStr}` : "";

        logger(
          client,
          `Slash command: /${name}`,
          user,
          client.user,
          desc,
          guild,
        );
      } catch (logErr) {
        console.warn(
          "[interactionCreate] Failed to log slash command:",
          logErr,
        );
      }

      const handler = commandHandlers.get(name);
      if (!handler) return;

      return handler(client, interaction);
    } catch (err) {
      console.error("[interactionCreate] Error:", err);
      try {
        await safeReply(
          interaction,
          { content: await tContext(interaction, "common.unexpectedError") },
          { ephemeral: true },
        );
      } catch {
        // ignore
      }
    }
  });
};
