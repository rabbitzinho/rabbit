// src/dashboard/routes/index.js
//
// Registo centralizado das rotas do dashboard.
// Recebe um único objeto de contexto (modelos, schemas, serviços e guards) e
// liga cada módulo de rotas à app Express. Isto mantém o `src/dashboard.js`
// focado na criação do servidor e não na lista de dependências de cada rota.

const { registerAuthRoutes } = require("./auth");
const { registerGameNewsRoutes } = require("./gamenews");
const { registerGiveawaysRoutes } = require("./giveaways");

const { registerModRoutes } = require("./mod");
const { registerConfigRoutes } = require("./config");
const { registerLogsRoutes } = require("./logs");
const { registerTicketsRoutes } = require("./tickets");
const { registerUsersRoutes } = require("./users");
const { registerGuildsRoutes } = require("./guilds");
const { registerUserRoutes } = require("./user");
const { registerTrustRoutes } = require("./trust");
const { registerCoreRoutes } = require("./core");
const { registerAuditRoutes } = require("./audit");
const { registerAdminRoutes } = require("./admin");
const { registerTempVoiceRoutes } = require("./tempVoice");
const { registerFeaturesRoutes } = require("./features");
const { registerPremiumRoutes, createPremiumGuard } = require("./premium");
const {
  executeMemberAction,
  executeUnbanAction,
  resolveGuildMember,
} = require("../../services/moderationService");

function registerDashboardRoutes(ctx) {
  const {
    app,
    express,
    mongoose,
    jwt,
    JWT_SECRET,
    logger,
    fetchChannel,
    config,
    metrics,
    status,
    configManager,
    rateLimit,
    gameNewsSystem,
    warningsService,
    infractionsService,
    dashboardWarn,
    sanitizeId,
    sanitizeText,
    parseDuration,
    formatDuration,
    ADMIN_PERMISSIONS,
    requireDashboardAuth,
    requirePerm,
    requireGuildAccess,
    recordAudit,
    getActorFromRequest,
    getTrustConfig,
    getTrustLabel,
    getEffectiveMaxMessages,
    getEffectiveMuteDuration,
    ModError,
    // Modelos Mongoose (ver dashboard/models.js)
    GuildConfig,
    DashboardAudit,
    DashboardLog,
    GameNewsModel,
    GameNewsFeed,
    GiveawayPost,
    UserModel,
    UserActivityModel,
    PresenceSessionModel,
    TicketLog,
    Ticket,
    Infraction,
    TempVoiceChannel,
    PremiumPayment,
    PremiumSettings,
    // Schemas Zod (ver dashboard/schemas.js)
    GuildConfigSchema,
    ModWarnSchema,
    ModBanSchema,
    ModUnbanSchema,
    ModMuteSchema,
    ModUnmuteSchema,
    LogsQuerySchema,
    GameNewsFeedSchema,
    // Estado partilhado
    gameNewsStatusCache,
    guildMembersLastFetch,
    getClient,
    getLogsCache,
    setLogsCache,
  } = ctx;

  // Closures de modelos no formato esperado pelas rotas de moderação/logs/tickets.
  const getModModels = () => ({
    Infraction,
    DashboardLog,
    TicketLog,
    UserActivity: UserActivityModel,
    PresenceSession: PresenceSessionModel,
  });
  const getLogModels = () => ({ DashboardLog, TicketLog });

  // Guard dos módulos premium (gamenews, voz temporária, tickets, trust, giveaways).
  const requirePremium = createPremiumGuard({ GuildConfig, sanitizeId });

  registerCoreRoutes({
    app,
    requireDashboardAuth,
    requireGuildAccess,
    requirePerm,
    rateLimit,
    recordAudit,
    getActorFromRequest,
    configManager,
    status,
    metrics,
    getClient,
    Infraction,
    sanitizeId,
  });

  registerAuthRoutes({
    app,
    express,
    requireDashboardAuth,
    jwt,
    JWT_SECRET,
    sanitizeText,
    rateLimit,
    ADMIN_PERMISSIONS,
    getClient,
    sanitizeId,
  });

  registerGuildsRoutes({
    app,
    requireDashboardAuth,
    requireGuildAccess,
    requirePerm,
    getClient,
    sanitizeId,
  });

  registerUserRoutes({
    app,
    requireDashboardAuth,
    requireGuildAccess,
    requirePerm,
    getClient,
    warningsService,
    infractionsService,
    config,
    getTrustConfig,
    getTrustLabel,
    getEffectiveMuteDuration,
  });

  registerTrustRoutes({
    app,
    requireDashboardAuth,
    requireGuildAccess,
    requirePerm,
    requirePremium,
    GuildConfig,
    resolveGuildTrustConfig: require("../../utils/trust").getGuildTrustConfig,
    recordAudit,
    getActorFromRequest,
    UserModel,
    getTrustConfig,
    getTrustLabel,
  });

  registerGameNewsRoutes({
    app,
    requireDashboardAuth,
    requirePerm,
    requireGuildAccess,
    rateLimit,
    config,
    configManager,
    GameNewsFeed,
    GameNewsModel,
    gameNewsSystem,
    sanitizeId,
    sanitizeText,
    getActorFromRequest,
    recordAudit,
    GameNewsFeedSchema,
    getClient,
    gameNewsStatusCache,
    requirePremium,
  });

  registerGiveawaysRoutes({
    app,
    requireDashboardAuth,
    requirePerm,
    requireGuildAccess,
    rateLimit,
    sanitizeId,
    sanitizeText,
    getActorFromRequest,
    recordAudit,
    getClient,
    GuildConfig,
    GiveawayPost,
    requirePremium,
  });

  registerModRoutes({
    app,
    requireDashboardAuth,
    requirePerm,
    requireGuildAccess,
    rateLimit,
    sanitizeId,
    sanitizeText,
    getActorFromRequest,
    recordAudit,
    ModWarnSchema,
    ModBanSchema,
    ModUnbanSchema,
    ModMuteSchema,
    ModUnmuteSchema,
    parseDuration,
    formatDuration,
    config,
    dashboardWarn,
    executeMemberAction,
    executeUnbanAction,
    resolveGuildMember,
    ModError,
    mongoose,
    logger,
    warningsService,
    infractionsService,
    _getClient: getClient,
    _getModels: getModModels,
    _getLogsCache: getLogsCache,
  });

  registerConfigRoutes({
    app,
    requireDashboardAuth,
    requirePerm,
    requireGuildAccess,
    rateLimit,
    sanitizeId,
    GuildConfig,
    GuildConfigSchema,
    resolveGuildTrustConfig: require("../../utils/trust").getGuildTrustConfig,
    recordAudit,
    getActorFromRequest,
  });

  registerLogsRoutes({
    app,
    requireDashboardAuth,
    requirePerm,
    requireGuildAccess,
    rateLimit,
    sanitizeId,
    recordAudit,
    getActorFromRequest,
    LogsQuerySchema,
    _getModels: getLogModels,
    _getLogsCache: getLogsCache,
    _setLogsCache: setLogsCache,
  });

  registerTicketsRoutes({
    app,
    requireDashboardAuth,
    requirePerm,
    requireGuildAccess,
    rateLimit,
    sanitizeText,
    getActorFromRequest,
    recordAudit,
    _getClient: getClient,
    _getModels: () => ({ TicketModel: Ticket, TicketLogModel: TicketLog }),
    requirePremium,
  });

  registerUsersRoutes({
    app,
    requireDashboardAuth,
    requireGuildAccess,
    requirePerm,
    getClient,
    sanitizeId,
    guildMembersLastFetch,
    infractionsService,
    TicketLogModel: TicketLog,
  });

  registerAuditRoutes({
    app,
    requireDashboardAuth,
    requirePerm,
    requireGuildAccess,
    sanitizeId,
    DashboardAudit,
  });

  registerAdminRoutes({
    app,
    express,
    requireDashboardAuth,
    requirePerm,
    requireGuildAccess,
    sanitizeId,
    rateLimit,
    fetchChannel,
    configManager,
    status,
    getClient,
    getTrustConfig,
    getTrustLabel,
    getEffectiveMaxMessages,
    getEffectiveMuteDuration,
    logger,
  });

  registerTempVoiceRoutes({
    app,
    requireDashboardAuth,
    requirePerm,
    requireGuildAccess,
    sanitizeId,
    sanitizeText,
    GuildConfig,
    TempVoiceChannel,
    getClient,
    requirePremium,
  });

  registerFeaturesRoutes({
    app,
    requireDashboardAuth,
    requirePerm,
    requireGuildAccess,
    rateLimit,
    requirePremium,
    sanitizeId,
    GuildConfig,
    getClient,
    recordAudit,
    getActorFromRequest,
  });

  registerPremiumRoutes({
    app,
    requireDashboardAuth,
    requirePerm,
    requireGuildAccess,
    sanitizeId,
    GuildConfig,
    PremiumPayment,
    PremiumSettings,
    getClient,
    config,
    rateLimit,
  });
}

module.exports = { registerDashboardRoutes };
