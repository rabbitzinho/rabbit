// src/services/guildService.js
//
// Camada de serviço para acesso ao Discord client (guild / canal / membro / utilizador).
// Centraliza a resolução null-safe que estava duplicada nas rotas da dashboard e
// delega o caching de REST em `discordFetchCache` (TTL + deduplicação de pedidos).
//
// Convenções:
// - Os getters `getGuild`/`getCached*` são síncronos e devolvem sempre `null` em falha.
// - Os `resolve*` devolvem o valor em cache de imediato (síncrono) ou uma Promise
//   quando é preciso ir ao REST. Os consumidores devem usar `await`.

const { fetchChannel, fetchMember } = require("./discordFetchCache");

function normalizeId(value) {
  if (value == null) return "";
  return String(value).trim();
}

/** Guild a partir do cache do client (síncrono, null-safe). */
function getGuild(client, guildId) {
  const id = normalizeId(guildId);
  if (!client || !id) return null;
  try {
    return client.guilds?.cache?.get?.(id) || null;
  } catch {
    return null;
  }
}

/** Canal a partir do cache (guild-scoped, com fallback ao cache global do client). */
function getCachedChannel(client, guildId, channelId) {
  const id = normalizeId(channelId);
  if (!client || !id) return null;

  const guild = getGuild(client, guildId);
  const fromGuild = guild?.channels?.cache?.get?.(id);
  if (fromGuild) return fromGuild;

  try {
    return client.channels?.cache?.get?.(id) || null;
  } catch {
    return null;
  }
}

/** Membro a partir do cache da guild. */
function getCachedMember(client, guildId, userId) {
  const id = normalizeId(userId);
  if (!client || !id) return null;
  const guild = getGuild(client, guildId);
  return guild?.members?.cache?.get?.(id) || null;
}

/** Utilizador a partir do cache global do client. */
function getCachedUser(client, userId) {
  const id = normalizeId(userId);
  if (!client || !id) return null;
  try {
    return client.users?.cache?.get?.(id) || null;
  } catch {
    return null;
  }
}

/** Formata um utilizador como tag legível ("nome" ou "nome#0000"). */
function formatUserTag(user) {
  if (!user) return null;
  if (typeof user.tag === "string" && user.tag) return user.tag;

  const name = typeof user.username === "string" ? user.username : null;
  if (!name) return null;

  const disc = user.discriminator;
  return disc && String(disc) !== "0" ? `${name}#${disc}` : name;
}

/**
 * Resolve um canal: cache primeiro, REST depois.
 * @returns {object|null|Promise<object|null>}
 */
function resolveChannel(client, guildId, channelId, { fetch = true } = {}) {
  const cached = getCachedChannel(client, guildId, channelId);
  if (cached || !fetch) return cached;
  if (!client) return null;
  return fetchChannel(client, normalizeId(channelId)).catch(() => null);
}

/**
 * Resolve um membro da guild: cache primeiro, REST depois.
 * @returns {object|null|Promise<object|null>}
 */
function resolveMember(client, guildId, userId, { fetch = true } = {}) {
  const cached = getCachedMember(client, guildId, userId);
  if (cached || !fetch) return cached;

  const guild = getGuild(client, guildId);
  if (!guild) return null;
  return fetchMember(guild, normalizeId(userId)).catch(() => null);
}

/**
 * Resolve um utilizador: cache primeiro, REST depois.
 * @returns {object|null|Promise<object|null>}
 */
function resolveUser(client, userId, { fetch = true } = {}) {
  const cached = getCachedUser(client, userId);
  if (cached || !fetch) return cached;

  const id = normalizeId(userId);
  if (!client || !id || typeof client.users?.fetch !== "function") return null;
  return client.users.fetch(id).catch(() => null);
}

module.exports = {
  normalizeId,
  getGuild,
  getCachedChannel,
  getCachedMember,
  getCachedUser,
  formatUserTag,
  resolveChannel,
  resolveMember,
  resolveUser,
};
