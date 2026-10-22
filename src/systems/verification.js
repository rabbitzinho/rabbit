// src/systems/verification.js
//
// Verificação (feature opcional): um sweep periódico expulsa membros que não
// adquiriram o cargo de verificação dentro do tempo configurado.

const { getFeatures } = require("./featuresService");

let sweepInterval = null;

async function sweepGuild(guild) {
  try {
    const features = await getFeatures(guild.id);
    const cfg = features?.verification;
    if (!cfg || cfg.enabled !== true) return;

    const minutes = Number(cfg.kickAfterMinutes) || 0;
    if (minutes <= 0) return;

    const roleId = cfg.roleId;
    const cutoff = Date.now() - minutes * 60 * 1000;

    const members = await guild.members.fetch().catch(() => null);
    if (!members) return;

    for (const member of members.values()) {
      try {
        if (member.user?.bot) continue;
        if (roleId && member.roles?.cache?.has(roleId)) continue;

        const joinedAt = member.joinedAt ? member.joinedAt.getTime() : null;
        if (!joinedAt || joinedAt > cutoff) continue;

        await guild.members
          .kick(member.id, "Verificação não concluída")
          .catch(() => null);
      } catch (err) {
        console.error("[verification] Failed to process member:", err);
      }
    }
  } catch (err) {
    console.error("[verification] Guild sweep error:", err);
  }
}

async function sweepAll(client) {
  try {
    if (!client?.guilds?.cache) return;
    for (const guild of client.guilds.cache.values()) {
      await sweepGuild(guild);
    }
  } catch (err) {
    console.error("[verification] sweep error:", err);
  }
}

function startVerificationSweep(client) {
  if (sweepInterval) return sweepInterval;
  sweepInterval = setInterval(() => {
    sweepAll(client).catch(() => null);
  }, 60 * 1000);
  if (typeof sweepInterval.unref === "function") sweepInterval.unref();
  return sweepInterval;
}

function stopVerificationSweep() {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
}

module.exports = {
  startVerificationSweep,
  stopVerificationSweep,
};
