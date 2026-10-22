// src/config/messages.js

/**
 * Centralized messages for the whole bot.
 * - Anything user-facing should live here.
 * - Logs also use this so you never mix languages.
 */

module.exports = {
  en: {
    common: {
      noPermission: "❌ You don't have permission to use this command.",
      guildOnly: "❌ This command can only be used inside a server.",
      missingBotPerm: (permName) =>
        `❌ I do not have permission: **${permName}**.`,
      usage: (usage) => `❌ Usage: \`${usage}\``,
      unexpectedError: "❌ An unexpected error occurred.",
      maintenance: "The bot is undergoing maintenance. Please try again later.",
      slowDown: ({ seconds }) =>
        `⏳ Please slow down. Try again in **${seconds}s**.`,
      cannotResolveUser: "❌ I could not resolve that user.",
      noReason: "No reason provided",
      yes: "Yes",
      no: "No",
    },

    warn: {
      cannotWarnSelf: "❌ You cannot warn yourself.",
      cannotWarnBot: "❌ You cannot warn the bot.",
      roleHierarchyBot:
        "❌ I cannot warn this user due to role hierarchy (my role is not high enough).",
      roleHierarchyUser:
        "❌ You cannot warn a user with an equal or higher role than yours.",
      cannotWarnAdmin: "❌ You cannot warn an Administrator.",
      channelConfirm: ({ userMention, warnings, maxWarnings, reason }) =>
        `⚠️ ${userMention} has been warned.\n📌 Total warnings: **${warnings}/${maxWarnings}**\n📝 Reason: **${reason}**`,
      dmText: ({ guildName, warnings, maxWarnings, reason }) =>
        `⚠️ You received a **WARN** in **${guildName}**.\n📝 Reason: **${reason}**\n📌 Warnings: **${warnings}/${maxWarnings}**`,
    },

    mute: {
      cannotMuteSelf: "❌ You cannot mute yourself.",
      cannotMuteBot: "❌ You cannot mute the bot.",
      cannotMuteBotUser: "⚠️ You cannot mute a bot.",
      alreadyMuted: ({ tag }) => `⚠️ **${tag}** is already muted.`,
      roleHierarchyBot:
        "❌ I cannot mute this user (their role is higher or equal to my highest role).",
      roleHierarchyUser:
        "❌ You cannot mute a user with an equal or higher role than yours.",
      cannotMuteAdmin: "❌ You cannot mute an Administrator.",
      maxDuration: "❌ Timeout duration cannot exceed 28 days.",
      channelConfirm: ({ tag, duration, reason }) =>
        `🔇 **${tag}** has been muted for **${duration}**.\n📝 Reason: **${reason}**`,
      dmText: ({ guildName, duration, reason }) =>
        `🔇 You received a **manual MUTE** in **${guildName}**.\n⏰ Duration: **${duration}**\n📝 Reason: **${reason}**`,
      failed:
        "❌ Failed to mute the user. Check my permissions and role hierarchy.",
    },

    unmute: {
      cannotUnmuteSelf: "❌ You cannot unmute yourself.",
      cannotUnmuteBot: "❌ You cannot unmute the bot.",
      roleHierarchyBot:
        "❌ I cannot unmute this user (their role is higher or equal to my highest role).",
      roleHierarchyUser:
        "❌ You cannot unmute a user with an equal or higher role than yours.",
      notMuted: ({ tag }) => `⚠️ **${tag}** is not muted.`,
      success: ({ tag }) => `✅ **${tag}** has been unmuted.`,
      failed:
        "❌ Failed to unmute the user. Check my permissions and role hierarchy.",
    },

    memberAction: {
      cannotSelf: "❌ You cannot moderate yourself.",
      cannotAdmin:
        "❌ Only an Administrator can moderate another Administrator.",
      roleHierarchyUser:
        "❌ You cannot moderate a user with an equal or higher role than yours.",
      roleHierarchyBot:
        "❌ The bot cannot moderate this user because of role hierarchy.",
      invalidDuration: "❌ Duration must be between 1 minute and 365 days.",
      invalidUserId: "❌ Enter a valid Discord user ID.",
      notBanned: "⚠️ This user is not currently banned.",
      kicked: ({ tag, caseId }) =>
        `👢 **${tag}** was kicked.${caseId ? ` Case: **#${caseId}**` : ""}`,
      banned: ({ tag, caseId, duration }) =>
        `🔨 **${tag}** was banned${duration ? ` for ${duration}` : ""}.${caseId ? ` Case: **#${caseId}**` : ""}`,
      unbanned: ({ tag, caseId }) =>
        `✅ **${tag}** was unbanned.${caseId ? ` Case: **#${caseId}**` : ""}`,
      failed:
        "❌ The action failed. Check the bot's permissions and role hierarchy.",
    },

    clear: {
      noPerm:
        "❌ I need permission to view message history and manage messages in this channel.",
      empty: "ℹ️ No messages were found in this channel.",
      tooOldOrNoPerm:
        "⚠️ I could not delete any messages. Check that I can view the channel and manage messages.",
      success: ({ count }) => `🧹 Cleared **${count}** messages.`,
      partial: ({ count, failed }) =>
        `🧹 Cleared **${count}** messages; **${failed}** could not be deleted.`,
    },

    help: {
      title: ".rabbit – Help",
      moderationTitle: "Moderation Commands",
      automodTitle: "AutoMod & Anti-Spam",
      gameNewsTitle: "Game News",
      dashboardTitle: "Dashboard",
      moderation: (prefix) => [
        `• \`${prefix}warn @user [reason]\` – issue a warning to a user`,
        `• \`${prefix}mute @user [10m/1h/2d] [reason]\` – timeout (mute) a user`,
        `• \`${prefix}unmute @user\` – remove timeout from a user`,
        "• `/kick @user [reason]` – remove a member from the server",
        "• `/ban @user [reason] [duration]` – ban permanently or for a limited time",
        "• `/unban <user_id> [reason]` – remove a server ban",
        `• \`${prefix}clear <amount>\` – clear messages in the current channel`,
        `• \`${prefix}userinfo [@user]\` – show info about a user (staff sees trust/infractions)`,
      ],
      automod: [
        "• AutoMod: detects banned words, deletes the message, adds a WARN and can auto-mute on repeated infractions.",
        "• Anti-Spam: detects repeated/similar messages in a short interval and applies an automatic mute.",
        "• Trust Score: repeat offenders lose trust and are moderated with less tolerance (fewer warnings / longer mutes).",
      ],
      gameNews: [
        "• GameNews: fetches RSS feeds (GameSpot) and sends new articles to specific channels.",
        "• Feeds have automatic backoff and status visible in the dashboard.",
      ],
      dashboard: [
        "• Real-time moderation log + history (Mongo).",
        "• GameNews status panel + `/health` endpoint for monitoring.",
      ],
      footer: (prefix) =>
        `For more details about a command, use \`${prefix}command\` followed by the arguments shown above.`,
    },

    automod: {
      warnReasonGeneric: "Inappropriate language detected",
      warnReason: ({ word }) => `Inappropriate language (detected: "${word}")`,
      warnPublic: ({ userMention, warnings, maxWarnings, reason }) =>
        `⚠️ ${userMention}, you received a **WARN**.\n📝 Reason: **${reason}**\n📌 Warnings: **${warnings}/${maxWarnings}**`,
      muteReason: "AutoMod: exceeded warning limit",
      mutePublic: ({ userMention, minutes }) =>
        `🔇 ${userMention} has been **muted**.\n⏱️ Duration: **${minutes} minutes**\n📝 Reason: **Exceeded the warning limit**`,
    },

    antispam: {
      autoReason: "Spam / Flood detected",
      warnPublic: ({ userMention, warnings, maxWarnings }) =>
        `⚠️ ${userMention}, please stop spamming.
Warnings: **${warnings}/${maxWarnings}**`,
      warnReason: "Spam / Flood detected (warning)",
      mutePublic: ({ userMention }) =>
        `🔇 ${userMention} has been muted for spam.`,
      muteReason: "Spam / Flood detected",
    },

    userinfo: {
      title: ({ tag }) => `User Info - ${tag}`,
      fieldUser: "👤 User",
      fieldAccount: "📅 Account",
      fieldWarnings: "⚠️ Warnings",
      fieldTrust: "🔐 Trust Score",
      fieldRecent: "🧾 Recent infractions (last 5)",
      tagAndId: ({ tag, id }) => `Tag: **${tag}**\nID: \`${id}\``,
      accountDates: ({ createdAt, joinedAt }) =>
        `Created at: ${createdAt}\nJoined this server: ${joinedAt}`,
      warningsBlock: ({ warnings, maxWarnings, infractionsCount }) =>
        `**${warnings}** / **${maxWarnings}** (AutoMod base)\nInfractions registered: **${infractionsCount}**`,
      trustDisabled: "Trust system is currently **disabled**.",
      trustStaff: ({ trustValue, trustMax, trustLabel }) =>
        `Trust: **${trustValue}/${trustMax}**\nRisk level: **${trustLabel}**`,
      trustPublic:
        "Trust Score is **internal** and only visible to staff.\nModeration decisions may be stricter for repeat offenders.",
      recentStaffOnly:
        "Recent infraction details are **visible to staff only**.",
      noRecentInfractions: "No recent infractions found.",
      requestedBy: ({ tag }) => `Requested by ${tag}`,
    },

    commands: {
      couldNotVerifyRoles: "❌ Could not verify your roles.",
      unknownCommand: "Unknown command.",
      execError: "⚠️ Error executing command.",
    },

    log: {
      labels: {
        user: "User",
        executor: "Moderator",
      },
      actions: {
        manualWarn: ({ reason, warnings, maxWarnings, trust }) =>
          `Reason: **${reason}**\nWarnings: **${warnings}/${maxWarnings}**\nTrust: **${trust}**`,
        manualMute: ({ duration, reason, trust }) =>
          `Duration: **${duration}**\nReason: **${reason}**\nTrust: **${trust}**`,
        manualUnmute: ({ warnings, trust }) =>
          `User unmuted manually.\nWarnings: **${warnings}**\nTrust: **${trust}**`,
        clear: ({ count, channelId }) =>
          `Cleared **${count}** messages in <#${channelId}> (channelId: \`${channelId}\`)`,
        automodWarn: ({ word, warnings, maxWarnings, trust, deleted }) =>
          `AutoMod detected banned word: **${word}**\nWarnings: **${warnings}/${maxWarnings}**\nTrust: **${trust}**\nDeleted: **${deleted}**`,
        automodMute: ({ minutes, trustAfter }) =>
          `AutoMod mute applied.\nDuration: **${minutes} minutes**\nTrust after mute: **${trustAfter}**`,
        antispamMute: ({
          durationSeconds,
          threshold,
          intervalMs,
          similarityPct,
          trustAfter,
        }) =>
          `User muted for spam.\nDuration: **${durationSeconds}s**\nThreshold: **${threshold} similar msgs / ${intervalMs}ms**\nSimilarity ≥ **${similarityPct}%**\nTrust after mute: **${trustAfter}**`,
        antispamWarn: ({
          warnings,
          maxWarnings,
          threshold,
          intervalMs,
          similarityPct,
          trustAfter,
        }) =>
          `User warned for spam.\nWarnings: **${warnings}/${maxWarnings}**\nThreshold: **${threshold} similar msgs / ${intervalMs}ms**\nSimilarity ≥ **${similarityPct}%**\nTrust after warn: **${trustAfter}**`,
        userinfo: ({
          tag,
          id,
          warnings,
          maxWarnings,
          infractionsCount,
          trust,
          riskLabel,
        }) =>
          `Requested info for: **${tag}** (\`${id}\`)\nWarnings: **${warnings}/${maxWarnings}**\nInfractions registered: **${infractionsCount}**\nTrust: **${trust}**\nRisk level: **${riskLabel}**`,
      },
      trustRisk: {
        high: "High risk",
        medium: "Medium risk",
        low: "Low risk",
      },
      noDescription: "No description provided.",
    },

    verify: {
      success: "✅ You have been verified.",
      disabled: "❌ Verification is not available on this server.",
      panelTitle: "Verification",
      panelDescription: "Click the button below to get access to the server.",
      button: "Verify",
      testButton: "Test",
    },

    poll: {
      disabled: "❌ Polls are disabled on this server.",
      voted: "✅ Your vote has been registered.",
      created: "✅ Poll created.",
      invalidOptions:
        "❌ Provide a question and at least 2 options separated by `|` (max 10).",
    },

    rank: {
      title: ({ tag }) => `Rank - ${tag}`,
      fieldLevel: "Level",
      fieldXp: "XP",
      fieldMessages: "Messages",
      fieldPosition: "Position",
      notFound: "❌ No rank data found for this user.",
    },

    leaderboard: {
      title: "🏆 XP Leaderboard",
      empty: "❌ No XP data available yet.",
    },

    levels: {
      disabled: "❌ The levels system is disabled on this server.",
      levelUp: ({ user, level }) => `🎉 ${user} reached **level ${level}**!`,
      levelUpTitle: "Level up!",
    },

    starboard: {
      disabled: "❌ Starboard is disabled on this server.",
    },

    tickets: {
      panelTitle: "📩 Support & Tickets",
      panelDescription: [
        "If you need help with the server, have moderation questions, or want to report an issue, you can open a support ticket.",
        "",
        "👉 How to open a ticket:",
        "1. React to this message with {emoji};",
        "2. A private thread will be created with you and the support team;",
        "3. Explain the situation with as much detail as possible to speed up the reply.",
        "",
        "⏱️ Requests are handled in arrival order. Thank you for your patience.",
      ].join("\n"),
      panelFooter: "Use this channel only for support-related requests.",
      alreadyOpen: "You already have an open ticket: <#{channelId}>",
      welcomeTitle: "🎫 Support ticket",
      welcomeDescription: ({ user, closeEmoji }) =>
        [
          `Hello ${user}, thanks for reaching out to the support team.`,
          "",
          "📌 **Before you start:**",
          "• Explain your problem or request clearly;",
          "• If possible, include screenshots, IDs or examples;",
          "• Avoid sharing sensitive personal data in text or images.",
          "",
          `🔒 **To close this ticket**, react to this message with ${closeEmoji}.`,
        ].join("\n"),
      ticketNumber: "Ticket number",
      openedBy: "Opened by",
      cannotClose: "{user}, you do not have permission to close this ticket.",
      closedBy: "🔒 Ticket closed by {user}. Thank you for contacting us.",
    },

    history: {
      title: ({ user, count }) => `📚 History for ${user} (latest ${count}):`,
      empty: ({ user }) => `📚 No infractions recorded for ${user}.`,
      unknown: "Unknown",
      noReason: "No reason",
      moderator: "mod",
      omitted: ({ count }) => `… (+${count} omitted)`,
    },

    member: {
      welcomeTitle: "Welcome!",
      goodbyeTitle: "See you soon!",
      memberCount: (n) => `Member #${n}`,
      nowMembers: (n) => `Now we are ${n} members`,
    },

    featureDefaults: {
      welcome: {
        message:
          "Welcome {user} to {server}! We are now {memberCount} members.",
      },
      goodbye: {
        message: "{user} left the server.",
      },
      serverStats: {
        memberTemplate: "👥 Members: {count}",
        joinsTemplate: "📥 Joins (7d): {count}",
        leavesTemplate: "📤 Leaves (7d): {count}",
      },
    },

    features: {
      disabled: "❌ This feature is disabled on this server.",
    },
  },

  pt: {
    common: {
      noPermission: "❌ Não tens permissão para usar este comando.",
      guildOnly: "❌ Este comando só pode ser usado dentro de um servidor.",
      missingBotPerm: (permName) =>
        `❌ Não tenho a permissão necessária: **${permName}**.`,
      usage: (usage) => `❌ Uso correto: \`${usage}\``,
      unexpectedError: "❌ Ocorreu um erro inesperado.",
      maintenance: "O bot está em manutenção. Tenta novamente mais tarde.",
      slowDown: ({ seconds }) =>
        `⏳ Vai com calma. Tenta novamente em **${seconds}s**.`,
      cannotResolveUser: "❌ Não consegui identificar esse utilizador.",
      noReason: "Sem motivo especificado",
      yes: "Sim",
      no: "Não",
    },

    warn: {
      cannotWarnSelf: "❌ Não te podes avisar a ti próprio.",
      cannotWarnBot: "❌ Não podes avisar o bot.",
      roleHierarchyBot:
        "❌ Não consigo avisar este utilizador por hierarquia de cargos (o meu cargo não é suficientemente alto).",
      roleHierarchyUser:
        "❌ Não podes avisar um utilizador com cargo igual ou superior ao teu.",
      cannotWarnAdmin: "❌ Não podes avisar um Administrador.",
      channelConfirm: ({ userMention, warnings, maxWarnings, reason }) =>
        `⚠️ ${userMention} foi avisado.\n📌 Avisos: **${warnings}/${maxWarnings}**\n📝 Motivo: **${reason}**`,
      dmText: ({ guildName, warnings, maxWarnings, reason }) =>
        `⚠️ Recebeste um **WARN** em **${guildName}**.\n📝 Motivo: **${reason}**\n📌 Avisos: **${warnings}/${maxWarnings}**`,
    },

    mute: {
      cannotMuteSelf: "❌ Não te podes silenciar a ti próprio.",
      cannotMuteBot: "❌ Não podes silenciar o bot.",
      cannotMuteBotUser: "⚠️ Não é possível silenciar um bot.",
      alreadyMuted: ({ tag }) => `⚠️ **${tag}** já está silenciado.`,
      roleHierarchyBot:
        "❌ Não consigo silenciar este utilizador (o cargo dele é igual ou superior ao meu).",
      roleHierarchyUser:
        "❌ Não podes silenciar um utilizador com cargo igual ou superior ao teu.",
      cannotMuteAdmin: "❌ Não podes silenciar um Administrador.",
      maxDuration: "❌ A duração do timeout não pode exceder 28 dias.",
      channelConfirm: ({ tag, duration, reason }) =>
        `🔇 **${tag}** foi silenciado por **${duration}**.\n📝 Motivo: **${reason}**`,
      dmText: ({ guildName, duration, reason }) =>
        `🔇 Recebeste um **MUTE manual** em **${guildName}**.\n⏰ Duração: **${duration}**\n📝 Motivo: **${reason}**`,
      failed:
        "❌ Falha ao silenciar o utilizador. Verifica permissões e hierarquia de cargos.",
    },

    unmute: {
      cannotUnmuteSelf: "❌ Não podes remover o teu próprio silêncio.",
      cannotUnmuteBot: "❌ Não podes remover o silêncio do bot.",
      roleHierarchyBot:
        "❌ Não consigo remover o silêncio (o cargo dele é igual ou superior ao meu).",
      roleHierarchyUser:
        "❌ Não podes remover o silêncio de um utilizador com cargo igual ou superior ao teu.",
      notMuted: ({ tag }) => `⚠️ **${tag}** não está silenciado.`,
      success: ({ tag }) => `✅ Removi o silêncio de **${tag}**.`,
      failed:
        "❌ Falha ao remover silêncio. Verifica permissões e hierarquia de cargos.",
    },

    memberAction: {
      cannotSelf: "❌ Não podes moderar-te a ti próprio.",
      cannotAdmin: "❌ Só um Administrador pode moderar outro Administrador.",
      roleHierarchyUser:
        "❌ Não podes moderar um utilizador com cargo igual ou superior ao teu.",
      roleHierarchyBot:
        "❌ O bot não pode moderar este utilizador devido à hierarquia de cargos.",
      invalidDuration: "❌ A duração tem de ser entre 1 minuto e 365 dias.",
      invalidUserId: "❌ Indica um ID de utilizador Discord válido.",
      notBanned: "⚠️ Este utilizador não está banido.",
      kicked: ({ tag, caseId }) =>
        `👢 **${tag}** foi expulso.${caseId ? ` Caso: **#${caseId}**` : ""}`,
      banned: ({ tag, caseId, duration }) =>
        `🔨 **${tag}** foi banido${duration ? ` por ${duration}` : ""}.${caseId ? ` Caso: **#${caseId}**` : ""}`,
      unbanned: ({ tag, caseId }) =>
        `✅ **${tag}** foi desbanido.${caseId ? ` Caso: **#${caseId}**` : ""}`,
      failed:
        "❌ A ação falhou. Verifica as permissões do bot e a hierarquia de cargos.",
    },

    clear: {
      noPerm:
        "❌ Preciso de permissão para ver o histórico e gerir mensagens neste canal.",
      empty: "ℹ️ Não foram encontradas mensagens neste canal.",
      tooOldOrNoPerm:
        "⚠️ Não consegui apagar mensagens. Confirma se posso ver o canal e gerir mensagens.",
      success: ({ count }) => `🧹 Apaguei **${count}** mensagens.`,
      partial: ({ count, failed }) =>
        `🧹 Apaguei **${count}** mensagens; não foi possível apagar **${failed}**.`,
    },

    help: {
      title: ".rabbit – Ajuda",
      moderationTitle: "Comandos de Moderação",
      automodTitle: "AutoMod & Anti-Spam",
      gameNewsTitle: "Game News",
      dashboardTitle: "Dashboard",
      moderation: (prefix) => [
        `• \`${prefix}warn @user [motivo]\` – aplicar um aviso a um utilizador`,
        `• \`${prefix}mute @user [10m/1h/2d] [motivo]\` – silenciar (timeout) um utilizador`,
        `• \`${prefix}unmute @user\` – remover silêncio de um utilizador`,
        "• `/kick @user [motivo]` – expulsar um membro do servidor",
        "• `/ban @user [motivo] [duração]` – banir permanentemente ou por tempo limitado",
        "• `/unban <user_id> [motivo]` – remover um ban do servidor",
        `• \`${prefix}clear <quantidade>\` – apagar mensagens no canal atual`,
        `• \`${prefix}userinfo [@user]\` – ver info de um utilizador (staff vê trust/infrações)`,
      ],
      automod: [
        "• AutoMod: deteta palavras proibidas, apaga a mensagem, adiciona WARN e pode silenciar automaticamente em reincidência.",
        "• Anti-Spam: deteta mensagens repetidas/semelhantes num curto intervalo e aplica um mute automático.",
        "• Trust Score: reincidentes perdem confiança e são moderados com menos tolerância (menos avisos / mute mais longo).",
      ],
      gameNews: [
        "• GameNews: obtém feeds RSS (GameSpot) e envia novos artigos para canais específicos.",
        "• Feeds têm backoff automático e estado visível no dashboard.",
      ],
      dashboard: [
        "• Log de moderação em tempo real + histórico (Mongo).",
        "• Painel de estado do GameNews + endpoint `/health` para monitorização.",
      ],
      footer: (prefix) =>
        `Para mais detalhes sobre um comando, usa \`${prefix}comando\` com os argumentos indicados acima.`,
    },

    automod: {
      warnReasonGeneric: "Linguagem imprópria detetada",
      warnReason: ({ word }) => `Linguagem imprópria (detetado: "${word}")`,
      warnPublic: ({ userMention, warnings, maxWarnings, reason }) =>
        `⚠️ ${userMention}, recebeste um **WARN**.\n📝 Motivo: **${reason}**\n📌 Avisos: **${warnings}/${maxWarnings}**`,
      muteReason: "AutoMod: limite de avisos atingido",
      mutePublic: ({ userMention, minutes }) =>
        `🔇 ${userMention} foi **silenciado**.\n⏱️ Duração: **${minutes} minutos**\n📝 Motivo: **Limite de avisos atingido**`,
    },

    antispam: {
      autoReason: "Spam / Flood detetado",
      warnPublic: ({ userMention, warnings, maxWarnings }) =>
        `⚠️ ${userMention}, pára de fazer spam.
Avisos: **${warnings}/${maxWarnings}**`,
      warnReason: "Spam / Flood detetado (aviso)",
      mutePublic: ({ userMention }) =>
        `🔇 ${userMention} foi silenciado por spam.`,
      muteReason: "Spam / Flood detetado",
    },

    userinfo: {
      title: ({ tag }) => `Informação do Utilizador - ${tag}`,
      fieldUser: "👤 Utilizador",
      fieldAccount: "📅 Conta",
      fieldWarnings: "⚠️ Avisos",
      fieldTrust: "🔐 Trust",
      fieldRecent: "🧾 Infrações recentes (últimas 5)",
      tagAndId: ({ tag, id }) => `Tag: **${tag}**\nID: \`${id}\``,
      accountDates: ({ createdAt, joinedAt }) =>
        `Criada em: ${createdAt}\nEntrou no servidor: ${joinedAt}`,
      warningsBlock: ({ warnings, maxWarnings, infractionsCount }) =>
        `**${warnings}** / **${maxWarnings}** (base do AutoMod)\nInfrações registadas: **${infractionsCount}**`,
      trustDisabled: "O sistema de trust está **desativado**.",
      trustStaff: ({ trustValue, trustMax, trustLabel }) =>
        `Trust: **${trustValue}/${trustMax}**\nNível de risco: **${trustLabel}**`,
      trustPublic:
        "O Trust é **interno** e apenas visível para staff.\nA moderação pode ser mais restrita para reincidentes.",
      recentStaffOnly:
        "Detalhes de infrações recentes são **apenas visíveis para staff**.",
      noRecentInfractions: "Sem infrações recentes.",
      requestedBy: ({ tag }) => `Pedido por ${tag}`,
    },

    commands: {
      couldNotVerifyRoles: "❌ Não foi possível verificar os teus cargos.",
      unknownCommand: "Comando desconhecido.",
      execError: "⚠️ Erro ao executar o comando.",
    },

    log: {
      labels: {
        user: "Utilizador",
        executor: "Moderador",
      },
      actions: {
        manualWarn: ({ reason, warnings, maxWarnings, trust }) =>
          `Motivo: **${reason}**\nAvisos: **${warnings}/${maxWarnings}**\nTrust: **${trust}**`,
        manualMute: ({ duration, reason, trust }) =>
          `Duração: **${duration}**\nMotivo: **${reason}**\nTrust: **${trust}**`,
        manualUnmute: ({ warnings, trust }) =>
          `Silêncio removido manualmente.\nAvisos: **${warnings}**\nTrust: **${trust}**`,
        clear: ({ count, channelId }) =>
          `Foram apagadas **${count}** mensagens em <#${channelId}> (channelId: \`${channelId}\`)`,
        automodWarn: ({ word, warnings, maxWarnings, trust, deleted }) =>
          `AutoMod detetou palavra proibida: **${word}**\nAvisos: **${warnings}/${maxWarnings}**\nTrust: **${trust}**\nApagado: **${deleted}**`,
        automodMute: ({ minutes, trustAfter }) =>
          `AutoMod aplicou mute.\nDuração: **${minutes} minutos**\nTrust após mute: **${trustAfter}**`,
        antispamWarn: ({
          warnings,
          maxWarnings,
          threshold,
          intervalMs,
          similarityPct,
          trustAfter,
        }) =>
          `Utilizador avisado por spam.\nAvisos: **${warnings}/${maxWarnings}**\nLimite: **${threshold} mensagens semelhantes / ${intervalMs}ms**\nSimilaridade ≥ **${similarityPct}%**\nTrust após aviso: **${trustAfter}**`,
        antispamMute: ({
          durationSeconds,
          threshold,
          intervalMs,
          similarityPct,
          trustAfter,
        }) =>
          `Utilizador silenciado por spam.\nDuração: **${durationSeconds}s**\nLimite: **${threshold} mensagens semelhantes / ${intervalMs}ms**\nSimilaridade ≥ **${similarityPct}%**\nTrust após mute: **${trustAfter}**`,
        userinfo: ({
          tag,
          id,
          warnings,
          maxWarnings,
          infractionsCount,
          trust,
          riskLabel,
        }) =>
          `Pedido de info: **${tag}** (\`${id}\`)\nAvisos: **${warnings}/${maxWarnings}**\nInfrações registadas: **${infractionsCount}**\nTrust: **${trust}**\nNível de risco: **${riskLabel}**`,
      },
      trustRisk: {
        high: "Risco elevado",
        medium: "Risco médio",
        low: "Risco baixo",
      },
      noDescription: "Sem descrição.",
    },

    verify: {
      success: "✅ Foste verificado com sucesso.",
      disabled: "❌ A verificação não está disponível neste servidor.",
      panelTitle: "Verificação",
      panelDescription:
        "Clica no botão abaixo para receberes acesso ao servidor.",
      button: "Verificar",
      testButton: "Teste",
    },

    poll: {
      disabled: "❌ As enquetes estão desativadas neste servidor.",
      voted: "✅ O teu voto foi registado.",
      created: "✅ Enquete criada.",
      invalidOptions:
        "❌ Indica uma pergunta e pelo menos 2 opções separadas por `|` (máx. 10).",
    },

    rank: {
      title: ({ tag }) => `Rank - ${tag}`,
      fieldLevel: "Nível",
      fieldXp: "XP",
      fieldMessages: "Mensagens",
      fieldPosition: "Posição",
      notFound: "❌ Não há dados de rank para este utilizador.",
    },

    leaderboard: {
      title: "🏆 Tabela de XP",
      empty: "❌ Ainda não há dados de XP.",
    },

    levels: {
      disabled: "❌ O sistema de níveis está desativado neste servidor.",
      levelUp: ({ user, level }) => `🎉 ${user} alcançou o **nível ${level}**!`,
      levelUpTitle: "Subida de nível!",
    },

    starboard: {
      disabled: "❌ O starboard está desativado neste servidor.",
    },

    tickets: {
      panelTitle: "📩 Suporte & Tickets",
      panelDescription: [
        "Se precisares de ajuda com o servidor, tiveres dúvidas sobre moderação ou quiseres reportar um problema, podes abrir um ticket de suporte.",
        "",
        "👉 Como abrir um ticket:",
        "1. Reage a esta mensagem com {emoji};",
        "2. Será criada uma thread privada contigo e com a equipa de suporte;",
        "3. Explica a situação com o máximo de detalhe possível para acelerar a resposta.",
        "",
        "⏱️ Os pedidos são tratados por ordem de chegada. Agradecemos a tua compreensão.",
      ].join("\n"),
      panelFooter:
        "Utiliza este canal apenas para pedidos relacionados com suporte.",
      alreadyOpen: "Já existe um ticket aberto para ti: <#{channelId}>",
      welcomeTitle: "🎫 Ticket de suporte",
      welcomeDescription: ({ user, closeEmoji }) =>
        [
          `Olá ${user}, obrigado por entrares em contacto com a equipa de suporte.`,
          "",
          "📌 **Antes de começares:**",
          "• Explica de forma clara o teu problema ou pedido;",
          "• Sempre que possível, inclui prints, IDs ou exemplos;",
          "• Evita partilhar dados pessoais sensíveis em texto ou imagem.",
          "",
          `🔒 **Para encerrar este ticket**, reage a esta mensagem com ${closeEmoji}.`,
        ].join("\n"),
      ticketNumber: "Número do ticket",
      openedBy: "Aberto por",
      cannotClose: "{user}, não tens permissão para fechar este ticket.",
      closedBy: "🔒 Ticket fechado por {user}. Obrigado pelo contacto.",
    },

    history: {
      title: ({ user, count }) => `📚 Histórico de ${user} (últimas ${count}):`,
      empty: ({ user }) => `📚 Sem infrações registadas para ${user}.`,
      unknown: "Desconhecido",
      noReason: "Sem motivo",
      moderator: "mod",
      omitted: ({ count }) => `… (+${count} não mostrados)`,
    },

    member: {
      welcomeTitle: "Bem-vindo!",
      goodbyeTitle: "Até breve!",
      memberCount: (n) => `Membro #${n}`,
      nowMembers: (n) => `Agora somos ${n} membros`,
    },

    featureDefaults: {
      welcome: {
        message:
          "Bem-vindo(a) {user} ao {server}! Já somos {memberCount} membros.",
      },
      goodbye: {
        message: "{user} saiu do servidor.",
      },
      serverStats: {
        memberTemplate: "👥 Membros: {count}",
        joinsTemplate: "📥 Entradas (7d): {count}",
        leavesTemplate: "📤 Saídas (7d): {count}",
      },
    },

    features: {
      disabled: "❌ Esta funcionalidade está desativada neste servidor.",
    },
  },
};
