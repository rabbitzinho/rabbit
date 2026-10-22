// src/dashboard/authMiddleware.js
//
// Middleware de autenticação/autorização da dashboard.
// Extraído de src/dashboard.js para reduzir o tamanho do entrypoint e permitir
// testes unitários isolados (ver tests/unit/authMiddleware.test.js).

const { getBotOwnerId, isGuildAdministrator } = require("./botRoles");

/**
 * Cria o conjunto de middlewares de auth da dashboard.
 *
 * @param {object} deps
 * @param {object} deps.jwt        - módulo jsonwebtoken (injeção para testes)
 * @param {string} deps.JWT_SECRET - segredo usado para verificar os tokens
 * @param {(value: any) => string} deps.sanitizeId - sanitizador de IDs
 * @param {object} deps.config     - configuração (usa config.dashboard.requireAuth)
 */
function createAuthMiddleware({ jwt, JWT_SECRET, sanitizeId, config }) {
  let authMisconfigLogged = false;
  const botOwnerId = getBotOwnerId(process.env.BOT_OWNER_IDS);

  function isAuthEnabled() {
    const requireAuth = config.dashboard?.requireAuth;
    const shouldRequire = typeof requireAuth === "boolean" ? requireAuth : true;

    // Authentication can be disabled for local development, never in production.
    if (!shouldRequire) {
      if (process.env.NODE_ENV === "production") {
        if (!authMisconfigLogged) {
          console.error(
            "[Dashboard] Ignoring dashboard.requireAuth=false in production.",
          );
          authMisconfigLogged = true;
        }
        return true;
      }
      authMisconfigLogged = false;
      return false;
    }

    return true;
  }

  function extractToken(req) {
    if (!req || !req.headers) return null;

    // Cookie fallback (OAuth flow can store token server-side).
    // HttpOnly cookie is preferred to avoid depending on localStorage.
    try {
      const cookieHeader = req.headers.cookie ? String(req.headers.cookie) : "";
      if (cookieHeader) {
        const parts = cookieHeader.split(";");
        for (const part of parts) {
          const idx = part.indexOf("=");
          if (idx <= 0) continue;
          const k = part.slice(0, idx).trim();
          if (k !== "dash_token") continue;
          const v = part.slice(idx + 1).trim();
          if (v) return decodeURIComponent(v);
        }
      }
    } catch {
      // ignore cookie parsing errors
    }

    const auth = req.headers.authorization || req.headers.Authorization || "";
    if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
      return auth.slice(7).trim();
    }

    const x = req.headers["x-dashboard-token"];
    if (typeof x === "string" && x.trim()) return x.trim();

    return null;
  }

  /**
   * Decodes the dashboard auth token.
   * Supports:
   *  - JWT tokens (preferred)
   *  - JWT token issued by /api/auth/login
   */
  async function decodeDashboardToken(rawToken) {
    if (!rawToken) return null;

    try {
      const payload = jwt.verify(rawToken, JWT_SECRET, {
        algorithms: ["HS256"],
      });
      if (!payload) return null;

      // OAuth-only tokens.
      if (payload.t !== "oauth" || !payload.sub) return null;

      const userId = String(payload.sub);
      const selectedGuildId = payload.selectedGuildId
        ? sanitizeId(payload.selectedGuildId)
        : null;
      const selectedGuild =
        selectedGuildId && Array.isArray(payload.allowedGuilds)
          ? payload.allowedGuilds.find(
              (guild) => String(guild && guild.id) === selectedGuildId,
            )
          : null;
      const isConfiguredOwner = userId === botOwnerId;
      return {
        _id: userId,
        role: isConfiguredOwner
          ? "BOT_OWNER"
          : selectedGuildId && isGuildAdministrator(selectedGuild)
            ? "GUILD_ADMIN"
            : "USER",
        username: payload.username || "discord",
        avatarUrl: typeof payload.avatarUrl === "string" ? payload.avatarUrl : null,
        permissions:
          payload.permissions && typeof payload.permissions === "object"
            ? payload.permissions
            : {},
        // Optional metadata (available on the unscoped OAuth token) to support
        // stable guild listing and admin detection without additional Discord API calls.
        allowedGuilds: Array.isArray(payload.allowedGuilds)
          ? payload.allowedGuilds
              .filter((g) => g && g.id)
              .map((g) => ({
                id: String(g.id),
                name: typeof g.name === "string" ? g.name : null,
                icon: typeof g.icon === "string" ? g.icon : null,
                owner: g.owner === true,
                permissions:
                  typeof g.permissions === "string"
                    ? g.permissions
                    : String(g.permissions || ""),
                botPresent:
                  g.botPresent === true
                    ? true
                    : g.botPresent === false
                      ? false
                      : null,
              }))
          : [],
        allowedGuildIds: Array.isArray(payload.allowedGuildIds)
          ? payload.allowedGuildIds.map(String)
          : [],
        botGuildInventory: Array.isArray(payload.botGuildInventory)
          ? payload.botGuildInventory
              .filter((guild) => guild && guild.id)
              .map((guild) => ({
                id: String(guild.id),
                name: typeof guild.name === "string" ? guild.name : null,
                icon: typeof guild.icon === "string" ? guild.icon : null,
                memberCount:
                  Number.isFinite(guild.memberCount) && guild.memberCount >= 0
                    ? guild.memberCount
                    : null,
              }))
          : [],
        selectedGuildId,
        guildScopeVersion:
          Number.isInteger(payload.guildScopeVersion) &&
          payload.guildScopeVersion > 0
            ? payload.guildScopeVersion
            : null,
        profile: payload.profile ? String(payload.profile) : null,
        oauth: true,
      };
    } catch {
      return null;
    }
  }

  function requireDashboardAuth(req, res, next) {
    // Se a autenticação não estiver ativa (requireAuth === false),
    // permitimos o acesso livremente.
    if (!isAuthEnabled()) return next();

    const rawToken = extractToken(req);
    if (!rawToken) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    decodeDashboardToken(rawToken)
      .then((user) => {
        if (!user) {
          return res.status(401).json({ ok: false, error: "Unauthorized" });
        }
        req.dashboardUser = user;
        next();
      })
      .catch((err) => {
        console.error("[Dashboard] Auth error", err);
        return res.status(500).json({ ok: false, error: "Auth error" });
      });
  }

  // ------------------------------
  // Permission guard (RBAC)
  // ------------------------------
  // Only the bot owner bypasses granular checks. Guild admins remain scoped.
  function requirePerm({ anyOf = [] } = {}) {
    const needed = Array.isArray(anyOf) ? anyOf.filter(Boolean) : [];
    return (req, res, next) => {
      // If auth is disabled, permissions are meaningless.
      if (!isAuthEnabled()) return next();

      const u = req.dashboardUser;
      if (!u) return res.status(401).json({ ok: false, error: "Unauthorized" });
      if (u.role === "BOT_OWNER") return next();
      if (!needed.length) return next();
      const perms =
        u.permissions && typeof u.permissions === "object" ? u.permissions : {};
      const allowed = needed.some((k) => perms[k] === true);
      if (!allowed)
        return res.status(403).json({ ok: false, error: "NO_PERMISSION" });
      return next();
    };
  }

  // ------------------------------
  // Guild access guard (optional allow-list)
  // ------------------------------
  // Every guild operation requires a selected guild in the signed allow-list.
  function requireGuildAccess({
    from = "params",
    key = "guildId",
    optional = false,
  } = {}) {
    return (req, res, next) => {
      if (!isAuthEnabled()) return next();

      const u = req.dashboardUser;
      if (!u) return res.status(401).json({ ok: false, error: "Unauthorized" });

      const list = Array.isArray(u.allowedGuildIds)
        ? u.allowedGuildIds.filter(Boolean).map(String)
        : [];

      let raw = "";
      try {
        if (from === "query") raw = (req.query && req.query[key]) || "";
        else if (from === "body") raw = (req.body && req.body[key]) || "";
        else raw = (req.params && req.params[key]) || "";
      } catch {
        raw = "";
      }

      const selected = u && u.selectedGuildId ? String(u.selectedGuildId) : "";

      // If this route requires a guild id, force the user to select a guild first.
      if (!selected) {
        return res.status(403).json({ ok: false, error: "NO_GUILD_SELECTED" });
      }

      const requestedGuildId = sanitizeId(raw);
      const gid = requestedGuildId || (optional ? selected : "");
      if (!gid) {
        return res.status(400).json({ ok: false, error: "Missing guildId" });
      }

      // Enforce scoped token
      if (selected && gid !== selected) {
        return res.status(403).json({ ok: false, error: "NO_GUILD_SELECTED" });
      }

      // Enforce allow-list (OAuth callback already restricts to bot-present + owner/admin)
      if (!list.includes(gid)) {
        return res.status(403).json({ ok: false, error: "NO_GUILD_ACCESS" });
      }

      const metadata = Array.isArray(u.allowedGuilds)
        ? u.allowedGuilds.find((guild) => String(guild.id) === gid)
        : null;
      if (!isGuildAdministrator(metadata)) {
        return res.status(403).json({ ok: false, error: "NO_GUILD_ACCESS" });
      }

      return next();
    };
  }

  return {
    isAuthEnabled,
    extractToken,
    decodeDashboardToken,
    requireDashboardAuth,
    requirePerm,
    requireGuildAccess,
  };
}

module.exports = { createAuthMiddleware };
