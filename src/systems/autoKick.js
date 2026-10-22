// src/systems/autoKick.js
//
// AutoKick (feature opcional): expulsa membros que acumulam demasiadas infrações.

const { getFeature } = require("./featuresService");
const logger = require("./logger");

let Infraction = null;
try {
  Infraction = require("../database/models/Infraction");
} catch (err) {
  console.warn(
    "[autoKick] Infraction model not available:",
    err?.message || err,
  );
}

async function checkAutoKick(client, guildId, userId) {
  try {
    if (!Infraction || !client) return;
    if (!guildId || !userId) return;

    const cfg = await getFeature(guildId, "autoKick");
    if (cfg?.enabled !== true) return;

    const limit = Math.max(1, Number(cfg.infractionsToKick) || 1);

    // Critério de "infrações ativas": todas as registadas no modelo (que tem TTL de 90 dias).
    const total = await Infraction.countDocuments({ guildId, userId }).catch(
      () => 0,
    );
    if (total < limit) return;

    const guild = client.guilds?.cache?.get(guildId);
    if (!guild) return;

    const reason = `AutoKick: ${total} infrações (limite ${limit})`;
    try {
      await guild.members.kick(userId, reason);
      await logger(
        client,
        "AutoKick",
        { id: userId },
        client.user,
        `Membro expulso automaticamente.\nInfrações: **${total}/${limit}**`,
        guild,
      );
    } catch (err) {
      console.error("[autoKick] Failed to kick user:", err);
    }
  } catch (err) {
    console.error("[autoKick] checkAutoKick error:", err);
  }
}

module.exports = { checkAutoKick };
