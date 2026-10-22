// src/dashboard/routes/config.js

const { sendServerError } = require("./_errors");
const { invalidateGuildConfig } = require("../../systems/guildConfigService");
const { isBotOwner } = require("../botRoles");
const { getGuildTrustConfig } = require("../../utils/trust");

function registerConfigRoutes({
  app,
  requireDashboardAuth,
  requirePerm,
  requireGuildAccess,
  rateLimit,
  sanitizeId,
  GuildConfig,
  GuildConfigSchema,
  resolveGuildTrustConfig,
  recordAudit,
  getActorFromRequest,
}) {
  const getTrustForGuild =
    typeof resolveGuildTrustConfig === "function"
      ? resolveGuildTrustConfig
      : getGuildTrustConfig;
  // Guild configuration (per-server)
  // ==============================

  const canViewConfig =
    typeof requirePerm === "function"
      ? requirePerm({ anyOf: ["canViewConfig", "canEditConfig"] })
      : (req, res, next) => next();

  const canEditConfig =
    typeof requirePerm === "function"
      ? requirePerm({ anyOf: ["canEditConfig"] })
      : (req, res, next) => next();

  function requireBotOwner(req, res, next) {
    if (!isBotOwner(req.dashboardUser)) {
      return res.status(403).json({ ok: false, error: "BOT_OWNER_REQUIRED" });
    }
    return next();
  }

  const guardGuildParam =
    typeof requireGuildAccess === "function"
      ? requireGuildAccess({ from: "params", key: "guildId" })
      : (req, res, next) => next();

  app.get(
    "/api/guilds/:guildId/config",
    requireDashboardAuth,
    canViewConfig,
    guardGuildParam,
    async (req, res) => {
      try {
        if (!GuildConfig) {
          return res
            .status(500)
            .json({ ok: false, error: "GuildConfig model not available" });
        }

        const guildId = sanitizeId(req.params.guildId);
        if (!guildId) {
          return res
            .status(400)
            .json({ ok: false, error: "guildId is required" });
        }

        const doc = await GuildConfig.findOne({ guildId })
          .lean()
          .catch(() => null);
        const trustConfig = await getTrustForGuild(guildId);

        if (!doc) {
          return res.json({
            ok: true,
            config: {
              guildId,
              language: "en",
              timezone: null,
              logChannelId: null,
              dashboardLogChannelId: null,
              ticketThreadChannelId: null,
              staffRoleIds: [],
              staffRolesByFeature: {
                tickets: [],
                moderation: [],
                gamenews: [],
                logs: [],
                config: [],
              },
              ticketLabels: [],
              trust: trustConfig,
            },
          });
        }

        return res.json({
          ok: true,
          config: {
            guildId: doc.guildId,
            language: doc.language || "en",
            timezone: doc.timezone || null,
            logChannelId: doc.logChannelId || null,
            dashboardLogChannelId: doc.dashboardLogChannelId || null,
            ticketThreadChannelId: doc.ticketThreadChannelId || null,
            staffRoleIds: Array.isArray(doc.staffRoleIds)
              ? doc.staffRoleIds
              : [],
            staffRolesByFeature: doc.staffRolesByFeature || {
              tickets: [],
              moderation: [],
              gamenews: [],
              logs: [],
              config: [],
            },
            ticketLabels: Array.isArray(doc.ticketLabels)
              ? doc.ticketLabels
              : [],
            trust: trustConfig,
          },
        });
      } catch (err) {
        return sendServerError(res, "/api/guilds/:guildId/config GET", err);
      }
    },
  );

  app.post(
    "/api/guilds/:guildId/config",
    requireDashboardAuth,
    canEditConfig,
    guardGuildParam,
    rateLimit({ windowMs: 20_000, max: 20, keyPrefix: "rl:guildConfig:" }),
    async (req, res) => {
      try {
        if (!GuildConfig) {
          return res
            .status(500)
            .json({ ok: false, error: "GuildConfig model not available" });
        }

        const guildId = sanitizeId(req.params.guildId);
        if (!guildId) {
          return res
            .status(400)
            .json({ ok: false, error: "guildId is required" });
        }

        const {
          logChannelId,
          dashboardLogChannelId,
          ticketThreadChannelId,
          staffRoleIds,
          staffRolesByFeature,
          ticketLabels,
          language,
          timezone,
        } = req.body || {};

        const payload = {
          guildId,
          logChannelId: sanitizeId(logChannelId) || null,
          dashboardLogChannelId: sanitizeId(dashboardLogChannelId) || null,
          ticketThreadChannelId: sanitizeId(ticketThreadChannelId) || null,
          language: typeof language === "string" ? language : undefined,
          timezone:
            typeof timezone === "string" && timezone.trim()
              ? timezone.trim()
              : null,
        };

        if (Array.isArray(staffRoleIds)) {
          payload.staffRoleIds = staffRoleIds
            .map((id) => sanitizeId(id))
            .filter(Boolean);
        }

        if (Array.isArray(ticketLabels)) {
          payload.ticketLabels = Array.from(
            new Set(
              ticketLabels
                .map((label) => String(label || "").trim())
                .filter((label) => label.length > 0 && label.length <= 24),
            ),
          );
        }

        if (
          staffRolesByFeature &&
          typeof staffRolesByFeature === "object" &&
          !Array.isArray(staffRolesByFeature)
        ) {
          payload.staffRolesByFeature = {};
          for (const feature of [
            "tickets",
            "moderation",
            "gamenews",
            "logs",
            "config",
          ]) {
            if (
              !Object.prototype.hasOwnProperty.call(
                staffRolesByFeature,
                feature,
              )
            )
              continue;
            const roles = Array.isArray(staffRolesByFeature[feature])
              ? staffRolesByFeature[feature]
              : [];
            payload.staffRolesByFeature[feature] = Array.from(
              new Set(roles.map((id) => sanitizeId(id)).filter(Boolean)),
            );
          }
        }

        // Validação extra com Zod para garantir que o payload tem apenas valores esperados
        const candidate = {
          logChannelId: payload.logChannelId,
          dashboardLogChannelId: payload.dashboardLogChannelId,
          ticketThreadChannelId: payload.ticketThreadChannelId,
          staffRoleIds: payload.staffRoleIds,
          staffRolesByFeature: payload.staffRolesByFeature,
          ticketLabels: payload.ticketLabels,
          language: payload.language,
          timezone: payload.timezone,
        };

        const parseResult = GuildConfigSchema.safeParse(candidate);
        if (!parseResult.success) {
          return res.status(400).json({
            ok: false,
            error: "Invalid guild config payload",
          });
        }

        const doc = await GuildConfig.findOneAndUpdate(
          { guildId },
          { $set: payload },
          { returnDocument: "after", upsert: true, setDefaultsOnInsert: true },
        ).lean();

        // Evita servir config obsoleta (cache de 1 min do guildConfigService).
        invalidateGuildConfig(guildId);
        require("../../utils/staff").invalidateStaffRoleCache(guildId);
        if (typeof recordAudit === "function") {
          await recordAudit({
            req,
            action: "server.config.update",
            guildId,
            actor:
              typeof getActorFromRequest === "function"
                ? getActorFromRequest(req)
                : null,
            payload: { keys: Object.keys(payload) },
          });
        }

        return res.json({
          ok: true,
          config: {
            guildId: doc.guildId,
            language: doc.language || "auto",
            timezone: doc.timezone || null,
            logChannelId: doc.logChannelId || null,
            dashboardLogChannelId: doc.dashboardLogChannelId || null,
            ticketThreadChannelId: doc.ticketThreadChannelId || null,
            staffRoleIds: Array.isArray(doc.staffRoleIds)
              ? doc.staffRoleIds
              : [],
            staffRolesByFeature: doc.staffRolesByFeature || {
              tickets: [],
              moderation: [],
              gamenews: [],
              logs: [],
              config: [],
            },
            ticketLabels: Array.isArray(doc.ticketLabels)
              ? doc.ticketLabels
              : [],
            trust: await getTrustForGuild(guildId),
          },
        });
      } catch (err) {
        return sendServerError(res, "/api/guilds/:guildId/config POST", err);
      }
    },
  );

  app.get(
    "/api/guilds/:guildId/maintenance",
    requireDashboardAuth,
    requireBotOwner,
    guardGuildParam,
    async (req, res) => {
      try {
        const guildId = sanitizeId(req.params.guildId);
        if (!guildId)
          return res
            .status(400)
            .json({ ok: false, error: "GUILD_ID_REQUIRED" });
        const doc = await GuildConfig.findOne({ guildId })
          .select("maintenanceMode")
          .lean();
        const maintenanceMode = (doc && doc.maintenanceMode) || {};
        return res.json({
          ok: true,
          maintenanceMode: {
            enabled: maintenanceMode.enabled === true,
            message:
              typeof maintenanceMode.message === "string" &&
              maintenanceMode.message.trim()
                ? maintenanceMode.message.trim()
                : null,
            allowStaff: maintenanceMode.allowStaff !== false,
          },
        });
      } catch (err) {
        return sendServerError(
          res,
          "/api/guilds/:guildId/maintenance GET",
          err,
        );
      }
    },
  );

  app.patch(
    "/api/guilds/:guildId/maintenance",
    requireDashboardAuth,
    requireBotOwner,
    guardGuildParam,
    async (req, res) => {
      try {
        const guildId = sanitizeId(req.params.guildId);
        const input = req.body && req.body.maintenanceMode;
        if (!guildId)
          return res
            .status(400)
            .json({ ok: false, error: "GUILD_ID_REQUIRED" });
        if (
          !input ||
          typeof input !== "object" ||
          typeof input.enabled !== "boolean"
        ) {
          return res
            .status(400)
            .json({ ok: false, error: "INVALID_MAINTENANCE_CONFIG" });
        }
        const rawMessage =
          typeof input.message === "string" ? input.message.trim() : "";
        const maintenanceMode = {
          enabled: input.enabled,
          message: rawMessage ? rawMessage.slice(0, 180) : null,
          allowStaff: input.allowStaff !== false,
        };
        await GuildConfig.findOneAndUpdate(
          { guildId },
          { $set: { guildId, maintenanceMode } },
          { upsert: true, returnDocument: "after" },
        ).lean();
        invalidateGuildConfig(guildId);
        if (typeof recordAudit === "function") {
          await recordAudit({
            req,
            action: "server.maintenance.update",
            guildId,
            actor:
              typeof getActorFromRequest === "function"
                ? getActorFromRequest(req)
                : null,
            payload: { enabled: maintenanceMode.enabled },
          });
        }
        return res.json({ ok: true, maintenanceMode });
      } catch (err) {
        return sendServerError(
          res,
          "/api/guilds/:guildId/maintenance PATCH",
          err,
        );
      }
    },
  );
}

module.exports = { registerConfigRoutes };
