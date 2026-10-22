// src/services/moderationService.js
//
// Ações de moderação agnósticas de HTTP (usadas pelo dashboard e reutilizáveis
// por qualquer outro ponto de entrada). Antes vivia em `dashboard/modService.js`;
// foi movido para a camada de serviços para não misturar regras de negócio com
// o registo de rotas.

const warningsService = require("../systems/warningsService");
const { randomUUID } = require("crypto");
const infractionsService = require("../systems/infractionsService");
const logger = require("../systems/logger");
const { handleInfractionAutomation } = require("../systems/automation");
const { getGuildTrustConfig } = require("../utils/trust");
const { fetchMember } = require("./discordFetchCache");
const { getGuild } = require("./guildService");
const {
  scheduleTemporaryBan,
  cancelTemporaryBan,
} = require("../systems/temporaryBans");

class ModError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function limitDiscordReason(reason, maxLength = 512) {
  return Array.from(String(reason || "No reason provided"))
    .slice(0, maxLength)
    .join("");
}

/**
 * Resolve guild + member from client cache.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {string} userId
 * @returns {Promise<{ guild: import('discord.js').Guild|null, member: import('discord.js').GuildMember|null }>}
 */
async function resolveGuildMember(client, guildId, userId) {
  if (!client) return { guild: null, member: null };
  const guild = getGuild(client, guildId);
  if (!guild) return { guild: null, member: null };
  const member = await fetchMember(guild, userId);
  return { guild, member };
}

/**
 * Dashboard-triggered warn.
 * Implementa a mesma lógica da rota /api/mod/warn, mas agnóstica de HTTP.
 *
 * @param {object} params
 * @param {import('discord.js').Client} params.client
 * @param {string} params.guildId
 * @param {string} params.userId
 * @param {string} [params.reason]
 * @param {string|null} [params.actor] - nome de quem executa via dashboard (para logs)
 * @returns {Promise<{ guild, member, dbUser }>}
 */
async function dashboardWarn({ client, guildId, userId, reason, actor }) {
  if (!client) {
    throw new ModError("CLIENT_NOT_READY", "Client not ready");
  }

  const r = (reason || "").toString().trim() || "Dashboard warning";

  const { guild, member } = await resolveGuildMember(client, guildId, userId);
  if (!guild || !member) {
    throw new ModError("USER_NOT_FOUND_IN_GUILD", "User not found in guild");
  }

  const me = guild.members.me;
  if (!me) {
    throw new ModError("BOT_MEMBER_NOT_AVAILABLE", "Bot member not available");
  }

  // Regras semelhantes ao comando !warn
  if (member.id === me.id) {
    throw new ModError("CANNOT_WARN_BOT", "Cannot warn the bot");
  }

  if (member.roles.highest.position >= me.roles.highest.position) {
    throw new ModError(
      "TARGET_ROLE_HIGHER_OR_EQUAL",
      "Target role is higher or equal to bot",
    );
  }

  const { PermissionsBitField } = require("discord.js");
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    throw new ModError(
      "CANNOT_WARN_ADMINS",
      "Cannot warn administrators via dashboard",
    );
  }

  const dbUser = await warningsService
    .addWarning(guild.id, member.id, 1)
    .catch(() => null);

  await infractionsService
    .create({
      guild,
      user: member.user,
      moderator: client.user,
      type: "WARN",
      reason: actor ? `${r} (dashboard: ${actor})` : r,
      duration: null,
      source: "dashboard",
    })
    .catch(() => null);

  // Automação (auto-mute / auto-kick) baseada nas infrações acumuladas, tal como nos comandos slash
  try {
    await handleInfractionAutomation({
      client,
      guild,
      user: member.user,
      moderator: client.user,
      type: "WARN",
    });
  } catch {
    // ignore automation errors to not quebrar o fluxo principal de warn
  }

  const trustCfg = await getGuildTrustConfig(guild.id);
  const trust = dbUser?.trust;
  const warnings = dbUser?.warnings ?? null;

  const trustText =
    trustCfg.enabled && trust != null
      ? `Trust: **${trust}/${trustCfg.max}**`
      : trust != null
        ? `Trust: **${trust}**`
        : "";
  const warnsText = warnings != null ? `Warnings: **${warnings}**` : "";

  const trustTextLog = trustText ? `\n${trustText}` : "";
  const warnsTextLog = warnsText ? `\n${warnsText}` : "";

  await logger(
    client,
    "Dashboard Warn",
    member.user,
    client.user,
    `Reason: **${r}**${warnsTextLog}${trustTextLog}` +
      (actor ? `\nExecutor (dashboard): **${actor}**` : ""),
    guild,
  );

  return { guild, member, dbUser };
}

async function executeMemberAction({
  client,
  guildId,
  userId,
  action,
  reason,
  durationMs = null,
  executorId,
  executorMember = null,
  allowAdminTarget = false,
  actor,
  source = "unknown",
  createInfraction = infractionsService.create,
  writeLog = logger,
  scheduleBan = scheduleTemporaryBan,
  cancelBan = cancelTemporaryBan,
}) {
  const normalizedAction = String(action || "").toUpperCase();
  if (normalizedAction !== "KICK" && normalizedAction !== "BAN") {
    throw new ModError("INVALID_MOD_ACTION", "Unsupported moderation action");
  }
  if (
    normalizedAction === "BAN" &&
    durationMs !== null &&
    durationMs !== undefined &&
    (!Number.isFinite(durationMs) ||
      durationMs < 60_000 ||
      durationMs > 365 * 24 * 60 * 60 * 1000)
  ) {
    throw new ModError(
      "INVALID_TEMPBAN_DURATION",
      "Temporary ban duration must be between 1 minute and 365 days",
    );
  }

  const { guild, member } = await resolveGuildMember(client, guildId, userId);
  if (!guild || !member) {
    throw new ModError("USER_NOT_FOUND_IN_GUILD", "User not found in guild");
  }

  const botMember = guild.members.me;
  if (!botMember) {
    throw new ModError("BOT_MEMBER_NOT_AVAILABLE", "Bot member not available");
  }
  if (member.id === client.user?.id) {
    throw new ModError("CANNOT_MODERATE_BOT", "Cannot moderate the bot");
  }
  if (executorId && member.id === String(executorId)) {
    throw new ModError("CANNOT_MODERATE_SELF", "Cannot moderate yourself");
  }
  let resolvedExecutor = executorMember;
  if (executorId && !resolvedExecutor) {
    resolvedExecutor = await fetchMember(guild, String(executorId));
    if (!resolvedExecutor) {
      throw new ModError(
        "ACTOR_MEMBER_NOT_AVAILABLE",
        "Could not verify the moderator's server role",
      );
    }
  }
  const { PermissionsBitField } = require("discord.js");
  const executorIsAdmin =
    allowAdminTarget ||
    Boolean(
      resolvedExecutor?.permissions?.has(
        PermissionsBitField.Flags.Administrator,
      ),
    );
  if (
    resolvedExecutor &&
    !executorIsAdmin &&
    member.roles.highest.position >= resolvedExecutor.roles.highest.position
  ) {
    throw new ModError(
      "CANNOT_MODERATE_TARGET_ROLE",
      "Target role is higher or equal to the moderator",
    );
  }
  if (member.roles.highest.position >= botMember.roles.highest.position) {
    throw new ModError(
      "TARGET_ROLE_HIGHER_OR_EQUAL",
      "Target role is higher or equal to bot",
    );
  }
  if (!allowAdminTarget) {
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      throw new ModError(
        "CANNOT_MODERATE_ADMIN",
        "Only an Administrator can moderate another Administrator",
      );
    }
  }

  const canModerate =
    normalizedAction === "KICK" ? member.kickable : member.bannable;
  if (!canModerate) {
    throw new ModError(
      normalizedAction === "KICK"
        ? "MEMBER_NOT_KICKABLE"
        : "MEMBER_NOT_BANNABLE",
      `Member is not ${normalizedAction.toLowerCase()}able by the bot`,
    );
  }

  const cleanReason = String(reason || "No reason provided").trim();
  const actionReason =
    actor && source === "dashboard"
      ? `${cleanReason} (dashboard: ${actor})`
      : cleanReason;
  const expiresAt =
    normalizedAction === "BAN" && Number.isFinite(durationMs) && durationMs > 0
      ? new Date(Date.now() + durationMs)
      : null;
  const temporaryBanToken = expiresAt ? randomUUID() : null;
  const temporaryBanMarker = temporaryBanToken
    ? ` [rabbit-tempban:${temporaryBanToken}]`
    : "";
  if (normalizedAction === "BAN" && expiresAt) {
    try {
      await scheduleBan({
        guildId: guild.id,
        userId: member.id,
        userTag: member.user.tag || member.user.username,
        token: temporaryBanToken,
        moderatorId: resolvedExecutor?.id || client.user.id,
        reason: cleanReason,
        expiresAt,
      });
    } catch (error) {
      throw new ModError(
        "TEMPBAN_SCHEDULE_FAILED",
        error?.message || "Could not schedule temporary ban expiration",
      );
    }
  }
  try {
    if (normalizedAction === "KICK") {
      await member.kick(limitDiscordReason(actionReason));
    } else {
      const reasonLimit = 512 - Array.from(temporaryBanMarker).length;
      const banReason =
        limitDiscordReason(actionReason, reasonLimit) + temporaryBanMarker;
      await member.ban({ reason: banReason });
    }
  } catch (error) {
    if (expiresAt) {
      await cancelBan({ guildId: guild.id, userId: member.id }).catch(
        () => null,
      );
    }
    throw new ModError(
      `FAILED_TO_${normalizedAction}`,
      error?.message || `Failed to ${normalizedAction.toLowerCase()} member`,
    );
  }

  if (normalizedAction === "BAN" && !expiresAt) {
    await cancelBan({ guildId: guild.id, userId: member.id }).catch(() => null);
  }

  const infraction = await createInfraction({
    guild,
    user: member.user,
    moderator: resolvedExecutor?.user || client.user,
    type: normalizedAction,
    reason: cleanReason,
    duration: durationMs,
    source,
  }).catch(() => null);

  await writeLog(
    client,
    normalizedAction === "KICK" ? "Kick" : "Ban",
    member.user,
    client.user,
    `Reason: **${cleanReason}**` +
      (infraction?.caseId ? `\nCase: **#${infraction.caseId}**` : "") +
      (actor ? `\nExecutor: **${actor}**` : ""),
    guild,
  ).catch(() => null);

  return { guild, member, infraction, expiresAt };
}

async function executeUnbanAction({
  client,
  guildId,
  userId,
  reason,
  executorId,
  executorMember = null,
  actor,
  source = "unknown",
  createInfraction = infractionsService.create,
  writeLog = logger,
  cancelBan = cancelTemporaryBan,
}) {
  const guild = getGuild(client, guildId);
  if (!guild) {
    throw new ModError("GUILD_NOT_FOUND", "Guild not found");
  }
  const botMember = guild.members.me;
  const { PermissionsBitField } = require("discord.js");
  if (!botMember?.permissions?.has(PermissionsBitField.Flags.BanMembers)) {
    throw new ModError(
      "BOT_MISSING_BAN_PERMISSION",
      "Bot cannot unban members",
    );
  }

  let resolvedExecutor = executorMember;
  if (executorId && !resolvedExecutor) {
    resolvedExecutor = await fetchMember(guild, String(executorId));
    if (!resolvedExecutor) {
      throw new ModError(
        "ACTOR_MEMBER_NOT_AVAILABLE",
        "Could not verify the moderator's server role",
      );
    }
  }

  const cleanReason = String(reason || "No reason provided").trim();
  let user;
  try {
    const ban = await guild.bans.fetch(String(userId));
    user = ban.user;
    await guild.bans.remove(String(userId), limitDiscordReason(cleanReason));
  } catch (error) {
    if (Number(error?.code || error?.rawError?.code) === 10026) {
      throw new ModError("USER_NOT_BANNED", "User is not banned");
    }
    throw new ModError(
      "FAILED_TO_UNBAN",
      error?.message || "Failed to unban user",
    );
  }

  await cancelBan({ guildId: guild.id, userId: String(userId) }).catch(
    () => null,
  );
  const infraction = await createInfraction({
    guild,
    user,
    moderator: resolvedExecutor?.user || client.user,
    type: "UNBAN",
    reason: cleanReason,
    source,
  }).catch(() => null);

  await writeLog(
    client,
    "Unban",
    user,
    resolvedExecutor?.user || client.user,
    `Reason: **${cleanReason}**` +
      (infraction?.caseId ? `\nCase: **#${infraction.caseId}**` : "") +
      (actor ? `\nExecutor: **${actor}**` : ""),
    guild,
  ).catch(() => null);

  return { guild, user, infraction };
}

module.exports = {
  ModError,
  dashboardWarn,
  executeMemberAction,
  executeUnbanAction,
  resolveGuildMember,
};
