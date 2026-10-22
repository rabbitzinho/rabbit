// src/systems/serverStats.js
//
// Estatísticas do servidor em canais de voz agrupados dentro da categoria
// "estatisticas":
//   👥 Membros: N | 📥 Entradas (7d): N | 📤 Saídas (7d): N
//
// A categoria e os canais são criados na primeira utilização e os respetivos
// IDs são persistidos em GuildConfig.features.serverStats para reaproveitar nas
// atualizações seguintes.

const { ChannelType, PermissionsBitField } = require("discord.js");
const { getFeature } = require("./featuresService");
const { invalidateGuildConfig } = require("./guildConfigService");
const { getRecentCounts } = require("./memberStats");
const { getFeatureText, applyTemplate } = require("./featureText");
const { getGuildLang } = require("./i18n");

// A API do Discord limita renomeações de canais; 6 minutos é seguro e suficiente.
const REFRESH_MS = 6 * 60 * 1000;
const realtimeTimers = new Map();

// Permissões negadas ao @everyone: o canal é um mostrador de números, não um
// canal utilizável. Os canais continuam visíveis, mas a ligação é negada por
// permissões normais e reforçada por auto-expulsão em `voiceStateUpdate` para
// cobrir também utilizadores com `Administrator`.
const LOCKED_FLAGS = [
  PermissionsBitField.Flags.Connect,
  PermissionsBitField.Flags.Speak,
  PermissionsBitField.Flags.Stream,
  PermissionsBitField.Flags.UseVAD,
  PermissionsBitField.Flags.UseEmbeddedActivities,
  PermissionsBitField.Flags.UseSoundboard,
  PermissionsBitField.Flags.CreateInstantInvite,
].filter(Boolean);

// Payload aceite por `permissionOverwrites.edit()` (nomes de permissão → false).
function lockEditPayload() {
  const payload = {};
  for (const flag of LOCKED_FLAGS) payload[flag] = false;
  return payload;
}

function getStatsCategoryName(lang) {
  return lang === "pt" ? "✦ Estatísticas" : "✦ Statistics";
}

function getCategoryChildren(guild, categoryId) {
  if (!guild || !categoryId || !guild.channels || !guild.channels.cache)
    return [];
  return guild.channels.cache
    .filter((ch) => ch && ch.parentId === categoryId)
    .map((ch) => ch);
}

function getManagedChannelIds(cfg) {
  if (!cfg || typeof cfg !== "object") return new Set();
  return new Set(
    [cfg.memberChannelId, cfg.joinsChannelId, cfg.leavesChannelId].filter(
      Boolean,
    ),
  );
}

async function resolveChannel(guild, channelId) {
  if (!channelId) return null;
  const cached = guild.channels.cache.get(channelId);
  if (cached) return cached;
  return guild.channels.fetch(channelId).catch(() => null);
}

/**
 * Reaplica o bloqueio de permissões a um canal já existente. Necessário para
 * canais criados antes deste bloqueio (que só negavam `Connect`) e para quando
 * alguém altera as permissões à mão no Discord.
 */
async function applyLock(channel, guild) {
  const everyone = guild.roles && guild.roles.everyone;
  if (!channel || !everyone) return;
  if (
    !channel.permissionOverwrites ||
    typeof channel.permissionOverwrites.edit !== "function"
  )
    return;
  await channel.permissionOverwrites
    .edit(everyone, lockEditPayload())
    .catch(() => null);
}

async function ensureCategory(guild, categoryId, lang) {
  const desired = getStatsCategoryName(lang);
  let category = await resolveChannel(guild, categoryId);

  if (!category) {
    category =
      guild.channels.cache.find(
        (ch) =>
          ch &&
          ch.type === ChannelType.GuildCategory &&
          String(ch.name || "")
            .trim()
            .toLowerCase() === desired,
      ) || null;
  }

  if (!category) {
    category = await guild.channels
      .create({
        name: desired,
        type: ChannelType.GuildCategory,
        position: 0,
      })
      .catch(() => null);
  }

  if (!category) return null;

  if (category.name !== desired && typeof category.setName === "function") {
    await category.setName(desired).catch(() => null);
  }
  await applyLock(category, guild);
  if (typeof category.setPosition === "function" && category.position !== 0) {
    await category.setPosition(0).catch(() => null);
  }

  return category;
}

async function ensureChannel(guild, channelId, name, position, parentId) {
  const desired = String(name || "").slice(0, 100) || "—";
  let channel = await resolveChannel(guild, channelId);

  if (!channel) {
    channel = await guild.channels
      .create({
        name: desired,
        type: ChannelType.GuildVoice,
        position,
        parent: parentId || null,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: LOCKED_FLAGS,
          },
        ],
      })
      .catch(() => null);
    return channel;
  }

  // Só escreve se faltar alguma permissão por negar (evita chamadas à API
  // desnecessárias a cada ciclo de atualização).
  const overwrite =
    channel.permissionOverwrites && channel.permissionOverwrites.cache
      ? channel.permissionOverwrites.cache.get(guild.roles.everyone.id)
      : null;
  const missing = LOCKED_FLAGS.filter(
    (flag) => !overwrite || !overwrite.deny.has(flag),
  );
  if (missing.length) await applyLock(channel, guild);

  if (channel.name !== desired) {
    await channel.setName(desired).catch(() => null);
  }
  if (
    (channel.parentId || null) !== (parentId || null) &&
    typeof channel.setParent === "function"
  ) {
    await channel
      .setParent(parentId || null, { lockPermissions: true })
      .catch(() => null);
  }
  if (
    typeof channel.setPosition === "function" &&
    channel.position !== position
  ) {
    await channel.setPosition(position).catch(() => null);
  }
  return channel;
}

async function deleteManagedChannel(guild, channelId) {
  if (!channelId) return true;
  const channel = await resolveChannel(guild, channelId);
  if (!channel) return true;
  if (typeof channel.delete !== "function") return false;
  try {
    await channel.delete();
    return true;
  } catch (err) {
    const errorCode = Number(
      err && (err.code || (err.rawError && err.rawError.code)),
    );
    if (errorCode === 10003 || (err && err.status === 404)) return true;
    console.warn(
      `[serverStats] Falha ao apagar o canal ${channelId}:`,
      err?.message || err,
    );
    return false;
  }
}

async function enforceCategoryIsolation(guild, category, managedIds) {
  if (!guild || !category || !category.id) return;
  const children = getCategoryChildren(guild, category.id);
  for (const child of children) {
    if (
      !child ||
      managedIds.has(child.id) ||
      typeof child.setParent !== "function"
    )
      continue;
    await child.setParent(null, { lockPermissions: false }).catch(() => null);
  }
}

/**
 * Cria/atualiza os canais de estatísticas de um servidor.
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild} guild
 * @param {{force?: boolean}} [opts] force = ignora o interruptor (usado no teste)
 */
async function refreshGuild(client, guild, opts) {
  if (!guild) return { ok: false, error: "GUILD_NOT_FOUND" };

  const force = !!(opts && opts.force);
  const cfg = await getFeature(guild.id, "serverStats");
  if (!force && cfg.enabled !== true) {
    await removeGuild(guild, cfg);
    return { ok: true, skipped: true };
  }
  const lang = await getGuildLang(guild.id).catch(() => "pt");
  const showMembers = cfg.showMembers !== false;
  const showJoins = cfg.showJoins !== false;
  const showLeaves = cfg.showLeaves !== false;

  if (!showMembers && !showJoins && !showLeaves) {
    await removeGuild(guild, cfg);
    return { ok: true, skipped: true };
  }

  const members = guild.memberCount || 0;
  const counts =
    showJoins || showLeaves
      ? await getRecentCounts(guild.id, 7)
      : { joins: 0, leaves: 0 };
  const { joins, leaves } = counts;

  const memberName = showMembers
    ? applyTemplate(
        await getFeatureText({
          guildId: guild.id,
          feature: "serverStats",
          field: "memberTemplate",
          value: cfg.memberTemplate,
        }),
        { count: members },
      )
    : null;
  const joinsName = showJoins
    ? applyTemplate(
        await getFeatureText({
          guildId: guild.id,
          feature: "serverStats",
          field: "joinsTemplate",
          value: cfg.joinsTemplate,
        }),
        { count: joins },
      )
    : null;
  const leavesName = showLeaves
    ? applyTemplate(
        await getFeatureText({
          guildId: guild.id,
          feature: "serverStats",
          field: "leavesTemplate",
          value: cfg.leavesTemplate,
        }),
        { count: leaves },
      )
    : null;

  const category = await ensureCategory(guild, cfg.categoryId, lang);
  const categoryId = category ? category.id : null;

  const chMembers = showMembers
    ? await ensureChannel(guild, cfg.memberChannelId, memberName, 0, categoryId)
    : null;
  const chJoins = showJoins
    ? await ensureChannel(guild, cfg.joinsChannelId, joinsName, 1, categoryId)
    : null;
  const chLeaves = showLeaves
    ? await ensureChannel(guild, cfg.leavesChannelId, leavesName, 2, categoryId)
    : null;
  const removedMembers =
    !showMembers && (await deleteManagedChannel(guild, cfg.memberChannelId));
  const removedJoins =
    !showJoins && (await deleteManagedChannel(guild, cfg.joinsChannelId));
  const removedLeaves =
    !showLeaves && (await deleteManagedChannel(guild, cfg.leavesChannelId));
  await enforceCategoryIsolation(
    guild,
    category,
    new Set(
      [
        chMembers && chMembers.id,
        chJoins && chJoins.id,
        chLeaves && chLeaves.id,
      ].filter(Boolean),
    ),
  );

  const patch = {};
  if (categoryId && categoryId !== cfg.categoryId)
    patch["features.serverStats.categoryId"] = categoryId;
  if (chMembers && chMembers.id !== cfg.memberChannelId)
    patch["features.serverStats.memberChannelId"] = chMembers.id;
  if (chJoins && chJoins.id !== cfg.joinsChannelId)
    patch["features.serverStats.joinsChannelId"] = chJoins.id;
  if (chLeaves && chLeaves.id !== cfg.leavesChannelId)
    patch["features.serverStats.leavesChannelId"] = chLeaves.id;
  if (removedMembers) patch["features.serverStats.memberChannelId"] = null;
  if (removedJoins) patch["features.serverStats.joinsChannelId"] = null;
  if (removedLeaves) patch["features.serverStats.leavesChannelId"] = null;

  if (Object.keys(patch).length) {
    try {
      const GuildConfig = require("../database/models/GuildConfig");
      await GuildConfig.updateOne({ guildId: guild.id }, { $set: patch });
      invalidateGuildConfig(guild.id);
    } catch (err) {
      console.warn(
        "[serverStats] Falha ao persistir IDs dos canais:",
        err?.message || err,
      );
    }
  }

  return { ok: true, members, joins, leaves };
}

async function enforceVoiceEntry(oldState, newState) {
  if (!newState || !newState.guild || !newState.channelId) return;
  if (oldState && oldState.channelId === newState.channelId) return;
  if (newState.member && newState.member.user && newState.member.user.bot)
    return;

  const cfg = await getFeature(newState.guild.id, "serverStats").catch(
    () => null,
  );
  if (!cfg || cfg.enabled !== true) return;

  const managedIds = getManagedChannelIds(cfg);
  if (!managedIds.has(newState.channelId)) return;

  if (typeof newState.disconnect === "function") {
    await newState
      .disconnect("Server statistics channels are read-only displays.")
      .catch(() => null);
  } else if (typeof newState.setChannel === "function") {
    await newState
      .setChannel(null, "Server statistics channels are read-only displays.")
      .catch(() => null);
  }
}

function scheduleRealtimeSync(client, guild, delayMs) {
  if (!client || !guild || !guild.id) return;
  const key = String(guild.id);
  const wait = typeof delayMs === "number" ? delayMs : 1200;
  const prev = realtimeTimers.get(key);
  if (prev) clearTimeout(prev);

  const timer = setTimeout(async () => {
    realtimeTimers.delete(key);
    try {
      await refreshGuild(client, guild);
    } catch (err) {
      console.warn(
        `[serverStats] Realtime sync failed for "${guild.name}":`,
        err?.message || err,
      );
    }
  }, wait);

  if (typeof timer.unref === "function") timer.unref();
  realtimeTimers.set(key, timer);
}

/**
 * Remove os canais de estatísticas (usado quando a funcionalidade é desligada)
 * e limpa os IDs guardados na configuração.
 */
async function removeGuild(guild, cfg) {
  if (!guild) return;
  const config = cfg || {};

  // Os IDs podem não vir no payload (ex.: a dashboard reenvia null ao desligar).
  // Nesse caso leem-se da base de dados para garantir que os canais são apagados.
  let stored = {};
  try {
    const GuildConfig = require("../database/models/GuildConfig");
    const doc = await GuildConfig.findOne({ guildId: guild.id }).lean();
    stored = (doc && doc.features && doc.features.serverStats) || {};
  } catch (err) {
    console.warn(
      "[serverStats] Falha ao ler os IDs dos canais:",
      err?.message || err,
    );
  }

  const channels = [
    ["memberChannelId", config.memberChannelId || stored.memberChannelId],
    ["joinsChannelId", config.joinsChannelId || stored.joinsChannelId],
    ["leavesChannelId", config.leavesChannelId || stored.leavesChannelId],
    ["categoryId", config.categoryId || stored.categoryId],
  ].filter(([, id]) => id);
  if (!channels.length) return;

  const managedIds = new Set(
    channels.filter(([field]) => field !== "categoryId").map(([, id]) => id),
  );
  const categoryEntry = channels.find(([field]) => field === "categoryId");
  if (categoryEntry) {
    const category = await resolveChannel(guild, categoryEntry[1]);
    if (category) await enforceCategoryIsolation(guild, category, managedIds);
  }

  const removed = new Set();
  for (const [field, id] of channels) {
    const channel = await resolveChannel(guild, id);
    if (!channel) {
      removed.add(field);
      continue;
    }
    const hasChildren =
      channel &&
      channel.type === ChannelType.GuildCategory &&
      getCategoryChildren(guild, channel.id).length > 0;
    if (hasChildren || typeof channel.delete !== "function") continue;
    if (await deleteManagedChannel(guild, id)) removed.add(field);
  }

  const patch = {};
  for (const [field] of channels) {
    if (removed.has(field)) patch[`features.serverStats.${field}`] = null;
  }
  if (!Object.keys(patch).length) return;

  try {
    const GuildConfig = require("../database/models/GuildConfig");
    await GuildConfig.updateOne({ guildId: guild.id }, { $set: patch });
    invalidateGuildConfig(guild.id);
  } catch (err) {
    console.warn(
      "[serverStats] Falha ao limpar IDs dos canais:",
      err?.message || err,
    );
  }
}

async function refreshAll(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      await refreshGuild(client, guild);
    } catch (err) {
      console.warn(
        `[serverStats] Falha ao atualizar "${guild.name}":`,
        err?.message || err,
      );
    }
  }
}

function startServerStats(client) {
  const run = () => refreshAll(client).catch(() => null);

  const initial = setTimeout(run, 15 * 1000);
  if (typeof initial.unref === "function") initial.unref();

  const timer = setInterval(run, REFRESH_MS);
  if (typeof timer.unref === "function") timer.unref();

  return { client, refreshGuild, refreshAll: run };
}

module.exports = {
  startServerStats,
  refreshGuild,
  removeGuild,
  enforceVoiceEntry,
  scheduleRealtimeSync,
};
