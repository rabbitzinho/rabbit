// src/systems/levels.js
//
// Sistema de níveis (XP) — feature opcional "levels".
// Atribui XP por mensagem, recalcula níveis e expõe o ranking do servidor.

const { EmbedBuilder } = require("discord.js");
const { getFeature } = require("./featuresService");
const { tContext } = require("./i18n");

let Level = null;
try {
  Level = require("../database/models/Level");
} catch (err) {
  console.warn("[levels] Level model not available:", err?.message || err);
}

// XP total necessário para atingir um nível (fórmula acumulativa simples).
function xpForLevel(level) {
  const l = Math.max(0, Math.floor(Number(level) || 0));
  return 5 * l * l + 50 * l + 100;
}

// Nível correspondente a um total de XP.
function levelFromXp(xp) {
  const total = Math.max(0, Math.floor(Number(xp) || 0));
  let level = 0;
  while (xpForLevel(level + 1) <= total) level += 1;
  return level;
}

// Anuncia a subida de nível no canal configurado (ou no próprio canal).
async function announceLevelUp(message, level, cfg) {
  const content = await tContext(message, "levels.levelUp", {
    user: `<@${message.author.id}>`,
    level,
  });

  // Embed no estilo dos bots de referência: avatar do membro no cabeçalho,
  // título curto e a mensagem de subida como descrição.
  const author = message.author;
  const embed = new EmbedBuilder()
    .setAuthor({
      name: author.username || "Membro",
      iconURL:
        typeof author.displayAvatarURL === "function"
          ? author.displayAvatarURL({ size: 128 })
          : undefined,
    })
    .setTitle(await tContext(message, "levels.levelUpTitle"))
    .setDescription(content)
    .setColor("#7c3aed")
    .setTimestamp(new Date());

  const channelId = cfg.announceChannelId || message.channelId;
  let channel = message.guild.channels.cache.get(channelId) || null;
  if (!channel) {
    channel = await message.guild.channels.fetch(channelId).catch(() => null);
  }
  if (!channel) channel = message.channel;
  if (channel && typeof channel.send === "function") {
    await channel.send({ embeds: [embed] }).catch(() => null);
  }
}

async function awardXp(_client, message) {
  try {
    if (!Level) return;
    if (!message?.guild || !message.author || message.author.bot) return;

    const guildId = message.guild.id;
    const cfg = await getFeature(guildId, "levels");
    if (cfg?.enabled !== true) return;

    const userId = message.author.id;
    const now = new Date();
    const cooldownMs = Math.max(0, Number(cfg.cooldownSeconds) || 0) * 1000;

    const existing = await Level.findOne({ guildId, userId })
      .lean()
      .catch(() => null);

    // Cooldown anti-farm: dentro do intervalo conta a mensagem mas não dá XP.
    if (existing?.lastXpAt && cooldownMs > 0) {
      const elapsed = now.getTime() - new Date(existing.lastXpAt).getTime();
      if (elapsed < cooldownMs) {
        await Level.updateOne(
          { guildId, userId },
          { $inc: { messages: 1 } },
        ).catch(() => null);
        return;
      }
    }

    const min = Math.max(0, Number(cfg.xpMin) || 0);
    const max = Math.max(min, Number(cfg.xpMax) || min);
    const gain = min + Math.floor(Math.random() * (max - min + 1));

    const beforeLevel = Number(existing?.level) || 0;
    const newXp = (Number(existing?.xp) || 0) + gain;
    const newLevel = levelFromXp(newXp);

    const updated = await Level.findOneAndUpdate(
      { guildId, userId },
      {
        $set: { xp: newXp, level: newLevel, lastXpAt: now },
        $inc: { messages: 1 },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    ).catch((err) => {
      console.error("[levels] Failed to update Level:", err);
      return null;
    });

    if (updated && newLevel > beforeLevel) {
      await announceLevelUp(message, newLevel, cfg).catch(() => null);
    }
  } catch (err) {
    console.error("[levels] awardXp error:", err);
  }
}

async function getRank(guildId, userId) {
  if (!Level) return { xp: 0, level: 0, messages: 0, rank: null };

  const doc = await Level.findOne({ guildId, userId })
    .lean()
    .catch(() => null);
  const xp = Number(doc?.xp) || 0;
  const higher = await Level.countDocuments({ guildId, xp: { $gt: xp } }).catch(
    () => 0,
  );

  return {
    xp,
    level: Number(doc?.level) || 0,
    messages: Number(doc?.messages) || 0,
    rank: doc ? higher + 1 : null,
  };
}

module.exports = {
  xpForLevel,
  levelFromXp,
  awardXp,
  getRank,
  // Modelo Level (lazy e null-safe).
  get Level() {
    return Level;
  },
};
