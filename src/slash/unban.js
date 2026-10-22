const { executeUnbanAction } = require("../services/moderationService");
const { tContext } = require("../systems/i18n");
const { isStaff } = require("../utils/staff");
const { replyEphemeral, safeReply } = require("../utils/discord");

module.exports = async function unbanSlash(client, interaction) {
  try {
    const guild = interaction.guild;
    if (!guild) return;

    if (!(await isStaff(interaction.member, "moderation").catch(() => false))) {
      return replyEphemeral(
        interaction,
        await tContext(interaction, "common.noPermission"),
      );
    }

    const userId = (
      interaction.options.getString("user_id", true) || ""
    ).trim();
    if (!/^\d{10,32}$/.test(userId)) {
      return replyEphemeral(
        interaction,
        await tContext(interaction, "memberAction.invalidUserId"),
      );
    }

    const reason =
      (interaction.options.getString("reason") || "").trim() ||
      (await tContext(interaction, "common.noReason"));
    const result = await executeUnbanAction({
      client,
      guildId: guild.id,
      userId,
      reason,
      executorId: interaction.user.id,
      executorMember: interaction.member,
      actor: interaction.user.tag || interaction.user.username,
      source: "slash",
    });

    return interaction.reply({
      content: await tContext(interaction, "memberAction.unbanned", {
        tag: result.user.tag || result.user.username || userId,
        caseId: result.infraction?.caseId,
      }),
    });
  } catch (error) {
    console.error("[slash/unban] Error:", error);
    const key =
      error?.code === "USER_NOT_BANNED"
        ? "memberAction.notBanned"
        : "memberAction.failed";
    return safeReply(
      interaction,
      { content: await tContext(interaction, key) },
      { ephemeral: true },
    );
  }
};
