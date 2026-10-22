// src/systems/ticketThreads.js
// Sistema de tickets baseado em threads + reações.

const { EmbedBuilder, ChannelType } = require("discord.js");
const TicketLog = require("../database/models/TicketLog");
const Ticket = require("../database/models/Ticket");
const TicketCounter = require("../database/models/TicketCounter");
const TicketOpenLock = require("../database/models/TicketOpenLock");
const { isStaff } = require("../utils/staff");
const { fetchMember } = require("../services/discordFetchCache");
const { getFeature } = require("./featuresService");
const { emojiMatches, toReactable } = require("./reactionRoles");
const { getFeatureText, applyTemplate } = require("./featureText");

const recentTicketOpens = new Map();
const RECENT_OPEN_WINDOW_MS = 5000;

function isRecentOpen(key) {
  const ts = recentTicketOpens.get(key);
  if (!ts) return false;
  if (Date.now() - ts > RECENT_OPEN_WINDOW_MS) {
    recentTicketOpens.delete(key);
    return false;
  }
  return true;
}

function markRecentOpen(key) {
  recentTicketOpens.set(key, Date.now());
}

async function getNextTicketNumber(guildId) {
  // Ensure the counter starts from the current max ticketNumber + 1.
  // This avoids collisions when there are already tickets in the DB
  // but the counter document doesn't exist yet (fresh deploy, new model, etc.).
  const existingCounter = await TicketCounter.findOne({ guildId }).lean();
  if (!existingCounter) {
    const maxTicket = await Ticket.findOne({ guildId })
      .sort({ ticketNumber: -1 })
      .select("ticketNumber")
      .lean();
    const startFrom =
      maxTicket && typeof maxTicket.ticketNumber === "number"
        ? Math.max(1, maxTicket.ticketNumber + 1)
        : 1;
    // Upsert without increment: set the initial value only if missing.
    await TicketCounter.updateOne(
      { guildId },
      { $setOnInsert: { nextTicketNumber: startFrom } },
      { upsert: true },
    );
  }

  // Allocate one number atomically. We store the "next" value in the doc,
  // so the allocated ticketNumber is (nextTicketNumber - 1).
  const doc = await TicketCounter.findOneAndUpdate(
    { guildId },
    { $inc: { nextTicketNumber: 1 } },
    { returnDocument: "after" },
  ).lean();

  const next =
    doc && typeof doc.nextTicketNumber === "number" ? doc.nextTicketNumber : 2;
  return Math.max(1, next - 1);
}

// Emoji a usar para abrir tickets
const OPEN_EMOJI = "🎫";
// Emoji para fechar tickets dentro da thread
const CLOSE_EMOJI = "🔒";

async function getTicketSettings(guildId) {
  const cfg = await getFeature(guildId, "tickets").catch(() => null);
  return (
    cfg || {
      enabled: false,
      channelId: null,
      messageId: null,
      openEmoji: OPEN_EMOJI,
      closeEmoji: CLOSE_EMOJI,
    }
  );
}

/**
 * Cria uma nova thread de ticket a partir da mensagem-base
 * quando alguém reage com o emoji de abertura.
 * @param {impor'discord.js'.MessageReaction} reaction
 * @param {impor'discord.js'.User} user
 */
async function handleTicketOpen(reaction, user) {
  try {
    if (!reaction || !reaction.message) return;
    if (!user || user.bot) return;

    const message = reaction.message;
    const guild = message.guild;
    if (!guild) return;
    const settings = await getTicketSettings(guild.id);
    if (settings.enabled !== true) return false;

    if (!emojiMatches(settings.openEmoji || OPEN_EMOJI, reaction.emoji))
      return false;

    // Anti-duplicate: the same reaction event can arrive twice.
    const dedupeKey = `${guild.id}:${user.id}:${message.id}`;
    if (isRecentOpen(dedupeKey)) return false;
    markRecentOpen(dedupeKey);

    // Cross-process / cross-event lock: prevents duplicate thread creation even if two events overlap.
    let lockAcquired = false;
    try {
      await TicketOpenLock.create({
        guildId: guild.id,
        userId: user.id,
        messageId: message.id,
      });
      lockAcquired = true;
    } catch (e) {
      // Duplicate lock means another open is in progress.
      const isDup =
        e &&
        (Number(e.code) === 11000 ||
          String(e.message || "").includes("E11000"));
      if (isDup) return false;
      throw e;
    }

    try {
      // If this user already has an open ticket, don't create a new one.
      const existing = await Ticket.findOne({
        guildId: guild.id,
        userId: user.id,
        status: "open",
      }).lean();
      if (existing && existing.channelId) {
        try {
          const ch = await guild.channels
            .fetch(existing.channelId)
            .catch(() => null);
          if (ch) {
            const vars = {
              channelId: existing.channelId,
              user: `<@${user.id}>`,
            };
            const text = applyTemplate(
              await getFeatureText({
                guildId: guild.id,
                feature: "tickets",
                field: "alreadyOpenMessage",
                value: settings.alreadyOpenMessage,
                params: vars,
              }),
              vars,
            );
            await ch.send({ content: text }).catch(() => {});
          }
        } catch {}
        return false;
      }

      // Generate sequential ticket number atomically per guild
      const ticketNumber = await getNextTicketNumber(guild.id);
      const ticketName = `ticket-${String(ticketNumber).padStart(3, "0")}`;

      // Criar thread privada no canal (não ligada diretamente à mensagem base)
      const parentChannel = message.channel;
      const thread = await parentChannel.threads.create({
        name: ticketName,
        type: ChannelType.PrivateThread,
        autoArchiveDuration: 1440, // 24h
        reason: `Ticket aberto por ${user.tag || user.id}`,
      });

      // Adicionar o utilizador que abriu o ticket
      await thread.members.add(user.id).catch(() => {});

      // Persistir ticket (para dashboard e replies)
      // We retry a few times in case of a rare race on ticketNumber.
      let ticketDoc;
      let createdTicketNumber = ticketNumber;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          ticketDoc = await Ticket.create({
            ticketNumber: createdTicketNumber,
            guildId: guild.id,
            channelId: thread.id,
            userId: user.id,
            username: user.username || user.tag || user.id,
            status: "open",
            createdAt: new Date(),
            lastMessageAt: new Date(),
          });
          break;
        } catch (err) {
          const isDup =
            err &&
            (err.code === 11000 ||
              String(err.message || "").includes("E11000"));
          if (!isDup) throw err;

          // If it's a duplicate open-ticket for the same user, just archive the thread.
          const msg = String(err.message || "");
          const isDupOpenTicket = msg.includes("guildId_1_userId_1_status_1");
          if (isDupOpenTicket) {
            try {
              await thread.setArchived(true, "Duplicate open ticket");
            } catch {}
            return false;
          }

          // Otherwise assume it's a ticketNumber collision; allocate a new number and rename the thread.
          createdTicketNumber = await getNextTicketNumber(guild.id);
          const newName = `ticket-${String(createdTicketNumber).padStart(3, "0")}`;
          try {
            await thread.setName(newName).catch(() => {});
          } catch {}
          // Continue loop and retry create.
        }
      }

      if (!ticketDoc) {
        try {
          await thread.setArchived(true, "Failed to create ticket");
        } catch {}
        return false;
      }

      // Registar log (mantido por compatibilidade, agora com ligações)
      await TicketLog.create({
        ticketNumber: createdTicketNumber,
        ticketId: ticketDoc._id,
        guildId: guild.id,
        channelId: thread.id,
        userId: user.id,
        username: user.username || user.tag || user.id,
        createdAt: new Date(),
      });

      // Embed de boas-vindas dentro da thread
      const welcomeVars = {
        user: `${user}`,
        username: user.username || "",
        tag: user.tag || user.username || "",
        server: guild.name,
        closeEmoji: settings.closeEmoji || CLOSE_EMOJI,
      };
      const welcomeDescription = applyTemplate(
        await getFeatureText({
          guildId: guild.id,
          feature: "tickets",
          field: "welcomeMessage",
          value: settings.welcomeMessage,
          params: welcomeVars,
        }),
        welcomeVars,
      );
      const embed = new EmbedBuilder()
        .setTitle(
          await getFeatureText({
            guildId: guild.id,
            feature: "tickets",
            field: "welcomeTitle",
          }),
        )
        .setDescription(welcomeDescription)
        .addFields(
          {
            name: await getFeatureText({
              guildId: guild.id,
              feature: "tickets",
              field: "ticketNumber",
            }),
            value: `\`${String(createdTicketNumber).padStart(3, "0")}\``,
            inline: true,
          },
          {
            name: await getFeatureText({
              guildId: guild.id,
              feature: "tickets",
              field: "openedBy",
            }),
            value: `${user} (\`${user.tag}\`)`,
            inline: true,
          },
        )
        .setFooter({
          text: `Ticket #${String(createdTicketNumber).padStart(3, "0")}`,
        })
        .setTimestamp();

      const controlMessage = await thread.send({ embeds: [embed] });

      // Adicionar reação de fecho
      const closeReactable = toReactable(settings.closeEmoji || CLOSE_EMOJI);
      if (closeReactable)
        await controlMessage.react(closeReactable).catch(() => {});
      return true;
    } finally {
      if (lockAcquired) {
        try {
          await TicketOpenLock.deleteOne({
            guildId: guild.id,
            userId: user.id,
          }).catch(() => {});
        } catch {}
      }
    }
  } catch (err) {
    console.error("[ticketThreads] handleTicketOpen error:", err);
  }
  return false;
}

/**
 * Fecha uma thread de ticket quando alguém reage com o emoji de fechar.
 * @param {impor'discord.js'.MessageReaction} reaction
 * @param {impor'discord.js'.User} user
 */
async function handleTicketClose(reaction, user) {
  try {
    const message = reaction.message;
    const channel = message.channel;

    if (!channel || !channel.isThread || !channel.isThread()) return;
    if (!channel.name || !channel.name.startsWith("ticket-")) return;
    if (!user || user.bot) return;

    const guild = channel.guild;
    if (!guild) return;
    const settings = await getTicketSettings(guild.id);

    if (!emojiMatches(settings.closeEmoji || CLOSE_EMOJI, reaction.emoji))
      return false;

    // Verificar permissões
    const member = await fetchMember(guild, user.id);
    if (!member) return;

    const canClose = await isStaff(member, "tickets").catch(() => false);

    if (!canClose) {
      const vars = { user: `${user}` };
      const text = applyTemplate(
        await getFeatureText({
          guildId: guild.id,
          feature: "tickets",
          field: "cannotClose",
          params: vars,
        }),
        vars,
      );
      await channel.send(text).catch(() => {});
      return false;
    }

    // Extrair número do ticket a partir do nome da thread
    const ticketNumberStr = channel.name.replace("ticket-", "");
    const ticketNumber = parseInt(ticketNumberStr, 10);

    const closedAt = new Date();

    if (!Number.isNaN(ticketNumber)) {
      await TicketLog.findOneAndUpdate(
        { guildId: guild.id, ticketNumber },
        {
          $set: {
            closedAt,
            closedById: user.id,
            closedByUsername: user.username || user.tag || user.id,
          },
        },
      ).catch(() => {});

      // Update persistent ticket
      await Ticket.findOneAndUpdate(
        { guildId: guild.id, ticketNumber },
        {
          $set: {
            status: "closed",
            closedAt,
            closedById: user.id,
            closedByUsername: user.username || user.tag || user.id,
            lastMessageAt: closedAt,
            lastResponderId: user.id,
            lastResponderName: user.username || user.tag || user.id,
            lastResponderAt: closedAt,
          },
        },
      ).catch(() => {});
    } else {
      // Fallback: locate by channelId
      await Ticket.findOneAndUpdate(
        { guildId: guild.id, channelId: channel.id },
        {
          $set: {
            status: "closed",
            closedAt,
            closedById: user.id,
            closedByUsername: user.username || user.tag || user.id,
            lastMessageAt: closedAt,
            lastResponderId: user.id,
            lastResponderName: user.username || user.tag || user.id,
            lastResponderAt: closedAt,
          },
        },
      ).catch(() => {});
    }

    const closeVars = { user: `${user}` };
    const closeText = applyTemplate(
      await getFeatureText({
        guildId: guild.id,
        feature: "tickets",
        field: "closeMessage",
        value: settings.closeMessage,
        params: closeVars,
      }),
      closeVars,
    );
    await channel.send(closeText).catch(() => {});

    await channel.setLocked(true, "Ticket encerrado").catch(() => {});
    await channel.setArchived(true, "Ticket arquivado").catch(() => {});
    return true;
  } catch (err) {
    console.error("[ticketThreads] handleTicketClose error:", err);
  }
  return false;
}

module.exports = {
  handleTicketOpen,
  handleTicketClose,
  OPEN_EMOJI,
  CLOSE_EMOJI,
};
