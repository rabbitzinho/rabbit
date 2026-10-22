// src/slash/mute.js

const { PermissionsBitField } = require("discord.js");

const config = require("../config/defaultConfig");
const logger = require("../systems/logger");
const infractionsService = require("../systems/infractionsService");
const warningsService = require("../systems/warningsService");
const { tContext } = require("../systems/i18n");
const { isStaff } = require("./utils");
const { replyEphemeral, safeReply } = require("../utils/discord");
const { ensureMutePermissions } = require("../utils/modPermissions");
const { parseDuration, formatDuration } = require("../utils/time");

module.exports = async function muteSlash(client, interaction) {
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

    const canProceed = await ensureMutePermissions({
      client,
      interaction,
      executor,
      target,
      botMember,
    });
    if (!canProceed) return;

    const rawDuration = (
      interaction.options.getString("duration") || ""
    ).trim();
    const parsed = parseDuration(rawDuration);
    const durationMs = parsed || config.muteDuration || 10 * 60 * 1000;

    const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
    if (durationMs > MAX_TIMEOUT_MS) {
      return replyEphemeral(
        interaction,
        await tContext(interaction, "mute.maxDuration"),
      );
    }

    const reason =
      (interaction.options.getString("reason") || "").trim() ||
      (await tContext(interaction, "common.noReason"));

    await target.timeout(
      durationMs,
      `Muted by ${interaction.user.tag}: ${reason}`,
    );

    let dbUser = null;
    try {
      dbUser = await warningsService.applyMutePenalty(guild.id, target.id);
    } catch (e) {
      console.error("[slash/mute] warningsService error:", e);
    }

    await infractionsService
      .create({
        guild,
        user: target.user,
        moderator: interaction.user,
        type: "MUTE",
        reason,
        duration: durationMs,
      })
      .catch(() => null);

    await interaction
      .reply({
        content: await tContext(interaction, "mute.channelConfirm", {
          tag: target.user.tag,
          duration: formatDuration(durationMs),
          reason,
        }),
      })
      .catch(() => null);

    await logger(
      client,
      "Slash Mute",
      target.user,
      interaction.user,
      await tContext(interaction, "log.actions.manualMute", {
        duration: formatDuration(durationMs),
        reason,
        trust: dbUser?.trust ?? "N/A",
      }),
      guild,
    );
  } catch (err) {
    console.error("[slash/mute] Error:", err);
    return safeReply(
      interaction,
      { content: await tContext(interaction, "mute.failed") },
      { ephemeral: true },
    );
  }
};
