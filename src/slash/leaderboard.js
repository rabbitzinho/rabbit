// src/slash/leaderboard.js

const { EmbedBuilder } = require("discord.js");
const { tContext } = require("../systems/i18n");
const { getFeature } = require("../systems/featuresService");
const { safeReply } = require("../utils/discord");

let Level = null;
try {
  Level = require("../database/models/Level");
} catch (err) {
  console.warn(
    "[slash/leaderboard] Level model not available:",
    err?.message || err,
  );
}

module.exports = async function leaderboardSlash(_client, interaction) {
  try {
    if (!interaction?.guild) return;

    const cfg = await getFeature(interaction.guild.id, "levels");
    if (cfg?.enabled !== true) {
      return safeReply(
        interaction,
        { content: await tContext(interaction, "levels.disabled") },
        { ephemeral: true },
      );
    }

    if (!Level) {
      return safeReply(
        interaction,
        { content: await tContext(interaction, "common.unexpectedError") },
        { ephemeral: true },
      );
    }

    const limitRaw = interaction.options.getInteger("limit");
    const limit = Math.min(Math.max(Number(limitRaw) || 10, 1), 25);

    const rows = await Level.find({ guildId: interaction.guild.id })
      .sort({ xp: -1 })
      .limit(limit)
      .lean()
      .catch(() => []);

    if (!rows || !rows.length) {
      return safeReply(
        interaction,
        { content: await tContext(interaction, "leaderboard.empty") },
        { ephemeral: true },
      );
    }

    const lines = rows.map(
      (r, i) =>
        `**${i + 1}.** <@${r.userId}> — \`${Number(r.level) || 0}\` lvl • **${Number(r.xp) || 0}** XP`,
    );

    const embed = new EmbedBuilder()
      .setTitle(await tContext(interaction, "leaderboard.title"))
      .setColor("Gold")
      .setDescription(lines.join("\n"))
      .setTimestamp(new Date());

    return interaction.reply({ embeds: [embed] }).catch(() => null);
  } catch (err) {
    console.error("[slash/leaderboard] Error:", err);
    return safeReply(
      interaction,
      { content: await tContext(interaction, "common.unexpectedError") },
      { ephemeral: true },
    );
  }
};
