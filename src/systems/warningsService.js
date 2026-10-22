// src/systems/warningsService.js

const User = require("../database/models/User");
const { getGuildTrustConfig } = require("../utils/trust");

const DAY_MS = 24 * 60 * 60 * 1000;

// Keep the Trust change log small and bounded.
const MAX_TRUST_HISTORY = 30;

function clampTrust(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Append a Trust change to the rolling history (skips no-op changes).
function recordTrustChange(u, reason, beforeTrust, now) {
  if (!u) return;
  const afterTrust = u.trust;
  if (!Number.isFinite(afterTrust) || !Number.isFinite(beforeTrust)) return;

  const delta = Math.round((afterTrust - beforeTrust) * 100) / 100;
  if (!delta) return;

  const list = Array.isArray(u.trustHistory) ? u.trustHistory.slice() : [];
  list.push({
    at: now instanceof Date ? now : new Date(),
    delta,
    trust: afterTrust,
    reason: reason || null,
  });
  u.trustHistory = list.slice(-MAX_TRUST_HISTORY);
}

async function getOrCreateUser(guildId, userId) {
  let u = await User.findOne({ guildId, userId });

  if (!u) {
    const trustCfg = await getGuildTrustConfig(guildId);

    u = await User.create({
      guildId,
      userId,
      warnings: 0,
      trust: trustCfg.base,
      lastInfractionAt: null,
      lastTrustUpdateAt: new Date(),
    });
  }

  const trustCfg = await getGuildTrustConfig(guildId);

  if (!Number.isFinite(u.trust)) u.trust = trustCfg.base;
  if (!u.lastTrustUpdateAt) u.lastTrustUpdateAt = new Date();

  const now = new Date();
  const before = u.trust;
  applyTrustRegen(u, trustCfg, now);
  if (u.trust !== before) {
    recordTrustChange(u, "regen", before, now);
    await u.save().catch(() => null);
  }

  return u;
}

function applyTrustRegen(u, trustCfg, now) {
  if (!trustCfg.enabled) return;

  const last = u.lastInfractionAt || u.lastTrustUpdateAt || u.createdAt || now;

  const diffMs = now.getTime() - last.getTime();
  if (diffMs < DAY_MS) return;

  let days = Math.floor(diffMs / DAY_MS);
  if (days > trustCfg.regenMaxDays) {
    days = trustCfg.regenMaxDays;
  }

  const bonus = days * trustCfg.regenPerDay;
  if (bonus <= 0) return;

  u.trust = clampTrust(u.trust + bonus, trustCfg.min, trustCfg.max);

  u.lastTrustUpdateAt = now;
}

function applyTrustPenalty(u, trustCfg, type, now) {
  if (!trustCfg.enabled) return;

  let penalty = 0;
  if (type === "WARN") penalty = trustCfg.warnPenalty;
  if (type === "MUTE") penalty = trustCfg.mutePenalty;

  if (penalty > 0) {
    u.trust = clampTrust(u.trust - penalty, trustCfg.min, trustCfg.max);
  }

  u.lastInfractionAt = now;
  u.lastTrustUpdateAt = now;
}

async function addWarning(guildId, userId, amount = 1) {
  const trustCfg = await getGuildTrustConfig(guildId);
  const now = new Date();

  const u = await getOrCreateUser(guildId, userId);

  applyTrustRegen(u, trustCfg, now);

  const before = u.trust;
  u.warnings = (u.warnings || 0) + amount;

  applyTrustPenalty(u, trustCfg, "WARN", now);
  recordTrustChange(u, "warn", before, now);

  await u.save();
  return u;
}

async function applyMutePenalty(guildId, userId) {
  const trustCfg = await getGuildTrustConfig(guildId);
  const now = new Date();

  const u = await getOrCreateUser(guildId, userId);

  applyTrustRegen(u, trustCfg, now);

  const before = u.trust;
  applyTrustPenalty(u, trustCfg, "MUTE", now);
  recordTrustChange(u, "mute", before, now);

  await u.save();
  return u;
}

async function resetUser(guildId, userId, baseTrust, reason) {
  const trustCfg = await getGuildTrustConfig(guildId);
  const u = await getOrCreateUser(guildId, userId);

  u.warnings = 0;

  const minTrust =
    typeof trustCfg.minTrust === "number" ? trustCfg.minTrust : -100;
  const maxTrust =
    typeof trustCfg.maxTrust === "number" ? trustCfg.maxTrust : 100;
  const nextTrust =
    typeof baseTrust === "number"
      ? baseTrust
      : typeof trustCfg.base === "number"
        ? trustCfg.base
        : 0;

  const before = u.trust;
  u.trust = clampTrust(nextTrust, minTrust, maxTrust);
  recordTrustChange(u, reason ? String(reason) : "reset", before, new Date());

  await u.save();
  return u;
}

async function resetWarnings(guildId, userId) {
  const u = await getOrCreateUser(guildId, userId);
  u.warnings = 0;
  await u.save();
  return u;
}

async function removeInfractionEffects(guildId, userId, type) {
  const trustCfg = await getGuildTrustConfig(guildId);
  const u = await getOrCreateUser(guildId, userId);
  const before = u.trust;
  let changed = false;

  if (type === "WARN") {
    const currentWarnings = typeof u.warnings === "number" ? u.warnings : 0;
    u.warnings = currentWarnings > 0 ? currentWarnings - 1 : 0;

    if (trustCfg.enabled && typeof trustCfg.warnPenalty === "number") {
      u.trust = clampTrust(
        u.trust + trustCfg.warnPenalty,
        trustCfg.min,
        trustCfg.max,
      );
    }
    changed = true;
  }

  if (type === "MUTE") {
    if (trustCfg.enabled && typeof trustCfg.mutePenalty === "number") {
      u.trust = clampTrust(
        u.trust + trustCfg.mutePenalty,
        trustCfg.min,
        trustCfg.max,
      );
    }
    changed = true;
  }

  if (changed) {
    recordTrustChange(
      u,
      type === "WARN" ? "unwarn" : "unmute",
      before,
      new Date(),
    );
  }

  await u.save();
  return u;
}

// ------------------------------
// Trust médio por servidor
// ------------------------------
// A agregação é consultada a cada mensagem potencialmente sinalizada pela
// automoderação, por isso é memoizada por guild. O TTL curto mantém o valor
// "vivo" sem martelar a BD com um aggregate por mensagem.
const AVG_TRUST_CACHE_TTL_MS = 5 * 60 * 1000;
const avgTrustCache = new Map(); // guildId -> { exp, avgTrust, sampleSize }

/**
 * Devolve a média de Trust dos utilizadores conhecidos de um servidor.
 * Nunca lança: em caso de falha devolve `{ avgTrust: null, sampleSize: 0 }`,
 * para que a automoderação continue a funcionar com o comportamento base.
 *
 * @param {string} guildId
 * @param {{ ttlMs?: number }} [options]
 * @returns {Promise<{ avgTrust: number|null, sampleSize: number }>}
 */
async function getGuildAverageTrust(
  guildId,
  { ttlMs = AVG_TRUST_CACHE_TTL_MS } = {},
) {
  if (!guildId) return { avgTrust: null, sampleSize: 0 };

  const now = Date.now();
  const cached = avgTrustCache.get(guildId);
  if (cached && cached.exp > now) {
    return { avgTrust: cached.avgTrust, sampleSize: cached.sampleSize };
  }

  let stats = { avgTrust: null, sampleSize: 0 };

  try {
    const rows = await User.aggregate([
      { $match: { guildId } },
      {
        $group: {
          _id: null,
          avgTrust: { $avg: "$trust" },
          sampleSize: { $sum: 1 },
        },
      },
    ]);

    const row = Array.isArray(rows) ? rows[0] : null;
    if (row) {
      stats = {
        avgTrust: Number.isFinite(row.avgTrust) ? row.avgTrust : null,
        sampleSize: Number(row.sampleSize) || 0,
      };
    }
  } catch {
    // Falha de BD não deve bloquear a moderação: devolve o estado neutro.
    return stats;
  }

  avgTrustCache.set(guildId, {
    exp: now + ttlMs,
    avgTrust: stats.avgTrust,
    sampleSize: stats.sampleSize,
  });
  return stats;
}

/**
 * Limpa a memoização do Trust médio (um guild específico ou toda a cache).
 * @param {string} [guildId]
 */
function clearAvgTrustCache(guildId) {
  if (guildId) avgTrustCache.delete(guildId);
  else avgTrustCache.clear();
}

module.exports = {
  getOrCreateUser,
  addWarning,
  resetWarnings,
  applyMutePenalty,
  resetUser,
  removeInfractionEffects,
  getGuildAverageTrust,
  clearAvgTrustCache,
};
