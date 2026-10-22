// src/events/guildDelete.js
//
// Limpeza quando o bot sai de um servidor (expulso ou saída voluntária).
// Sem isto ficam para trás canais de estatísticas órfãos e documentos de
// configuração que ninguém volta a usar.
//
// Nota honesta: o Discord emite este evento *depois* de o bot perder acesso ao
// servidor, pelo que apagar canais é uma tentativa best-effort (pode devolver
// 403). A limpeza da base de dados é que é sempre garantida.

const { invalidateGuildConfig } = require("../systems/guildConfigService");

module.exports = (client) => {
  client.on("guildDelete", async (guild) => {
    try {
      if (!guild || !guild.id) return;

      console.log(
        `➖ Bot removido de: ${guild.name || guild.id} (${guild.id})`,
      );

      // 1) Canais de estatísticas criados pelo bot. `removeGuild` lê os IDs
      //    persistidos na base de dados, por isso não depende do payload.
      try {
        const { removeGuild } = require("../systems/serverStats");
        await removeGuild(guild, null);
      } catch (err) {
        console.warn(
          "[guildDelete] Falha ao remover canais de estatísticas:",
          err?.message || err,
        );
      }

      // 2) Configuração do servidor (inclui os módulos premium).
      try {
        const GuildConfig = require("../database/models/GuildConfig");
        await GuildConfig.deleteOne({ guildId: guild.id });
      } catch (err) {
        console.warn(
          "[guildDelete] Falha ao remover a GuildConfig:",
          err?.message || err,
        );
      } finally {
        invalidateGuildConfig(guild.id);
      }
    } catch (err) {
      console.error("[guildDelete] Erro ao processar saída do servidor:", err);
    }
  });
};
