// src/slash/help.js

const config = require("../config/defaultConfig");
const { tContext } = require("../systems/i18n");
const { replyEphemeral } = require("../utils/discord");
const { safeReply } = require("../utils/discord");

module.exports = async function helpSlash(_client, interaction) {
  try {
    const guild = interaction.guild;
    const member = interaction.member;

    if (!guild || !member) {
      return replyEphemeral(
        interaction,
        await tContext(interaction, "common.guildOnly"),
      );
    }

    const { canUseTicketOrHelp } = require("./utils");
    const canUse = await canUseTicketOrHelp(member).catch(() => false);
    if (!canUse) {
      return replyEphemeral(
        interaction,
        await tContext(interaction, "common.noPermission"),
      );
    }

    const prefix = config.prefix || "!";
    const lines = [];

    lines.push(`**${await tContext(interaction, "help.title")}**`);
    lines.push("");

    lines.push(`__${await tContext(interaction, "help.moderationTitle")}__`);
    lines.push(...(await tContext(interaction, "help.moderation", prefix)));
    lines.push("");

    lines.push(`__${await tContext(interaction, "help.automodTitle")}__`);
    lines.push(...(await tContext(interaction, "help.automod")));
    lines.push("");

    lines.push(`__${await tContext(interaction, "help.gameNewsTitle")}__`);
    lines.push(...(await tContext(interaction, "help.gameNews")));
    lines.push("");

    lines.push(`__${await tContext(interaction, "help.dashboardTitle")}__`);
    lines.push(...(await tContext(interaction, "help.dashboard")));
    lines.push("");

    lines.push(await tContext(interaction, "help.footer", prefix));

    await replyEphemeral(interaction, lines.join("\n"));
  } catch (err) {
    console.error("[slash/help] Error:", err);
    return safeReply(
      interaction,
      { content: await tContext(interaction, "common.unexpectedError") },
      { ephemeral: true },
    );
  }
};
