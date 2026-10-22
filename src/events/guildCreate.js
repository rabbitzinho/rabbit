// src/events/guildCreate.js
//
// Onboarding básico multi-servidor: quando o bot entra num servidor novo
// garante que existe uma GuildConfig e publica uma mensagem curta a explicar
// os próximos passos. Não assume nada sobre servidores já existentes.

function findBotAddEntry(entries, botId, now = Date.now()) {
  const values =
    entries && typeof entries.values === "function"
      ? Array.from(entries.values())
      : Array.isArray(entries)
        ? entries
        : [];
  return (
    values.find((entry) => {
      const targetId = entry && entry.target && String(entry.target.id || "");
      const createdAt = Number(entry && entry.createdTimestamp);
      return (
        targetId === String(botId || "") &&
        Number.isFinite(createdAt) &&
        createdAt <= now + 60_000 &&
        createdAt >= now - 10 * 60_000
      );
    }) || null
  );
}

async function recordBotInvite(client, guild) {
  try {
    const { AuditLogEvent, PermissionFlagsBits } = require("discord.js");
    const botMember = guild.members && guild.members.me;
    if (
      botMember &&
      botMember.permissions &&
      !botMember.permissions.has(PermissionFlagsBits.ViewAuditLog)
    ) {
      console.warn(
        `[guildCreate] Não é possível atribuir o convite em ${guild.id}: falta View Audit Log.`,
      );
      return;
    }

    const auditLogs = await guild.fetchAuditLogs({
      type: AuditLogEvent.BotAdd,
      limit: 10,
    });
    const entry = findBotAddEntry(
      auditLogs && auditLogs.entries,
      client.user && client.user.id,
    );
    if (!entry || !entry.executor) return;

    const DashboardAudit = require("../database/models/DashboardAudit");
    const inviter = entry.executor;
    await DashboardAudit.create({
      route: `${guild.name || "Discord"} (${guild.id})`,
      method: "EVENT",
      actor: inviter.tag || inviter.username || String(inviter.id),
      action: "bot.invite",
      guildId: String(guild.id),
      targetUserId: String(inviter.id),
      payload: { botUserId: String((client.user && client.user.id) || "") },
    });
  } catch (err) {
    console.warn(
      `[guildCreate] Não foi possível registar o autor do convite em ${guild.id}:`,
      err?.message || err,
    );
  }
}

module.exports = (client) => {
  client.on("guildCreate", async (guild) => {
    try {
      if (!guild || !guild.id) return;

      console.log(`➕ Bot adicionado a: ${guild.name} (${guild.id})`);

      await recordBotInvite(client, guild);

      // 1) Configuração base por servidor (idempotente).
      try {
        const GuildConfig = require("../database/models/GuildConfig");
        await GuildConfig.updateOne(
          { guildId: guild.id },
          { $setOnInsert: { guildId: guild.id } },
          { upsert: true },
        );
      } catch (err) {
        console.warn(
          "[guildCreate] Não foi possível criar a GuildConfig:",
          err?.message || err,
        );
      }

      // 2) Mensagem de boas-vindas do bot no canal de sistema (ou no primeiro
      //    canal de texto onde consiga escrever).
      try {
        const { EmbedBuilder } = require("discord.js");

        const canSend = (ch) => {
          if (!ch || typeof ch.isTextBased !== "function" || !ch.isTextBased())
            return false;
          if (typeof ch.isDMBased === "function" && ch.isDMBased())
            return false;
          try {
            const perms = ch.permissionsFor(guild.members.me);
            return !perms || perms.has("SendMessages");
          } catch {
            return true;
          }
        };

        const target = canSend(guild.systemChannel)
          ? guild.systemChannel
          : guild.channels.cache.find(canSend);

        if (target) {
          const embed = new EmbedBuilder()
            .setTitle("Obrigado por me adicionares!")
            .setDescription(
              "Configura-me no painel web:\n\n" +
                "• Boas-vindas e saídas de membros\n" +
                "• Estatísticas do servidor no topo\n" +
                "• Moderação, tickets e funcionalidades extra",
            );

          const base = (process.env.PUBLIC_BASE_URL || "").trim();
          if (base) embed.setURL(base.replace(/\/+$/g, ""));

          await target.send({ embeds: [embed] }).catch(() => null);
        }
      } catch (err) {
        console.warn(
          "[guildCreate] Não foi possível enviar a mensagem de onboarding:",
          err?.message || err,
        );
      }
    } catch (err) {
      console.error(
        "[guildCreate] Erro ao processar entrada no servidor:",
        err,
      );
    }
  });
};

module.exports.findBotAddEntry = findBotAddEntry;
