// src/systems/guildConfigService.js

const GuildConfig = require("../database/models/GuildConfig");

const CACHE_TTL_MS = 60 * 1000; // 1 minute

const _cache = new Map();

async function getGuildConfig(guildId) {
  if (!guildId) return null;

  const now = Date.now();
  const cached = _cache.get(guildId);
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  const doc = await GuildConfig.findOne({ guildId })
    .lean()
    .catch(() => null);
  const value = doc || null;

  _cache.set(guildId, { at: now, value });
  return value;
}

/**
 * Invalida a cache de um guild (ou de todos, se guildId não for indicado).
 * Deve ser chamado sempre que a GuildConfig for escrita, para evitar servir
 * estado obsoleto durante o TTL (ex.: após guardar no dashboard).
 */
function invalidateGuildConfig(guildId) {
  if (guildId) {
    _cache.delete(String(guildId));
    return;
  }
  _cache.clear();
}

module.exports = { getGuildConfig, invalidateGuildConfig };
