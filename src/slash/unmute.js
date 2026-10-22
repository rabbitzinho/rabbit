// src/slash/unmute.js

const { PermissionsBitField } = require("discord.js");

const logger = require("../systems/logger");
const warningsService = require("../systems/warningsService");
const { tContext } = require("../systems/i18n");
const { isStaff } = require("./utils");
const { replyEphemeral, safeReply } = require("../utils/discord");
const { ensureUnmutePermissions } = require("../utils/modPermissions");

module.exports = async function unmuteSlash(client, interaction) {
  try {
    if (!interaction?.guild) return;

    const guild = interaction.guild;
    const executor = interaction.member;
    const botMember = guild.members.me;

    if (!executor || !botMember) {
      return replyEphemeral(
        interaction,
        await tContext(interaction, "common.unexpectedError"),
      );
    }

    if (!(await isStaff(executor, "moderation"))) {
      return replyEphemeral(
        interaction,
        await tContext(interaction, "common.noPermission"),
      );
    }

    const channelPerms = interaction.channel?.permissionsFor?.(botMember);
    if (!channelPerms?.has(PermissionsBitField.Flags.ModerateMembers)) {
      return replyEphemeral(
        interaction,
        await tContext(
          interaction,
          "common.missingBotPerm",
          "Moderate Members",
        ),
      );
    }

    const targetUser = interaction.options.getUser("user", true);
    const target = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!target) {
      return replyEphemeral(
        interaction,
        await tContext(interaction, "common.cannotResolveUser"),
      );
    }

    const canProceed = await ensureUnmutePermissions({
      client,
      interaction,
      executor,
      target,
      botMember,
    });
    if (!canProceed) return;

    if (
      typeof target.isCommunicationDisabled === "function" &&
      !target.isCommunicationDisabled()
    ) {
      return replyEphemeral(
        interaction,
        await tContext(interaction, "unmute.notMuted", {
          tag: target.user.tag,
        }),
      );
    }

    await target.timeout(null, `Unmuted by ${interaction.user.tag}`);

    // Resposta pública (default)
    await interaction
      .reply({
        content: await tContext(interaction, "unmute.success", {
          tag: target.user.tag,
        }),
      })
      .catch(() => null);

    let dbUser = null;
    try {
      dbUser = await warningsService.getOrCreateUser(guild.id, target.id);
    } catch {
      // ignore
    }

    await logger(
      client,
      "Slash Unmute",
      target.user,
      interaction.user,
      await tContext(interaction, "log.actions.manualUnmute", {
        warnings: dbUser?.warnings ?? 0,
        trust: dbUser?.trust ?? "N/A",
      }),
      guild,
    );
  } catch (err) {
    console.error("[slash/unmute] Error:", err);
    return safeReply(
      interaction,
      { content: await tContext(interaction, "unmute.failed") },
      { ephemeral: true },
    );
  }
};
