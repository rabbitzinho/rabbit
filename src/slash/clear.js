// src/slash/clear.js

const { PermissionsBitField } = require("discord.js");

const logger = require("../systems/logger");
const { tContext } = require("../systems/i18n");
const { isStaff } = require("./utils");
const { replyEphemeral, safeReply } = require("../utils/discord");

const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000 - 60_000;
const MAX_CLEAR_AMOUNT = 100;

async function deleteMessages(channel, amount, now = Date.now()) {
  const limit = Math.max(1, Math.min(MAX_CLEAR_AMOUNT, Math.floor(amount)));
  const collection = await channel.messages.fetch({ limit });
  const messages = Array.from(collection.values());
  const cutoff = now - BULK_DELETE_MAX_AGE_MS;
  const recent = [];
  const older = [];

  messages.forEach((message) => {
    const createdAt = Number(message.createdTimestamp);
    if (Number.isFinite(createdAt) && createdAt > cutoff) recent.push(message);
    else older.push(message);
  });

  let deletedCount = 0;
  let failedCount = 0;

  async function deleteIndividually(items) {
    const outcomes = await Promise.allSettled(
      items.map((message) => message.delete()),
    );
    outcomes.forEach((outcome) => {
      if (outcome.status === "fulfilled") deletedCount += 1;
      else failedCount += 1;
    });
  }

  if (recent.length > 1) {
    let bulkDeleted = null;
    try {
      bulkDeleted = await channel.bulkDelete(recent, true);
    } catch (error) {
      console.warn(
        "[slash/clear] Bulk deletion failed; retrying individually:",
        error,
      );
    }

    if (bulkDeleted) {
      deletedCount += bulkDeleted.size || 0;
      await deleteIndividually(
        recent.filter((message) => !bulkDeleted.has(message.id)),
      );
    } else {
      await deleteIndividually(recent);
    }
  } else {
    await deleteIndividually(recent);
  }

  await deleteIndividually(older);

  return {
    fetchedCount: messages.length,
    deletedCount,
    failedCount,
  };
}

async function clearSlash(client, interaction) {
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

    const perms = interaction.channel?.permissionsFor?.(botMember);
    const canReadMessages =
      perms?.has(PermissionsBitField.Flags.ViewChannel) &&
      perms?.has(PermissionsBitField.Flags.ReadMessageHistory);
    if (
      !canReadMessages ||
      !perms?.has(PermissionsBitField.Flags.ManageMessages)
    ) {
      return replyEphemeral(
        interaction,
        await tContext(interaction, "clear.noPerm"),
      );
    }

    const amount = interaction.options.getInteger("amount", true);
    const toDelete = Math.max(1, Math.min(MAX_CLEAR_AMOUNT, amount));
    await interaction.deferReply({ ephemeral: true });

    const result = await deleteMessages(interaction.channel, toDelete);

    if (result.fetchedCount === 0) {
      await interaction.editReply({
        content: await tContext(interaction, "clear.empty"),
      });
      return;
    }

    if (result.deletedCount === 0) {
      await interaction.editReply({
        content: await tContext(interaction, "clear.tooOldOrNoPerm"),
      });
      return;
    }

    const responseKey = result.failedCount ? "clear.partial" : "clear.success";
    await interaction.editReply({
      content: await tContext(interaction, responseKey, {
        count: result.deletedCount,
        failed: result.failedCount,
      }),
    });

    try {
      await logger(
        client,
        "Slash Clear Messages",
        null,
        interaction.user,
        await tContext(interaction, "log.actions.clear", {
          count: result.deletedCount,
          channelId: interaction.channel.id,
        }),
        guild,
      );
    } catch (error) {
      console.error("[slash/clear] Failed to log deletion:", error);
    }
  } catch (err) {
    console.error("[slash/clear] Error:", err);
    const message = await tContext(interaction, "common.unexpectedError");
    if (interaction?.deferred && typeof interaction.editReply === "function") {
      return interaction.editReply({ content: message }).catch(() => null);
    }
    return safeReply(interaction, { content: message }, { ephemeral: true });
  }
}

module.exports = clearSlash;
module.exports.deleteMessages = deleteMessages;
