// src/systems/starboard.js
//
// Starboard (feature opcional): destaca mensagens que atingem um número de
// reações configurado, publicando-as num canal dedicado.

const { EmbedBuilder } = require("discord.js");
const { getFeature } = require("./featuresService");

let StarboardEntry = null;
try {
  StarboardEntry = require("../database/models/StarboardEntry");
} catch (err) {
  console.warn(
    "[starboard] StarboardEntry model not available:",
    err?.message || err,
  );
}

// Compara o emoji configurado com o emoji (nome ou id) da reação.
function matchEmoji(reaction, emoji) {
  const target = String(emoji || "").trim();
  if (!target) return false;
  const name = reaction.emoji?.name || null;
  const id = reaction.emoji?.id || null;
  return target === name || target === id;
}

// Garante reaction + message completos (podem ser partial).
async function loadContext(reaction) {
  if (!reaction?.message) return null;

  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return null;
    }
  }

  const message = reaction.message;
  if (message.partial) {
    try {
      await message.fetch();
    } catch {
      return null;
    }
  }

  const guild = message.guild;
  if (!guild) return null;
  return { message, guild };
}

function buildEmbed(message, guild, count) {
  const author = message.author;
  const jumpUrl =
    message.url ||
    `https://discord.com/channels/${guild.id}/${message.channelId}/${message.id}`;

  const desc =
    String(message.content || "").slice(0, 1000) || "*(sem conteúdo de texto)*";

  const embed = new EmbedBuilder()
    .setDescription(desc)
    .setColor("Yellow")
    .addFields({ name: "Original", value: `[Ir para a mensagem](${jumpUrl})` })
    .setFooter({ text: `${count} reação(ões)` })
    .setTimestamp(new Date());

  if (author) {
    embed.setAuthor({
      name: author.tag || author.username || "Unknown",
      iconURL: author.displayAvatarURL?.({ size: 128 }) || undefined,
    });
  }

  return embed;
}

async function resolveStarChannel(guild, channelId) {
  if (!channelId) return null;
  const ch =
    guild.channels.cache.get(channelId) ||
    (await guild.channels.fetch(channelId).catch(() => null));
  if (ch && typeof ch.send === "function") return ch;
  return null;
}

async function publishOrUpdate(message, guild, cfg, count) {
  const entry = await StarboardEntry.findOneAndUpdate(
    { guildId: guild.id, sourceMessageId: message.id },
    {
      $set: {
        channelId: message.channelId,
        authorId: message.author?.id || null,
        count,
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  ).catch((err) => {
    console.error("[starboard] Failed to upsert entry:", err);
    return null;
  });

  if (!entry) return;

  const starChannel = await resolveStarChannel(guild, cfg.channelId);
  if (!starChannel) return;

  const embed = buildEmbed(message, guild, count);
  const content = `${cfg.emoji} **${count}** <#${message.channelId}>`;

  if (entry.starboardMessageId) {
    const existing = await starChannel.messages
      .fetch(entry.starboardMessageId)
      .catch(() => null);
    if (existing) {
      await existing.edit({ content, embeds: [embed] }).catch(() => null);
      return;
    }
  }

  const sent = await starChannel
    .send({ content, embeds: [embed] })
    .catch(() => null);
  if (sent) {
    await StarboardEntry.updateOne(
      { _id: entry._id },
      { $set: { starboardMessageId: sent.id } },
    ).catch(() => null);
  }
}

async function handleReactionAdd(reaction, user) {
  try {
    if (!StarboardEntry) return;
    if (user?.bot) return;

    const ctx = await loadContext(reaction);
    if (!ctx) return;
    const { message, guild } = ctx;

    const cfg = await getFeature(guild.id, "starboard");
    if (cfg?.enabled !== true) return;
    if (!cfg.channelId) return;
    // NUNCA fazer starboard do próprio canal do starboard.
    if (message.channelId === cfg.channelId) return;
    if (!matchEmoji(reaction, cfg.emoji)) return;
    // Ignora reações do próprio autor da mensagem.
    if (message.author?.id && user?.id && message.author.id === user.id) return;

    const count = Math.max(0, Number(reaction.count) || 0);
    const threshold = Math.max(1, Number(cfg.threshold) || 1);
    if (count < threshold) return;

    await publishOrUpdate(message, guild, cfg, count);
  } catch (err) {
    console.error("[starboard] handleReactionAdd error:", err);
  }
}

async function handleReactionRemove(reaction, _user) {
  try {
    if (!StarboardEntry) return;

    const ctx = await loadContext(reaction);
    if (!ctx) return;
    const { message, guild } = ctx;

    const cfg = await getFeature(guild.id, "starboard");
    if (cfg?.enabled !== true) return;
    if (!cfg.channelId) return;
    if (message.channelId === cfg.channelId) return;
    if (!matchEmoji(reaction, cfg.emoji)) return;

    const entry = await StarboardEntry.findOne({
      guildId: guild.id,
      sourceMessageId: message.id,
    })
      .lean()
      .catch(() => null);
    if (!entry) return;

    const count = Math.max(0, Number(reaction.count) || 0);
    const threshold = Math.max(1, Number(cfg.threshold) || 1);

    // Abaixo do limite: apaga a mensagem do starboard e a entrada.
    if (count < threshold) {
      const starChannel = await resolveStarChannel(guild, cfg.channelId);
      if (starChannel && entry.starboardMessageId) {
        const existing = await starChannel.messages
          .fetch(entry.starboardMessageId)
          .catch(() => null);
        if (existing) await existing.delete().catch(() => null);
      }
      await StarboardEntry.deleteOne({ _id: entry._id }).catch(() => null);
      return;
    }

    // Atualiza a contagem na entrada (e na mensagem, se existir).
    await StarboardEntry.updateOne(
      { _id: entry._id },
      { $set: { count } },
    ).catch(() => null);

    const starChannel = await resolveStarChannel(guild, cfg.channelId);
    if (starChannel && entry.starboardMessageId) {
      const existing = await starChannel.messages
        .fetch(entry.starboardMessageId)
        .catch(() => null);
      if (existing) {
        await existing
          .edit({
            content: `${cfg.emoji} **${count}** <#${message.channelId}>`,
            embeds: [buildEmbed(message, guild, count)],
          })
          .catch(() => null);
      }
    }
  } catch (err) {
    console.error("[starboard] handleReactionRemove error:", err);
  }
}

module.exports = {
  handleReactionAdd,
  handleReactionRemove,
};
