// src/slash/commands.js

const { SlashCommandBuilder } = require("discord.js");

module.exports = function buildSlashCommands(_prefix) {
  const warn = new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member and register an infraction")
    .setDescriptionLocalizations({
      "pt-BR": "Aplicar um aviso a um membro e registar uma infração",
    })
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("User to warn")
        .setDescriptionLocalizations({
          "pt-BR": "Utilizador a avisar",
        })
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("reason")
        .setDescription("Reason")
        .setDescriptionLocalizations({
          "pt-BR": "Motivo",
        })
        .setRequired(false),
    );

  const mute = new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Temporarily mute a member")
    .setDescriptionLocalizations({
      "pt-BR": "Silenciar temporariamente um membro",
    })
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("User to mute")
        .setDescriptionLocalizations({
          "pt-BR": "Utilizador a silenciar",
        })
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("duration")
        .setDescription("Duration (e.g. 10m, 1h, 1d)")
        .setDescriptionLocalizations({
          "pt-BR": "Duração (ex.: 10m, 1h, 1d)",
        })
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("reason")
        .setDescription("Reason")
        .setDescriptionLocalizations({
          "pt-BR": "Motivo",
        })
        .setRequired(false),
    );

  const kick = new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member from this server")
    .setDescriptionLocalizations({ "pt-BR": "Expulsar um membro do servidor" })
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("Member to kick")
        .setDescriptionLocalizations({ "pt-BR": "Membro a expulsar" })
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("reason")
        .setDescription("Reason")
        .setDescriptionLocalizations({ "pt-BR": "Motivo" })
        .setRequired(false),
    );

  const ban = new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member from this server")
    .setDescriptionLocalizations({ "pt-BR": "Banir um membro do servidor" })
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("Member to ban")
        .setDescriptionLocalizations({ "pt-BR": "Membro a banir" })
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("duration")
        .setDescription(
          "Optional duration (e.g. 1h, 7d; empty means permanent)",
        )
        .setDescriptionLocalizations({
          "pt-BR": "Duração opcional (ex.: 1h, 7d; vazio significa permanente)",
        })
        .setRequired(false),
    )
    .addStringOption((opt) =>
      opt
        .setName("reason")
        .setDescription("Reason")
        .setDescriptionLocalizations({ "pt-BR": "Motivo" })
        .setRequired(false),
    );

  const unban = new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user by Discord ID")
    .setDescriptionLocalizations({ "pt-BR": "Desbanir por ID do Discord" })
    .addStringOption((opt) =>
      opt
        .setName("user_id")
        .setDescription("Discord user ID")
        .setDescriptionLocalizations({ "pt-BR": "ID do utilizador no Discord" })
        .setMinLength(10)
        .setMaxLength(32)
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("reason")
        .setDescription("Reason")
        .setDescriptionLocalizations({ "pt-BR": "Motivo" })
        .setRequired(false),
    );

  const unmute = new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Remove an active mute from a member")
    .setDescriptionLocalizations({
      "pt-BR": "Remover um mute ativo de um membro",
    })
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("User to unmute")
        .setDescriptionLocalizations({
          "pt-BR": "Utilizador a desmutar",
        })
        .setRequired(true),
    );

  const clear = new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Delete recent and older messages from this channel")
    .setDescriptionLocalizations({
      "pt-BR": "Apagar mensagens recentes ou antigas deste canal",
    })
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Number of messages to delete (1–100)")
        .setDescriptionLocalizations({
          "pt-BR": "Número de mensagens a apagar (1–100)",
        })
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true),
    );

  const userinfo = new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Show basic information about a member")
    .setDescriptionLocalizations({
      "pt-BR": "Mostrar informação básica sobre um membro",
    })
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("User to inspect")
        .setDescriptionLocalizations({
          "pt-BR": "Utilizador a inspecionar",
        })
        .setRequired(false),
    );

  const history = new SlashCommandBuilder()
    .setName("history")
    .setDescription("Show moderation history for a member")
    .setDescriptionLocalizations({
      "pt-BR": "Mostrar histórico de moderação de um membro",
    })
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("User to inspect")
        .setDescriptionLocalizations({
          "pt-BR": "Utilizador a inspecionar",
        })
        .setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("limit")
        .setDescription("Number of entries to show (max 50)")
        .setDescriptionLocalizations({
          "pt-BR": "Número de registos a mostrar (máx. 50)",
        })
        .setMinValue(1)
        .setMaxValue(50)
        .setRequired(false),
    );

  const help = new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show help and a summary of available commands")
    .setDescriptionLocalizations({
      "pt-BR": "Mostrar ajuda e um resumo dos comandos disponíveis",
    });

  const poll = new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Create a poll with several options")
    .setDescriptionLocalizations({
      "pt-BR": "Criar uma enquete com várias opções",
    })
    .addStringOption((opt) =>
      opt
        .setName("question")
        .setDescription("Poll question")
        .setDescriptionLocalizations({
          "pt-BR": "Pergunta da enquete",
        })
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("options")
        .setDescription("Options separated by | (max 10)")
        .setDescriptionLocalizations({
          "pt-BR": "Opções separadas por | (máx. 10)",
        })
        .setRequired(true),
    );

  const rank = new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Show the level/XP rank of a member")
    .setDescriptionLocalizations({
      "pt-BR": "Mostrar o nível/XP de um membro",
    })
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("User to inspect")
        .setDescriptionLocalizations({
          "pt-BR": "Utilizador a inspecionar",
        })
        .setRequired(false),
    );

  const leaderboard = new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show the XP leaderboard for this server")
    .setDescriptionLocalizations({
      "pt-BR": "Mostrar a tabela de XP deste servidor",
    })
    .addIntegerOption((opt) =>
      opt
        .setName("limit")
        .setDescription("Number of entries to show (max 25)")
        .setDescriptionLocalizations({
          "pt-BR": "Número de entradas a mostrar (máx. 25)",
        })
        .setMinValue(1)
        .setMaxValue(25)
        .setRequired(false),
    );

  return [
    warn,
    mute,
    kick,
    ban,
    unban,
    unmute,
    clear,
    userinfo,
    history,
    help,
    poll,
    rank,
    leaderboard,
  ].map((c) => c.toJSON());
};
