// src/events/messageDelete.js
//
// Log de mensagens apagadas (feature opcional "messageLogs").

const { EmbedBuilder } = require("discord.js");
const { getFeature } = require("../systems/featuresService");

let GuildConfig = null;
try {
  GuildConfig = require("../database/models/GuildConfig");
} catch (err) {
  console.warn(
    "[messageDelete] GuildConfig model not available:",
    err?.message || err,
  );
}

function truncate(str, max = 1000) {
  const s = String(str ?? "");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

async function resolveLogChannel(guild, channelId) {
  if (channelId) {
    const ch =
      guild.channels.cache.get(channelId) ||
      (await guild.channels.fetch(channelId).catch(() => null));
    if (ch?.isTextBased?.()) return ch;
  }

  if (GuildConfig) {
    const doc = await GuildConfig.findOne({ guildId: guild.id })
      .lean()
      .catch(() => null);
    if (doc?.logChannelId) {
      const ch =
        guild.channels.cache.get(doc.logChannelId) ||
        (await guild.channels.fetch(doc.logChannelId).catch(() => null));
      if (ch?.isTextBased?.()) return ch;
    }
  }

  return null;
}

module.exports = (client) => {
  client.on("messageDelete", async (message) => {
    try {
      if (!message?.guild) return;

      // Numa mensagem partial só temos metadados; tentamos completar se possível.
      if (message.partial) {
        try {
          await message.fetch();
        } catch {
          // segue com os metadados disponíveis
        }
      }

      const guild = message.guild;
      const author = message.author || null;

      const cfg = await getFeature(guild.id, "messageLogs");
      if (cfg?.enabled !== true) return;
      if (author?.bot && cfg.ignoreBots !== false) return;

      const channel = await resolveLogChannel(guild, cfg.channelId);
      if (!channel) return;

      const content = truncate(String(message.content ?? ""));

      const embed = new EmbedBuilder()
        .setTitle("🗑️ Mensagem apagada")
        .setColor("Red")
        .addFields(
          {
            name: "Autor",
            value: author
              ? `${author.tag || author.username} (\`${author.id}\`)`
              : "Desconhecido",
          },
          { name: "Canal", value: `<#${message.channelId}>` },
          { name: "Conteúdo", value: content || "*(sem conteúdo disponível)*" },
        )
        .setTimestamp(new Date());

      if (author?.displayAvatarURL) {
        const icon = author.displayAvatarURL({ size: 128 });
        if (icon) embed.setThumbnail(icon);
      }

      await channel.send({ embeds: [embed] }).catch(() => null);
    } catch (err) {
      console.error("[messageDelete] Error:", err);
    }
  });
};
