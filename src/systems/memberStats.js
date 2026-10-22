// src/systems/memberStats.js
//
// Registo agregado de entradas/saídas de membros por servidor e por dia.
// O Discord não fornece histórico retroativo, por isso as estatísticas de
// "últimos 7 dias" são construídas a partir do momento em que o bot começa a
// observar os eventos guildMemberAdd / guildMemberRemove.

/**
 * Incrementa o contador do dia atual (UTC) para o servidor indicado.
 * @param {string} guildId
 * @param {'joins'|'leaves'} field
 */
async function recordMemberEvent(guildId, field) {
  if (!guildId) return;
  if (field !== "joins" && field !== "leaves") return;

  try {
    const MemberStat = require("../database/models/MemberStat");
    const date = new Date().toISOString().slice(0, 10);
    await MemberStat.updateOne(
      { guildId, date },
      { $inc: { [field]: 1 } },
      { upsert: true },
    ).exec();
  } catch (err) {
    console.warn(
      "[memberStats] Falha ao registar evento:",
      err?.message || err,
    );
  }
}

/**
 * Soma as entradas/saídas dos últimos `days` dias (UTC, inclusive hoje).
 * @returns {Promise<{joins:number, leaves:number}>}
 */
async function getRecentCounts(guildId, days) {
  const span = Math.max(1, Number(days) || 7);
  try {
    const MemberStat = require("../database/models/MemberStat");
    const since = new Date(Date.now() - (span - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
    const rows = await MemberStat.find({
      guildId,
      date: { $gte: since },
    }).lean();
    let joins = 0;
    let leaves = 0;
    for (const r of rows) {
      joins += Number(r.joins) || 0;
      leaves += Number(r.leaves) || 0;
    }
    return { joins, leaves };
  } catch (err) {
    console.warn("[memberStats] Falha ao ler contadores:", err?.message || err);
    return { joins: 0, leaves: 0 };
  }
}

module.exports = { recordMemberEvent, getRecentCounts };
