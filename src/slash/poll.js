// src/slash/poll.js

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { tContext } = require("../systems/i18n");
const { getFeature } = require("../systems/featuresService");
const { safeReply } = require("../utils/discord");

let Poll = null;
try {
  Poll = require("../database/models/Poll");
} catch (err) {
  console.warn("[slash/poll] Poll model not available:", err?.message || err);
}

const MAX_OPTIONS = 10;
const BUTTONS_PER_ROW = 5;
const NUMBER_EMOJIS = [
  "1️⃣",
  "2️⃣",
  "3️⃣",
  "4️⃣",
  "5️⃣",
  "6️⃣",
  "7️⃣",
  "8️⃣",
  "9️⃣",
  "🔟",
];

// Constrói embed + botões da enquete (reutilizado ao atualizar a mensagem).
function buildPollMessage(poll) {
  const options = Array.isArray(poll.options) ? poll.options : [];
  const counts = Array.isArray(poll.counts) ? poll.counts : [];

  const lines = options.map(
    (opt, i) =>
      `${NUMBER_EMOJIS[i] || `(${i + 1})`} ${opt} — **${Number(counts[i]) || 0}**`,
  );

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${String(poll.question || "").slice(0, 240)}`)
    .setDescription(lines.join("\n") || "—")
    .setColor("Blurple")
    .setTimestamp(new Date());

  const rows = [];
  for (let i = 0; i < options.length; i += BUTTONS_PER_ROW) {
    const row = new ActionRowBuilder();
    options.slice(i, i + BUTTONS_PER_ROW).forEach((_opt, j) => {
      const idx = i + j;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`poll:${poll._id}:${idx}`)
          .setLabel(NUMBER_EMOJIS[idx] || String(idx + 1))
          .setStyle(ButtonStyle.Secondary),
      );
    });
    rows.push(row);
  }

  return { embeds: [embed], components: rows };
}

async function pollSlash(_client, interaction) {
  try {
    if (!interaction?.guild) return;
    if (!Poll) {
      return safeReply(
        interaction,
        { content: await tContext(interaction, "common.unexpectedError") },
        { ephemeral: true },
      );
    }

    const cfg = await getFeature(interaction.guild.id, "polls");
    if (cfg?.enabled !== true) {
      return safeReply(
        interaction,
        { content: await tContext(interaction, "poll.disabled") },
        { ephemeral: true },
      );
    }

    const question = String(
      interaction.options.getString("question") || "",
    ).trim();
    const raw = String(interaction.options.getString("options") || "");
    const options = raw
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_OPTIONS);

    if (!question || options.length < 2) {
      return safeReply(
        interaction,
        { content: await tContext(interaction, "poll.invalidOptions") },
        { ephemeral: true },
      );
    }

    const poll = await Poll.create({
      guildId: interaction.guild.id,
      channelId: interaction.channelId,
      authorId: interaction.user.id,
      question,
      options,
      counts: new Array(options.length).fill(0),
    });

    const msg = await interaction.channel
      .send(buildPollMessage(poll))
      .catch(() => null);
    if (msg) {
      poll.messageId = msg.id;
      await poll.save().catch(() => null);
    }

    return safeReply(
      interaction,
      { content: await tContext(interaction, "poll.created") },
      { ephemeral: true },
    );
  } catch (err) {
    console.error("[slash/poll] Error:", err);
    return safeReply(
      interaction,
      { content: await tContext(interaction, "common.unexpectedError") },
      { ephemeral: true },
    );
  }
}

module.exports = pollSlash;
module.exports.buildPollMessage = buildPollMessage;
