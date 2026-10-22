// src/utils/modPermissions.js
//
// Central helpers for repeated moderation permission / hierarchy checks
// used by slash commands (warn, mute, unmute).

const { PermissionsBitField } = require("discord.js");
const { tContext } = require("../systems/i18n");
const { replyEphemeral } = require("./discord");

/**
 * Shared checks for /warn:
 * - cannot warn self
 * - cannot warn the bot
 * - target role must be below bot
 * - target role must be below executor (unless executor is admin)
 * - cannot warn admins (unless executor is admin)
 *
 * Returns true if all checks pass, otherwise sends an ephemeral reply
 * and returns false.
 */
async function ensureWarnPermissions({
  client,
  interaction,
  executor,
  target,
  botMember,
}) {
  if (!interaction || !executor || !target || !botMember) return false;

  // Self-target check
  if (target.id === interaction.user.id) {
    await replyEphemeral(
      interaction,
      await tContext(interaction, "warn.cannotWarnSelf"),
    );
    return false;
  }

  // Cannot act on the bot itself
  if (target.id === client.user.id) {
    await replyEphemeral(
      interaction,
      await tContext(interaction, "warn.cannotWarnBot"),
    );
    return false;
  }

  // Target must be below the bot in role hierarchy
  if (target.roles.highest.position >= botMember.roles.highest.position) {
    await replyEphemeral(
      interaction,
      await tContext(interaction, "warn.roleHierarchyBot"),
    );
    return false;
  }

  const executorIsAdmin = executor.permissions.has(
    PermissionsBitField.Flags.Administrator,
  );

  // Target must also be below executor (unless executor is admin)
  if (
    !executorIsAdmin &&
    target.roles.highest.position >= executor.roles.highest.position
  ) {
    await replyEphemeral(
      interaction,
      await tContext(interaction, "warn.roleHierarchyUser"),
    );
    return false;
  }

  // Cannot warn admins unless executor is admin
  if (
    !executorIsAdmin &&
    target.permissions.has(PermissionsBitField.Flags.Administrator)
  ) {
    await replyEphemeral(
      interaction,
      await tContext(interaction, "warn.cannotWarnAdmin"),
    );
    return false;
  }

  return true;
}

/**
 * Shared checks for /mute:
 * - cannot mute self
 * - cannot mute the bot
 * - cannot mute bot users (optionally)
 * - target cannot already be muted
 * - target role must be below bot
 * - target role must be below executor (unless executor is admin)
 * - cannot mute admins (unless executor is admin)
 *
 * Returns true if all checks pass, otherwise sends an ephemeral reply
 * and returns false.
 */
async function ensureMutePermissions({
  client,
  interaction,
  executor,
  target,
  botMember,
}) {
  if (!interaction || !executor || !target || !botMember) return false;

  // Self-target check
  if (target.id === interaction.user.id) {
    await replyEphemeral(
      interaction,
      await tContext(interaction, "mute.cannotMuteSelf"),
    );
    return false;
  }

  // Cannot act on the bot itself
  if (target.id === client.user.id) {
    await replyEphemeral(
      interaction,
      await tContext(interaction, "mute.cannotMuteBot"),
    );
    return false;
  }

  // Optionally disallow muting other bots
  if (target.user && target.user.bot) {
    await replyEphemeral(
      interaction,
      await tContext(interaction, "mute.cannotMuteBotUser"),
    );
    return false;
  }

  // Already muted?
  if (
    typeof target.isCommunicationDisabled === "function" &&
    target.isCommunicationDisabled()
  ) {
    await replyEphemeral(
      interaction,
      await tContext(interaction, "mute.alreadyMuted", {
        tag: target.user.tag,
      }),
    );
    return false;
  }

  const executorIsAdmin = executor.permissions.has(
    PermissionsBitField.Flags.Administrator,
  );

  // Target role vs bot role
  if (target.roles.highest.position >= botMember.roles.highest.position) {
    await replyEphemeral(
      interaction,
      await tContext(interaction, "mute.roleHierarchyBot"),
    );
    return false;
  }

  // Target role vs executor role
  if (
    !executorIsAdmin &&
    target.roles.highest.position >= executor.roles.highest.position
  ) {
    await replyEphemeral(
      interaction,
      await tContext(interaction, "mute.roleHierarchyUser"),
    );
    return false;
  }

  // Cannot mute admins unless executor is admin
  if (
    !executorIsAdmin &&
    target.permissions.has(PermissionsBitField.Flags.Administrator)
  ) {
    await replyEphemeral(
      interaction,
      await tContext(interaction, "mute.cannotMuteAdmin"),
    );
    return false;
  }

  return true;
}

/**
 * Shared checks for /unmute:
 * - cannot unmute self
 * - cannot unmute the bot
 * - target role must be below bot
 * - target role must be below executor (unless executor is admin)
 *
 * Note: whether the target is currently muted is checked in the command
 * itself, since that is more about state than permissions.
 */
async function ensureUnmutePermissions({
  client,
  interaction,
  executor,
  target,
  botMember,
}) {
  if (!interaction || !executor || !target || !botMember) return false;

  // Self-target check
  if (target.id === interaction.user.id) {
    await replyEphemeral(
      interaction,
      await tContext(interaction, "unmute.cannotUnmuteSelf"),
    );
    return false;
  }

  // Cannot act on the bot itself
  if (target.id === client.user.id) {
    await replyEphemeral(
      interaction,
      await tContext(interaction, "unmute.cannotUnmuteBot"),
    );
    return false;
  }

  const executorIsAdmin = executor.permissions.has(
    PermissionsBitField.Flags.Administrator,
  );

  // Target role vs bot role
  if (target.roles.highest.position >= botMember.roles.highest.position) {
    await replyEphemeral(
      interaction,
      await tContext(interaction, "unmute.roleHierarchyBot"),
    );
    return false;
  }

  // Target role vs executor role
  if (
    !executorIsAdmin &&
    target.roles.highest.position >= executor.roles.highest.position
  ) {
    await replyEphemeral(
      interaction,
      await tContext(interaction, "unmute.roleHierarchyUser"),
    );
    return false;
  }

  return true;
}

module.exports = {
  ensureWarnPermissions,
  ensureMutePermissions,
  ensureUnmutePermissions,
};
