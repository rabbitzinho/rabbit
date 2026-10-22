// src/events/guildMemberRemove.js
//
// Quando alguém sai do servidor fecha as sessões de presença em aberto.
// Sem isto, uma saída enquanto o membro estava online deixaria uma sessão
// com endAt:null a acumular tempo indefinidamente no "Registo de Utilizadores Online".

const { recordMemberEvent } = require("../systems/memberStats");
const { buildMemberMessage } = require("../systems/welcomeMessages");
const { getGuildLang } = require("../systems/i18n");

module.exports = (client) => {
  client.on("guildMemberRemove", async (member) => {
    try {
      if (!member?.guild || !member.user) return;

      try {
        const PresenceSession = require("../database/models/PresenceSession");
        await PresenceSession.updateMany(
          { guildId: member.guild.id, userId: member.user.id, endAt: null },
          { $set: { endAt: new Date(), lastStatus: "offline" } },
        ).exec();
      } catch (err) {
        console.warn(
          "[guildMemberRemove] Falha ao fechar sessão de presença:",
          err?.message || err,
        );
      }

      // Estatísticas: saída do dia (para os contadores de 7 dias)
      await recordMemberEvent(member.guild.id, "leaves");

      console.log(
        `👋 Member left: ${member.user.tag} (${member.user.id}) | Guild: ${member.guild.name}`,
      );

      // Mensagem de saída (feature opcional)
      try {
        const { getFeature } = require("../systems/featuresService");
        const goodbye = await getFeature(member.guild.id, "goodbye");
        if (goodbye?.enabled === true && goodbye.channelId) {
          const channel = await member.guild.channels
            .fetch(goodbye.channelId)
            .catch(() => null);
          if (channel && typeof channel.send === "function") {
            const lang = await getGuildLang(member.guild.id);
            const payload = buildMemberMessage({
              config: goodbye,
              guild: member.guild,
              user: member.user,
              kind: "goodbye",
              lang,
            });
            await channel.send(payload).catch((err) => {
              console.warn(
                "[guildMemberRemove] Falha ao enviar mensagem de saída:",
                err?.message || err,
              );
            });
          }
        }
      } catch (err) {
        console.error(
          "[guildMemberRemove] Failed to send goodbye message:",
          err,
        );
      }
    } catch (err) {
      console.error("[guildMemberRemove] Error handling member leave:", err);
    }
  });
};
