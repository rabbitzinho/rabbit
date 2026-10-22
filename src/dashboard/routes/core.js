// src/dashboard/routes/core.js

const { sendServerError } = require("./_errors");
const crypto = require("crypto");
const { isGlobalBotOwner } = require("../botRoles");

function registerCoreRoutes({
  app,
  requireDashboardAuth,
  requireGuildAccess,
  rateLimit,
  recordAudit,
  getActorFromRequest,
  configManager,
  status,
  metrics,
  getClient,
  Infraction,
  sanitizeId,
}) {
  // Permite acesso automático (monitorização) via header x-metrics-token.
  // Aceita também `Authorization: Bearer <METRICS_TOKEN>`, que é o formato que o
  // Prometheus consegue enviar (não suporta headers personalizados no scrape_config).
  function extractMetricsToken(req) {
    const direct = String(req.get("x-metrics-token") || "");
    if (direct) return direct;

    const auth = String(req.get("authorization") || "");
    const match = /^bearer\s+(.+)$/i.exec(auth);
    return match ? match[1].trim() : "";
  }

  function hasValidMetricsToken(req) {
    try {
      const expected = String(process.env.METRICS_TOKEN || "").trim();
      if (!expected) return false;

      const provided = extractMetricsToken(req);
      if (!provided || provided.length !== expected.length) return false;

      return crypto.timingSafeEqual(
        Buffer.from(provided),
        Buffer.from(expected),
      );
    } catch {
      return false;
    }
  }

  const guardGuildQuery =
    typeof requireGuildAccess === "function"
      ? requireGuildAccess({ from: "query", key: "guildId" })
      : (req, res, next) => next();

  function requireOverviewScope(req, res, next) {
    const rawGuildId = req.query && req.query.guildId;
    if (rawGuildId) return guardGuildQuery(req, res, next);
    if (isGlobalBotOwner(req.dashboardUser)) return next();
    return res.status(403).json({ ok: false, error: "NO_GUILD_SELECTED" });
  }

  // Global overview is owner-only; server overview requires the selected guild scope.
  app.get(
    "/api/overview",
    requireDashboardAuth,
    requireOverviewScope,
    async (req, res) => {
      try {
        const client = typeof getClient === "function" ? getClient() : null;
        const guildId = sanitizeId(req.query && req.query.guildId);
        if (!client || !client.guilds || !client.guilds.cache) {
          return res.json({
            ok: true,
            scope: guildId ? "guild" : "global",
            guilds: 0,
            users: 0,
            actions24h: 0,
          });
        }

        const guildsCache = client.guilds.cache;
        const guilds = guildId
          ? [guildsCache.get(String(guildId))].filter(Boolean)
          : Array.from(guildsCache.values ? guildsCache.values() : guildsCache);
        if (guildId && !guilds.length)
          return res.status(404).json({ ok: false, error: "GUILD_NOT_FOUND" });
        const guildsCount = Array.isArray(guilds)
          ? guilds.length
          : guildsCache.size || 0;

        let usersCount = 0;
        for (const g of guilds) {
          if (g && typeof g.memberCount === "number")
            usersCount += g.memberCount;
        }

        // Count moderation actions in the last 24h
        let actions24h = 0;
        try {
          if (Infraction && typeof Infraction.countDocuments === "function") {
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
            actions24h = await Infraction.countDocuments({
              ...(guildId ? { guildId } : {}),
              createdAt: { $gte: since },
            }).exec();
          }
        } catch (errCount) {
          console.error(
            "[Dashboard] Failed to count infractions for overview:",
            errCount,
          );
          actions24h = 0;
        }

        return res.json({
          ok: true,
          scope: guildId ? "guild" : "global",
          guilds: guildsCount,
          users: usersCount,
          actions24h,
        });
      } catch (err) {
        console.error("[Dashboard] /api/overview error (safe fallback):", err);
        return res.json({ ok: true, guilds: 0, users: 0, actions24h: 0 });
      }
    },
  );

  function requireBotOwner(req, res, next) {
    if (!isGlobalBotOwner(req.dashboardUser)) {
      return res.status(403).json({ ok: false, error: "BOT_OWNER_REQUIRED" });
    }
    return next();
  }

  // Global config for dashboard settings
  app.get("/api/config", requireDashboardAuth, requireBotOwner, (req, res) => {
    try {
      return res.json({
        ok: true,
        config: configManager.getPublicConfig(),
        schema: configManager.getEditableSchema(),
      });
    } catch (err) {
      return sendServerError(res, "/api/config", err);
    }
  });

  const rlConfigPatch = rateLimit({
    windowMs: 60_000,
    max: 10,
    keyPrefix: "rl:config:",
  });
  app.patch(
    "/api/config",
    requireDashboardAuth,
    requireBotOwner,
    rlConfigPatch,
    async (req, res) => {
      try {
        await recordAudit({
          req,
          action: "config.patch",
          guildId: null,
          targetUserId: null,
          actor: getActorFromRequest(req),
          payload: req.body || null,
        });

        const patch = req.body;
        const result = configManager.applyPatch(patch);
        if (!result.ok) return res.status(400).json(result);

        return res.json(result);
      } catch (err) {
        return sendServerError(res, "/api/config patch", err);
      }
    },
  );

  // Public bot invite URL (available before login). Used by the login screen.
  app.get("/api/public/invite", (req, res) => {
    try {
      const clientId =
        process.env.DISCORD_OAUTH_CLIENT_ID ||
        process.env.DISCORD_CLIENT_ID ||
        "";
      if (!clientId) {
        return res.status(500).json({ ok: false, error: "MISSING_CLIENT_ID" });
      }

      const perms =
        String(process.env.DISCORD_INVITE_PERMISSIONS || "0").replace(
          /[^0-9]/g,
          "",
        ) || "0";
      const scopes = (
        process.env.DISCORD_INVITE_SCOPES || "bot applications.commands"
      ).trim();

      const url =
        "https://discord.com/api/oauth2/authorize" +
        `?client_id=${encodeURIComponent(clientId)}` +
        `&permissions=${encodeURIComponent(perms)}` +
        `&scope=${encodeURIComponent(scopes)}`;

      return res.json({ ok: true, url, clientId, permissions: perms, scopes });
    } catch (err) {
      console.error("[Dashboard] /api/public/invite error:", err);
      return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
    }
  });
  // Bot invite URL (multi-server onboarding)
  app.get("/api/invite", requireDashboardAuth, (req, res) => {
    try {
      const clientId =
        process.env.DISCORD_OAUTH_CLIENT_ID ||
        process.env.DISCORD_CLIENT_ID ||
        "";
      if (!clientId) {
        return res.status(500).json({ ok: false, error: "MISSING_CLIENT_ID" });
      }

      const perms =
        String(process.env.DISCORD_INVITE_PERMISSIONS || "0").replace(
          /[^0-9]/g,
          "",
        ) || "0";
      const scopes = (
        process.env.DISCORD_INVITE_SCOPES || "bot applications.commands"
      ).trim();

      const url =
        "https://discord.com/api/oauth2/authorize" +
        `?client_id=${encodeURIComponent(clientId)}` +
        `&permissions=${encodeURIComponent(perms)}` +
        `&scope=${encodeURIComponent(scopes)}`;

      return res.json({ ok: true, url, clientId, permissions: perms, scopes });
    } catch (err) {
      console.error("[Dashboard] /api/invite error:", err);
      return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
    }
  });

  // Health endpoint used by platforms for readiness
  app.get("/health", (req, res) => {
    try {
      const s =
        typeof status.getStatus === "function" ? status.getStatus() : {};

      const discordReady = Boolean(s.discordReady);
      const mongoConnected = Boolean(s.mongoConnected);
      const gameNewsRunning = Boolean(s.gameNewsRunning);

      const payload = {
        ok: discordReady && mongoConnected,
        discordReady,
        mongoConnected,
        gameNewsRunning,
        uptimeSeconds: Math.floor(process.uptime()),
        metrics: {
          totalCommandsExecuted: s.totalCommandsExecuted,
          totalInfractionsCreated: s.totalInfractionsCreated,
          autoModActions: s.autoModActions,
          antiSpamActions: s.antiSpamActions,
        },
      };

      return res.status(200).json(payload);
    } catch (err) {
      console.error("[Dashboard] /health error:", err);
      return res.status(500).json({ ok: false, error: "Health check failed" });
    }
  });

  // Aceita um cliente de monitorização autorizado por METRICS_TOKEN
  // ou, em alternativa, um utilizador autenticado na dashboard.
  function metricsGuard(req, res, next) {
    if (hasValidMetricsToken(req)) return next();
    if (typeof requireDashboardAuth === "function")
      return requireDashboardAuth(req, res, next);
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }

  // Métricas internas (contadores + latência por rota).
  // Acesso restrito a ADMIN da dashboard ou a um cliente com METRICS_TOKEN.
  app.get("/api/internal/metrics", metricsGuard, (req, res) => {
    try {
      const u = req.dashboardUser;
      const isAdmin = isGlobalBotOwner(u);

      if (!isAdmin && !hasValidMetricsToken(req)) {
        return res.status(403).json({ ok: false, error: "NO_PERMISSION" });
      }

      const s =
        typeof status.getStatus === "function" ? status.getStatus() : {};
      const counters = {
        totalCommandsExecuted: s.totalCommandsExecuted ?? 0,
        totalInfractionsCreated: s.totalInfractionsCreated ?? 0,
        autoModActions: s.autoModActions ?? 0,
        antiSpamActions: s.antiSpamActions ?? 0,
      };

      const snapshot =
        metrics && typeof metrics.getMetrics === "function"
          ? metrics.getMetrics()
          : { routes: [], totals: { requests: 0, errors: 0, routes: 0 } };

      // ?format=prometheus devolve texto pronto para scraping (ver docs/ROADMAP.md §6).
      const wantsPrometheus =
        String((req.query && req.query.format) || "").toLowerCase() ===
        "prometheus";
      if (
        wantsPrometheus &&
        metrics &&
        typeof metrics.formatPrometheus === "function"
      ) {
        res.setHeader(
          "Content-Type",
          "text/plain; version=0.0.4; charset=utf-8",
        );
        return res.send(metrics.formatPrometheus({ counters }));
      }

      return res.json({
        ok: true,
        generatedAt: snapshot.generatedAt,
        uptimeSeconds: snapshot.uptimeSeconds,
        counters,
        totals: snapshot.totals,
        routes: snapshot.routes,
      });
    } catch (err) {
      return sendServerError(res, "/api/internal/metrics", err);
    }
  });
}

module.exports = { registerCoreRoutes };
