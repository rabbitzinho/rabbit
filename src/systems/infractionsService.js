// src/systems/infractionsService.js

const Infraction = require("../database/models/Infraction");
const { incrementInfractions } = require("./status");
const { escapeRegex } = require("../utils/regex");
let CaseCounter = null;

try {
  CaseCounter = require("../database/models/CaseCounter");
} catch {
  // optional
}

async function allocateCaseId(guildId) {
  if (!CaseCounter) return null;
  if (!guildId) return null;

  const doc = await CaseCounter.findOneAndUpdate(
    { guildId },
    { $inc: { nextCaseId: 1 } },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true },
  ).lean();

  // doc.nextCaseId is the value AFTER increment. Our allocated caseId is (nextCaseId - 1).
  const next = Number(doc?.nextCaseId);
  if (!Number.isFinite(next) || next <= 0) return null;
  return next - 1;
}

/**
 * Cria uma infração registada em Mongo, com Case ID incremental (por guild).
 *
 * @param {Object} options
 * @param {Guild}  options.guild
 * @param {User}   options.user
 * @param {User}   options.moderator
 * @param {string} options.type           - 'WARN' | 'MUTE'
 * @param {string} [options.reason]
 * @param {number} [options.duration]     - em ms (para mutes)
 * @param {string} [options.source]       - origem (command, slash, automod, antispam, dashboard, system...)
 */
async function create({
  guild,
  user,
  moderator,
  type,
  reason,
  duration = null,
  source,
}) {
  if (!guild?.id) return null;
  if (!user?.id) return null;
  if (!moderator?.id) return null;
  if (!type) return null;

  const caseId = await allocateCaseId(guild.id).catch(() => null);

  // Discord usernames/tags can change; store a snapshot for dashboard search/history.
  const userTag = user?.tag || user?.username || null;
  const executorTag = moderator?.tag || moderator?.username || null;

  const payload = {
    guildId: guild.id,
    userId: user.id,
    moderatorId: moderator.id,
    type,
    reason: reason || "No reason provided",
    duration: duration ?? null,
    source: source || "unknown",
    userTag,
    executorTag,
  };

  // Only persist caseId when we successfully allocated one.
  if (Number.isFinite(caseId)) payload.caseId = caseId;

  const doc = await Infraction.create(payload);

  try {
    incrementInfractions();
  } catch {}

  return doc;
}

/**
 * Devolve as infrações mais recentes de um utilizador no servidor.
 * Útil para comandos tipo !history e para auditoria rápida.
 */
async function getRecentInfractions(guildId, userId, limit = 10) {
  if (!guildId || !userId) return [];

  const lim = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);

  return Infraction.find({ guildId, userId })
    .sort({ createdAt: -1 })
    .limit(lim)
    .lean();
}

/**
 * Contagem rápida de infrações por tipo (ex: WARN/MUTE) para o utilizador.
 * Opcional mas útil para dashboards e resumos.
 */
async function countInfractionsByType(guildId, userId) {
  if (!guildId || !userId) return {};

  const rows = await Infraction.aggregate([
    { $match: { guildId, userId } },
    { $group: { _id: "$type", count: { $sum: 1 } } },
  ]);

  const out = {};
  for (const r of rows) {
    if (r?._id) out[r._id] = r.count || 0;
  }
  return out;
}

async function getCase(guildId, caseId) {
  if (!guildId || !caseId) return null;
  const n = parseInt(String(caseId), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Infraction.findOne({ guildId, caseId: n }).lean();
}

async function searchCases({
  guildId,
  q = "",
  userId = "",
  type = "",
  source = "",
  page = 1,
  limit = 25,
}) {
  if (!guildId) return { total: 0, items: [] };

  const p = Math.max(parseInt(String(page), 10) || 1, 1);
  const lim = Math.min(Math.max(parseInt(String(limit), 10) || 25, 1), 100);

  const query = { guildId };

  if (userId) query.userId = String(userId).trim();
  if (type) query.type = { $regex: String(type).trim(), $options: "i" };
  if (source) query.source = { $regex: String(source).trim(), $options: "i" };

  const text = String(q || "").trim();
  if (text) {
    const maybeCase = parseInt(text, 10);
    if (Number.isFinite(maybeCase) && maybeCase > 0) {
      query.caseId = maybeCase;
    } else {
      query.$or = [
        { reason: { $regex: escapeRegex(text), $options: "i" } },
        { type: { $regex: text, $options: "i" } },
        { userId: { $regex: text, $options: "i" } },
        { moderatorId: { $regex: text, $options: "i" } },
      ];
    }
  }

  const total = await Infraction.countDocuments(query);
  const items = await Infraction.find(query)
    .sort({ createdAt: -1 })
    .skip((p - 1) * lim)
    .limit(lim)
    .lean();

  return { total, items };
}

async function clearCasesForGuild(guildId) {
  if (!guildId) return { deleted: 0 };
  const res = await Infraction.deleteMany({ guildId });
  return { deleted: res?.deletedCount || 0 };
}

module.exports = {
  create,
  getRecentInfractions,
  countInfractionsByType,
  getCase,
  searchCases,
  clearCasesForGuild,
};
