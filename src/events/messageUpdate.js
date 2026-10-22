// src/events/messageUpdate.js
//
// Log de mensagens editadas (feature opcional "messageLogs").

const { EmbedBuilder } = require("discord.js");
const { getFeature } = require("../systems/featuresService");

let GuildConfig = null;
try {
  GuildConfig = require("../database/models/GuildConfig");
} catch (err) {
  console.warn(
    "[messageUpdate] GuildConfig model not available:",
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
  client.on("messageUpdate", async (oldMessage, newMessage) => {
    try {
      if (!newMessage?.guild) return;

      if (newMessage.partial) {
        try {
          await newMessage.fetch();
        } catch {
          return;
        }
      }

      const guild = newMessage.guild;
      const author = newMessage.author;
      if (!author) return;

      const cfg = await getFeature(guild.id, "messageLogs");
      if (cfg?.enabled !== true) return;
      if (cfg.ignoreBots !== false && author.bot) return;

      const oldContent = String(oldMessage?.content ?? "");
      const newContent = String(newMessage.content ?? "");
      if (oldContent === newContent) return;

      const channel = await resolveLogChannel(guild, cfg.channelId);
      if (!channel) return;

      const embed = new EmbedBuilder()
        .setTitle("✏️ Mensagem editada")
        .setColor("Orange")
        .addFields(
          {
            name: "Autor",
            value: `${author.tag || author.username} (\`${author.id}\`)`,
          },
          { name: "Canal", value: `<#${newMessage.channelId}>` },
          { name: "Antes", value: truncate(oldContent) || "*(vazio)*" },
          { name: "Depois", value: truncate(newContent) || "*(vazio)*" },
        )
        .setTimestamp(new Date());

      await channel.send({ embeds: [embed] }).catch(() => null);
    } catch (err) {
      console.error("[messageUpdate] Error:", err);
    }
  });
};
