// src/events/guildMemberAdd.js

const warningsService = require("../systems/warningsService");
const { recordMemberEvent } = require("../systems/memberStats");
const { buildMemberMessage } = require("../systems/welcomeMessages");
const { getGuildLang } = require("../systems/i18n");

module.exports = (client) => {
  client.on("guildMemberAdd", async (member) => {
    try {
      if (!member?.guild || !member.user) return;

      // Garante que o utilizador existe na DB
      // (não recria se já existir)
      await warningsService.getOrCreateUser(member.guild.id, member.user.id);

      // Estatísticas: entrada do dia (para os contadores de 7 dias)
      await recordMemberEvent(member.guild.id, "joins");

      console.log(
        `👤 User joined: ${member.user.tag} (${member.user.id}) | Guild: ${member.guild.name}`,
      );

      // Mensagem de boas-vindas (feature opcional)
      try {
        const { getFeature } = require("../systems/featuresService");
        const welcome = await getFeature(member.guild.id, "welcome");
        if (welcome?.enabled === true && welcome.channelId) {
          const channel = await member.guild.channels
            .fetch(welcome.channelId)
            .catch(() => null);
          if (channel && typeof channel.send === "function") {
            const lang = await getGuildLang(member.guild.id);
            const payload = buildMemberMessage({
              config: welcome,
              guild: member.guild,
              user: member.user,
              kind: "welcome",
              lang,
            });
            await channel.send(payload).catch((err) => {
              console.warn(
                "[guildMemberAdd] Falha ao enviar boas-vindas:",
                err?.message || err,
              );
            });
          }
        }
      } catch (err) {
        console.error("[guildMemberAdd] Failed to send welcome message:", err);
      }

      // Verificação (feature opcional): o sweep periódico (src/systems/verification.js)
      // trata do kick dos membros que não se verificam dentro do tempo configurado.
      try {
        const { getFeature } = require("../systems/featuresService");
        const cfg = await getFeature(member.guild.id, "verification");
        if (cfg?.enabled === true) {
          console.log(
            `[guildMemberAdd] Verificação ativa: ${member.user.tag} aguarda conclusão.`,
          );
        }
      } catch (err) {
        console.error(
          "[guildMemberAdd] Failed to read verification feature:",
          err,
        );
      }
    } catch (err) {
      console.error("[guildMemberAdd] Error handling new member:", err);
    }
  });
};
