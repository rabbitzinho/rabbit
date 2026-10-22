const { PermissionsBitField } = require("discord.js");
const { executeMemberAction } = require("../services/moderationService");
const { tContext } = require("../systems/i18n");
const { isStaff } = require("../utils/staff");
const { replyEphemeral, safeReply } = require("../utils/discord");
const { parseDuration, formatDuration } = require("../utils/time");

module.exports = function createMemberActionSlash(action) {
  const normalizedAction = String(action || "").toUpperCase();
  if (normalizedAction !== "KICK" && normalizedAction !== "BAN") {
    throw new Error("Unsupported member moderation action");
  }

  return async function memberActionSlash(client, interaction) {
    try {
      const guild = interaction.guild;
      if (!guild) return;

      const executor = interaction.member;
      const botMember = guild.members.me;
      if (!executor || !botMember) {
        return replyEphemeral(
          interaction,
          await tContext(interaction, "common.unexpectedError"),
        );
      }

      if (!(await isStaff(executor, "moderation").catch(() => false))) {
        return replyEphemeral(
          interaction,
          await tContext(interaction, "common.noPermission"),
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

      if (target.id === interaction.user.id) {
        return replyEphemeral(
          interaction,
          await tContext(interaction, "memberAction.cannotSelf"),
        );
      }

      const executorIsAdmin = executor.permissions.has(
        PermissionsBitField.Flags.Administrator,
      );
      if (
        !executorIsAdmin &&
        target.roles.highest.position >= executor.roles.highest.position
      ) {
        return replyEphemeral(
          interaction,
          await tContext(interaction, "memberAction.roleHierarchyUser"),
        );
      }
      if (
        !executorIsAdmin &&
        target.permissions.has(PermissionsBitField.Flags.Administrator)
      ) {
        return replyEphemeral(
          interaction,
          await tContext(interaction, "memberAction.cannotAdmin"),
        );
      }

      const reason =
        (interaction.options.getString("reason") || "").trim() ||
        (await tContext(interaction, "common.noReason"));
      const rawDuration = interaction.options.getString("duration");
      let durationMs = null;
      if (normalizedAction === "BAN" && rawDuration) {
        durationMs = parseDuration(rawDuration.trim());
        if (
          !durationMs ||
          durationMs < 60_000 ||
          durationMs > 365 * 24 * 60 * 60 * 1000
        ) {
          return replyEphemeral(
            interaction,
            await tContext(interaction, "memberAction.invalidDuration"),
          );
        }
      }
      const result = await executeMemberAction({
        client,
        guildId: guild.id,
        userId: target.id,
        action: normalizedAction,
        reason,
        durationMs,
        executorId: interaction.user.id,
        executorMember: executor,
        allowAdminTarget: executorIsAdmin,
        actor: interaction.user.tag || interaction.user.username,
        source: "slash",
      });

      const responseKey =
        normalizedAction === "KICK"
          ? "memberAction.kicked"
          : "memberAction.banned";
      return interaction.reply({
        content: await tContext(interaction, responseKey, {
          tag: target.user.tag || target.user.username,
          caseId: result.infraction?.caseId,
          duration: durationMs ? formatDuration(durationMs) : null,
        }),
      });
    } catch (error) {
      console.error(`[slash/${normalizedAction.toLowerCase()}] Error:`, error);
      const key =
        error?.code === "CANNOT_MODERATE_SELF"
          ? "memberAction.cannotSelf"
          : error?.code === "CANNOT_MODERATE_ADMIN"
            ? "memberAction.cannotAdmin"
            : error?.code === "CANNOT_MODERATE_TARGET_ROLE"
              ? "memberAction.roleHierarchyUser"
              : error?.code === "TARGET_ROLE_HIGHER_OR_EQUAL"
                ? "memberAction.roleHierarchyBot"
                : "memberAction.failed";
      return safeReply(
        interaction,
        { content: await tContext(interaction, key) },
        { ephemeral: true },
      );
    }
  };
};
