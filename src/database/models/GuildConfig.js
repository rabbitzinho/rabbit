// src/database/models/GuildConfig.js

const { Schema, model } = require("mongoose");

const guildConfigSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true },

    // Idioma principal do servidor (auto|pt|en)
    language: { type: String, default: "auto" },

    // Timezone principal do servidor (IANA, ex: Europe/Lisbon). Null => usa UTC.
    timezone: { type: String, default: null },

    // Canal de logs preferido (por ID). Se não definido, usa o nome em config.logChannelName.
    logChannelId: { type: String, default: null },

    // Canal de logs específico para ações feitas via Dashboard
    dashboardLogChannelId: { type: String, default: null },

    // Canal onde a mensagem de suporte (tickets) será publicada
    ticketThreadChannelId: { type: String, default: null },

    // Roles de staff específicos por servidor (configurados na dashboard)
    staffRoleIds: {
      type: [String],
      default: [],
    },

    // Roles de staff por funcionalidade (se vazio, cai em staffRoleIds)
    staffRolesByFeature: {
      tickets: { type: [String], default: [] },
      moderation: { type: [String], default: [] },
      gamenews: { type: [String], default: [] },
      logs: { type: [String], default: [] },
      config: { type: [String], default: [] },
    },

    trustOverrides: { type: Schema.Types.Mixed, default: null },

    // Modo manutenção (quando ativo, o bot limita comandos a admin/owner e, opcionalmente, staff)
    maintenanceMode: {
      enabled: { type: Boolean, default: false },
      message: { type: String, default: null },
      allowStaff: { type: Boolean, default: true },
    },

    // Premium por servidor, ativado por doação. Enquanto não estiver ativo, os
    // módulos marcados como premium ficam bloqueados (ver systems/premium).
    premium: {
      enabled: { type: Boolean, default: false },
      // null + enabled = acesso permanente; caso contrário, vale até `until`.
      until: { type: Date, default: null },
      // Referência livre da doação (ex.: id do pagamento) para suporte.
      note: { type: String, default: null },
      activatedAt: { type: Date, default: null },
      purchasedByUserId: { type: String, default: null },
      // Legacy field for account licenses projected onto a guild before guild-only premium.
      accountUserId: { type: String, default: null },
      testBypass: { type: Boolean, default: false },
    },

    // Configuração de voz temporária por guild
    tempVoice: {
      enabled: { type: Boolean, default: false },
      baseChannelIds: { type: [String], default: [] },
      categoryId: { type: String, default: null },
      deleteDelaySeconds: { type: Number, default: 10 },
      maxUsersPerRoom: { type: Number, default: null },
    },
    // Giveaways (GamerPower) per guild
    giveaways: {
      enabled: { type: Boolean, default: false },
      channelId: { type: String, default: null },

      // Public base URL of the dashboard (used to serve platform badge PNGs for embeds).
      // Stored per guild so embeds can reference a stable https URL without needing attachments.
      publicBaseUrl: { type: String, default: null },

      // GamerPower platform names (https://www.gamerpower.com/api-read)
      platforms: { type: [String], default: ["steam"] },

      // GamerPower giveaway types (game|loot|beta)
      types: { type: [String], default: ["game"] },

      // Polling cadence (seconds). Effective min is enforced at runtime.
      pollIntervalSeconds: { type: Number, default: 60 },

      // 0 => unlimited
      maxPerCycle: { type: Number, default: 0 },
    },

    // Funcionalidades opcionais (tab "Funcionalidades" da dashboard).
    // Cada bloco tem um interruptor `enabled` independente.
    features: {
      // Optional per-server AutoMod rules; null inherits global defaults.
      autoModeration: { type: Schema.Types.Mixed, default: null },

      // Optional anti-spam overrides; defaults are resolved from global config.
      antiSpam: { type: Schema.Types.Mixed, default: null },

      // Logs de mensagens editadas/apagadas
      messageLogs: {
        enabled: { type: Boolean, default: false },
        channelId: { type: String, default: null },
        ignoreBots: { type: Boolean, default: true },
      },

      // Cargos por reação (painel único por servidor)
      reactionRoles: {
        enabled: { type: Boolean, default: false },
        channelId: { type: String, default: null },
        messageId: { type: String, default: null },
        entries: {
          type: [
            {
              _id: false,
              emoji: { type: String, default: null },
              roleId: { type: String, default: null },
            },
          ],
          default: [],
        },
      },

      // Auto-kick por número de infrações
      autoKick: {
        enabled: { type: Boolean, default: false },
        infractionsToKick: { type: Number, default: 5 },
      },

      // Níveis / XP
      levels: {
        enabled: { type: Boolean, default: false },
        xpMin: { type: Number, default: 15 },
        xpMax: { type: Number, default: 25 },
        cooldownSeconds: { type: Number, default: 60 },
        announceChannelId: { type: String, default: null },
      },

      // Starboard
      starboard: {
        enabled: { type: Boolean, default: false },
        channelId: { type: String, default: null },
        threshold: { type: Number, default: 3 },
        emoji: { type: String, default: "⭐" },
      },

      // Enquetes (polls)
      polls: {
        enabled: { type: Boolean, default: false },
      },

      // Verificação à entrada (botão num canal → atribui cargo)
      verification: {
        enabled: { type: Boolean, default: false },
        roleId: { type: String, default: null },
        channelId: { type: String, default: null },
        messageId: { type: String, default: null },
        kickAfterMinutes: { type: Number, default: 0 },
        title: { type: String, default: null },
        description: { type: String, default: null },
        buttonLabel: { type: String, default: null },
      },

      // Tickets por reação (painel + thread privada)
      tickets: {
        enabled: { type: Boolean, default: false },
        channelId: { type: String, default: null },
        messageId: { type: String, default: null },
        openEmoji: { type: String, default: "🎫" },
        closeEmoji: { type: String, default: "🔒" },
        panelTitle: { type: String, default: null },
        panelDescription: { type: String, default: null },
        alreadyOpenMessage: { type: String, default: null },
        welcomeMessage: { type: String, default: null },
        closeMessage: { type: String, default: null },
      },

      // Boas-vindas a novos membros
      welcome: {
        enabled: { type: Boolean, default: false },
        channelId: { type: String, default: null },
        message: { type: String, default: null },
        embed: { type: Boolean, default: true },
        color: { type: String, default: "#7c3aed" },
        bannerUrl: { type: String, default: null },
      },

      // Mensagem de saída de membros
      goodbye: {
        enabled: { type: Boolean, default: false },
        channelId: { type: String, default: null },
        message: { type: String, default: null },
        embed: { type: Boolean, default: true },
        color: { type: String, default: "#ef4444" },
        bannerUrl: { type: String, default: null },
      },

      // Estatísticas do servidor em canais de voz no topo
      serverStats: {
        enabled: { type: Boolean, default: false },
        showMembers: { type: Boolean, default: true },
        showJoins: { type: Boolean, default: true },
        showLeaves: { type: Boolean, default: true },
        categoryId: { type: String, default: null },
        memberChannelId: { type: String, default: null },
        joinsChannelId: { type: String, default: null },
        leavesChannelId: { type: String, default: null },
        memberTemplate: { type: String, default: null },
        joinsTemplate: { type: String, default: null },
        leavesTemplate: { type: String, default: null },
      },

      // Publica memes SFW de uma fonte fixa num intervalo configurável.
      memes: {
        enabled: { type: Boolean, default: false },
        channelId: { type: String, default: null },
        intervalMinutes: { type: Number, default: 60 },
      },

      // Notifica um canal quando um streamer Twitch inicia uma transmissão.
      twitch: {
        enabled: { type: Boolean, default: false },
        streamerName: { type: String, default: null },
        channelId: { type: String, default: null },
        roleId: { type: String, default: null },
      },
    },
    featuresConfigured: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

module.exports = model("GuildConfig", guildConfigSchema);
