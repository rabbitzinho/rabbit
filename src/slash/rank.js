// src/slash/rank.js

const { EmbedBuilder } = require("discord.js");
const { tContext } = require("../systems/i18n");
const { getFeature } = require("../systems/featuresService");
const { getRank } = require("../systems/levels");
const { safeReply } = require("../utils/discord");

module.exports = async function rankSlash(_client, interaction) {
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

    const targetUser = interaction.options.getUser("user") || interaction.user;
    const data = await getRank(interaction.guild.id, targetUser.id);
    if (!data || data.rank == null) {
      return safeReply(
        interaction,
        { content: await tContext(interaction, "rank.notFound") },
        { ephemeral: true },
      );
    }

    const embed = new EmbedBuilder()
      .setTitle(
        await tContext(interaction, "rank.title", {
          tag: targetUser.tag || targetUser.username,
        }),
      )
      .setColor("Green")
      .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
      .addFields(
        {
          name: await tContext(interaction, "rank.fieldLevel"),
          value: String(data.level),
          inline: true,
        },
        {
          name: await tContext(interaction, "rank.fieldXp"),
          value: String(data.xp),
          inline: true,
        },
        {
          name: await tContext(interaction, "rank.fieldMessages"),
          value: String(data.messages),
          inline: true,
        },
        {
          name: await tContext(interaction, "rank.fieldPosition"),
          value: `#${data.rank}`,
          inline: true,
        },
      )
      .setTimestamp(new Date());

    return interaction.reply({ embeds: [embed] }).catch(() => null);
  } catch (err) {
    console.error("[slash/rank] Error:", err);
    return safeReply(
      interaction,
      { content: await tContext(interaction, "common.unexpectedError") },
      { ephemeral: true },
    );
  }
};
