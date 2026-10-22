// src/events/messageCreate.js

const autoModeration = require("../systems/autoModeration");
const antiSpam = require("../systems/antiSpam");

let levels = null;
try {
  levels = require("../systems/levels");
} catch (err) {
  console.warn(
    "[messageCreate] levels system not available:",
    err?.message || err,
  );
}

let UserActivity = null;
try {
  UserActivity = require("../database/models/UserActivity");
} catch {}
const mongoose = require("../database/connect");

function getDayStartUtc(d = new Date()) {
  const day = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
  );
  return day;
}

module.exports = (client) => {
  client.on("messageCreate", async (message) => {
    try {
      if (!message) return;

      // Garantir que a mensagem está completa (caso seja partial)
      if (message.partial) {
        try {
          await message.fetch();
        } catch {
          return;
        }
      }

      // Ignorar DMs, bots e mensagens sem autor
      if (!message.guild) return;
      if (!message.author || message.author.bot) return;

      const content = message.content;
      if (!content || typeof content !== "string") return;

      // Activity tracking (used by the dashboard panel "Utilizadores Online")
      if (UserActivity && mongoose?.connection?.readyState === 1) {
        const day = getDayStartUtc(new Date());
        UserActivity.updateOne(
          { guildId: message.guild.id, userId: message.author.id, day },
          { $inc: { messages: 1 }, $set: { updatedAt: new Date() } },
          { upsert: true },
        ).catch(() => null);
      }

      // A partir daqui: apenas moderação automática (AutoMod + AntiSpam).
      // Toda a moderação manual é feita via comandos slash (/warn, /mute, ...).
      await autoModeration(message, client);

      await antiSpam(message, client);

      // Sistema de níveis (XP) — feature opcional "levels".
      if (levels && typeof levels.awardXp === "function") {
        try {
          await levels.awardXp(client, message);
        } catch (err) {
          console.error("[messageCreate] levels awardXp error:", err);
        }
      }
    } catch (err) {
      console.error("[messageCreate] Critical error:", err);
    }
  });
};
