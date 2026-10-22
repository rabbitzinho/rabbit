// src/dashboard.js
//
// Composição do servidor HTTP do dashboard: middlewares de segurança, registo
// das rotas (ver `dashboard/routes/index.js`), ponte de eventos com o sistema e
// handlers finais. Cada responsabilidade concreta vive num módulo próprio
// (`dashboard/authMiddleware.js`, `logStore.js`, `static.js`, `models.js`, ...).

const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");
const helmet = require("helmet");
const cors = require("cors");
const { fetchChannel } = require("./services/discordFetchCache");

const { registerDashboardRoutes } = require("./dashboard/routes");
const {
  registerStaticRoutes,
  registerSpaFallback,
} = require("./dashboard/static");

const { createAuthMiddleware } = require("./dashboard/authMiddleware");
const { createLogStore } = require("./dashboard/logStore");
const { sanitizeText, sanitizeId } = require("./dashboard/sanitize");
const {
  getActorFromRequest,
  createAuditRecorder,
} = require("./dashboard/audit");
const { loadDashboardModels } = require("./dashboard/models");
const {
  requestIdMiddleware,
  createMetricsMiddleware,
} = require("./dashboard/middleware");
const {
  GuildConfigSchema,
  ModWarnSchema,
  ModBanSchema,
  ModUnbanSchema,
  ModMuteSchema,
  ModUnmuteSchema,
  LogsQuerySchema,
  GameNewsFeedSchema,
} = require("./dashboard/schemas");

const status = require("./systems/status");
const metrics = require("./systems/metrics");
const config = require("./config/defaultConfig");
const configManager = require("./systems/configManager");
const gameNewsSystem = require("./systems/gamenews");

const warningsService = require("./systems/warningsService");
const infractionsService = require("./systems/infractionsService");
const logger = require("./systems/logger");
const { ModError, dashboardWarn } = require("./services/moderationService");
const dashboardBridge = require("./systems/dashboardBridge");
const { parseDuration, formatDuration } = require("./utils/time");
const {
  getTrustConfig,
  getTrustLabel,
  getEffectiveMaxMessages,
  getEffectiveMuteDuration,
} = require("./utils/trust");

const jwt = require("jsonwebtoken");
const rateLimit = require("./systems/rateLimit");

// ------------------------------
// Modelos e helpers partilhados
// ------------------------------
// Modelos Mongoose (null-safe; ver dashboard/models.js)
const {
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
} = loadDashboardModels();

// Registador de auditoria (ver dashboard/audit.js)
const recordAudit = createAuditRecorder({ getModel: () => DashboardAudit });

// In-memory cache para controlar fetch de membros por guild na dashboard
const guildMembersLastFetch = new Map();

// Single source of truth for dashboard role permissions.
// Reuse this everywhere instead of duplicating literals.
const ADMIN_PERMISSIONS = Object.freeze({
  canViewLogs: true,
  canActOnCases: true,
  canManageTickets: true,
  canManageGameNews: true,
  canViewConfig: true,
  canEditConfig: true,
  canManageUsers: false,
});

// ------------------------------
// Servidor e hardening
// ------------------------------
const app = express();

// Behind Koyeb/Reverse proxies, Express needs "trust proxy" so req.ip
// reflects the real client (x-forwarded-for). This makes rate-limits and
// audit logs behave correctly.
// You can disable with TRUST_PROXY=false.
try {
  const trustProxyEnv = (process.env.TRUST_PROXY || "")
    .toString()
    .trim()
    .toLowerCase();
  const shouldTrust = trustProxyEnv
    ? trustProxyEnv !== "false" && trustProxyEnv !== "0"
    : process.env.NODE_ENV === "production";
  if (shouldTrust) app.set("trust proxy", 1);
} catch {}

// Attach a lightweight request id for diagnostics (ver dashboard/middleware.js).
app.use(requestIdMiddleware());

// Métricas de latência por rota (ver dashboard/middleware.js).
app.use(createMetricsMiddleware({ metrics }));

const isProd = process.env.NODE_ENV === "production";

// Enforce a strong JWT secret in production
if (
  isProd &&
  (!process.env.DASHBOARD_JWT_SECRET ||
    process.env.DASHBOARD_JWT_SECRET.length < 32)
) {
  throw new Error(
    "[Dashboard Auth] DASHBOARD_JWT_SECRET is missing or too weak in production. It must be at least 32 characters.",
  );
}

// Em produção o segredo é obrigatório (validado acima). Fora de produção,
// geramos um segredo aleatório efémero em vez de usar um valor previsível.
// Efeito colateral aceitável: as sessões caem ao reiniciar o processo em dev.
const JWT_SECRET =
  process.env.DASHBOARD_JWT_SECRET || crypto.randomBytes(48).toString("hex");

if (!isProd && !process.env.DASHBOARD_JWT_SECRET) {
  console.warn(
    "[Dashboard Auth] DASHBOARD_JWT_SECRET não definido: a usar segredo aleatório temporário (sessões caem ao reiniciar). Define a variável para sessões persistentes.",
  );
}

const server = http.createServer(app);

// App hardening (dashboard)
app.disable("x-powered-by");

// Basic security headers for dashboard API
// We disable the default CSP for now to avoid breaking inline scripts/styles.
const allowedOrigins =
  Array.isArray(config.dashboard?.allowedOrigins) &&
  config.dashboard.allowedOrigins.length > 0
    ? config.dashboard.allowedOrigins
    : (process.env.DASHBOARD_ORIGIN || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

// In production, do NOT fall back to permissive CORS unless explicitly allowed.
// This prevents a common misconfiguration where the API is callable from any website.
if (
  isProd &&
  !allowedOrigins.length &&
  process.env.DASHBOARD_ALLOW_ANY_ORIGIN !== "true"
) {
  console.warn(
    "[Dashboard] CORS is not configured. Set DASHBOARD_ORIGIN (recommended) or dashboard.allowedOrigins. Refusing cross-origin requests in production.",
  );
}

// Security headers (dashboard)
// CSP: keep scripts locked to self; allow inline styles because the HTML still contains a few style="..." attributes.
// If/when inline styles are removed, drop 'unsafe-inline' from style-src.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "base-uri": ["'self'"],
        "object-src": ["'none'"],
        "frame-ancestors": ["'none'"],
        "form-action": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "https:"],
        "font-src": ["'self'", "data:", "https:"],
        "connect-src": ["'self'"],
      },
    },
    // Avoid COEP surprises with third-party assets (e.g., Discord CDN avatars).
    crossOriginEmbedderPolicy: false,
  }),
);

// CORS: allow only configured origins in production (unless explicitly overridden).
// If allowedOrigins is empty:
//  - dev: allow all origins (DX)
//  - prod: deny cross-origin (still allows same-origin requests because browsers omit Origin on same-origin navigations only for some requests; XHR/fetch includes Origin even on same-origin, so you should configure DASHBOARD_ORIGIN)
const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);

    if (!allowedOrigins.length) {
      if (!isProd) return cb(null, true);
      if (process.env.DASHBOARD_ALLOW_ANY_ORIGIN === "true") {
        // Nunca aceitar "qualquer origem" em produção: é um risco de segurança.
        console.error(
          "[Dashboard] DASHBOARD_ALLOW_ANY_ORIGIN=true ignorado em produção. Define DASHBOARD_ORIGIN.",
        );
      }
      return cb(null, false);
    }

    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: false,
};

app.use(cors(corsOptions));

app.use(express.json({ limit: "256kb" }));

// Baseline API rate limiting (endpoint-specific limiters still apply)
app.use(
  "/api",
  rateLimit({ windowMs: 60_000, max: 600, keyPrefix: "rl:api:" }),
);

// ------------------------------
// Estado partilhado
// ------------------------------
let gameNewsStatusCache = [];

// Log store: cache em memória + persistência (ver dashboard/logStore.js)
const logStore = createLogStore({ config, getModel: () => DashboardLog });

// Middleware de auth/RBAC (ver dashboard/authMiddleware.js)
const { requireDashboardAuth, requirePerm, requireGuildAccess } =
  createAuthMiddleware({ jwt, JWT_SECRET, sanitizeId, config });

let _client = null;

function setClient(client) {
  _client = client;
}

// Versão usada para cache-busting dos assets no index.html (?v=__ASSET_VERSION__).
// Por defeito usa a versão do package.json; pode ser sobreposta por ASSET_VERSION
// (útil em deploys rápidos sem bump de versão).
const ASSET_VERSION =
  process.env.ASSET_VERSION ||
  (() => {
    try {
      return String(require("../package.json").version || "dev");
    } catch {
      return "dev";
    }
  })();

// ------------------------------
// Ficheiros estáticos + shell SPA
// ------------------------------
const PUBLIC_DIR = path.join(__dirname, "../public");

const { sendIndexHtml } = registerStaticRoutes({
  app,
  express,
  publicDir: PUBLIC_DIR,
  indexPath: path.join(PUBLIC_DIR, "index.html"),
  assetVersion: ASSET_VERSION,
});

// ------------------------------
// Rotas da dashboard
// ------------------------------
registerDashboardRoutes({
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
  GuildConfigSchema,
  ModWarnSchema,
  ModBanSchema,
  ModUnbanSchema,
  ModMuteSchema,
  ModUnmuteSchema,
  LogsQuerySchema,
  GameNewsFeedSchema,
  gameNewsStatusCache,
  guildMembersLastFetch,
  getClient: () => _client,
  getLogsCache: () => logStore.get(),
  setLogsCache: (next) => logStore.set(next),
});

logStore.loadInitial().catch(() => null);

// ------------------------------
// Ponte de eventos com o sistema
// ------------------------------
function sendToDashboard(event, data) {
  if (event === "log") {
    const payload = {
      ...data,
      time: data?.time
        ? new Date(data.time).toISOString()
        : new Date().toISOString(),
    };

    logStore.push(payload);

    return;
  }

  if (event === "gamenews_status") {
    const arr = Array.isArray(data) ? data : [];
    // Mutar em vez de reatribuir: as rotas recebem esta referência no arranque,
    // por isso uma reatribuição deixaria o dashboard a ver sempre o array vazio.
    gameNewsStatusCache.length = 0;
    gameNewsStatusCache.push(...arr);
    return;
  }
}

// Registar função de envio no bridge (evita require circular com logger)
dashboardBridge.setSender(sendToDashboard);

// ------------------------------
// Final error handler (API-safe)
// ------------------------------
// Guarantees JSON for API endpoints even when an unexpected exception bubbles up.
app.use((err, req, res, next) => {
  try {
    const path0 = (req && (req.originalUrl || req.path)) || "";
    const isApi =
      typeof path0 === "string" &&
      (path0.startsWith("/api") || path0.startsWith("/health"));

    if (!isApi) return next(err);

    const statusCode =
      err &&
      (err.statusCode || err.status) &&
      Number.isFinite(Number(err.statusCode || err.status))
        ? Number(err.statusCode || err.status)
        : 500;

    const code = err && err.code ? String(err.code) : "INTERNAL_ERROR";
    const message =
      err && (err.apiMessage || err.message)
        ? String(err.apiMessage || err.message)
        : "Internal server error";

    // Avoid leaking stack traces to clients.
    const out = {
      ok: false,
      error: message,
      code,
      requestId: req && req.requestId ? req.requestId : undefined,
    };

    if (!res.headersSent) {
      return res.status(statusCode).json(out);
    }
  } catch {
    // ignore
  }
  return next(err);
});

// SPA fallback: serve o dashboard shell for unknown non-API routes.
// Must be registered AFTER all API/health routes so it never hijacks JSON endpoints.
registerSpaFallback({ app, sendIndexHtml });

module.exports = {
  app,
  server,
  sendToDashboard,
  setClient,
};
