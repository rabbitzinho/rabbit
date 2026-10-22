// src/dashboard/routes/trust.js

const { sendServerError } = require("./_errors");
const rateLimit = require("../../systems/rateLimit");
const {
  getGuildTrustConfig,
  normalizeTrustOverrides,
} = require("../../utils/trust");
const { invalidateGuildConfig } = require("../../systems/guildConfigService");

/**
 * Trust summary (per guild / global)
 * Keeps response shape compatible with older dashboard builds:
 *  - disabled
 *  - totalUsers
 *  - buckets {low, medium, high}
 *  - topRisks, topSafe
 */
function registerTrustRoutes({
  app,
  requireDashboardAuth,
  requireGuildAccess,
  UserModel,
  getTrustLabel,
  requirePerm,
  requirePremium,
  GuildConfig,
  resolveGuildTrustConfig,
  recordAudit,
  getActorFromRequest,
}) {
  const getConfigForGuild =
    typeof resolveGuildTrustConfig === "function"
      ? resolveGuildTrustConfig
      : getGuildTrustConfig;
  const guardGuildQuery =
    typeof requireGuildAccess === "function"
      ? requireGuildAccess({ from: "query", key: "guildId" })
      : (req, res, next) => next();
  const guardGuildParam =
    typeof requireGuildAccess === "function"
      ? requireGuildAccess({ from: "params", key: "guildId" })
      : (req, res, next) => next();
  const canViewConfig =
    typeof requirePerm === "function"
      ? requirePerm({ anyOf: ["canViewConfig", "canEditConfig"] })
      : (req, res, next) => next();
  const canEditConfig =
    typeof requirePerm === "function"
      ? requirePerm({ anyOf: ["canEditConfig"] })
      : (req, res, next) => next();
  const premiumQuery =
    typeof requirePremium === "function"
      ? requirePremium({ from: "query", key: "guildId" })
      : (req, res, next) => next();
  const premiumParam =
    typeof requirePremium === "function"
      ? requirePremium({ from: "params", key: "guildId" })
      : (req, res, next) => next();

  app.get(
    "/api/trust/summary",
    requireDashboardAuth,
    canViewConfig,
    guardGuildQuery,
    premiumQuery,
    rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "rl:trust:summary:" }),
    async (req, res) => {
      try {
        if (!UserModel) {
          return res
            .status(500)
            .json({ ok: false, error: "User model not available" });
        }

        const guildId = (req.query.guildId || "").toString().trim();
        const trustCfg = await getConfigForGuild(guildId);

        if (!trustCfg.enabled) {
          return res.json({
            ok: true,
            disabled: true,
            config: trustCfg,
            totalUsers: 0,
            buckets: { low: 0, medium: 0, high: 0 },
            topRisks: [],
            topSafe: [],
          });
        }

        const baseQuery = {};
        if (guildId) baseQuery.guildId = guildId;

        const totalUsers = await UserModel.countDocuments(baseQuery);

        if (!totalUsers) {
          return res.json({
            ok: true,
            disabled: false,
            config: trustCfg,
            totalUsers: 0,
            buckets: { low: 0, medium: 0, high: 0 },
            topRisks: [],
            topSafe: [],
          });
        }

        const lowCount = await UserModel.countDocuments({
          ...baseQuery,
          trust: { $lte: trustCfg.lowThreshold },
        });
        const highCount = await UserModel.countDocuments({
          ...baseQuery,
          trust: { $gte: trustCfg.highThreshold },
        });
        const mediumCount = Math.max(totalUsers - lowCount - highCount, 0);

        const topRiskDocs = await UserModel.find(baseQuery)
          .sort({ trust: 1, lastInfractionAt: -1 })
          .limit(15)
          .lean();

        const topSafeDocs = await UserModel.find(baseQuery)
          .sort({ trust: -1, lastInfractionAt: -1 })
          .limit(15)
          .lean();

        const topRisks = (topRiskDocs || []).map((u) => ({
          userId: u.userId,
          guildId: u.guildId,
          trust: u.trust,
          warnings: u.warnings ?? 0,
          lastInfractionAt: u.lastInfractionAt,
          lastTrustUpdateAt: u.lastTrustUpdateAt,
          label: getTrustLabel(u.trust, trustCfg),
        }));

        const topSafe = (topSafeDocs || []).map((u) => ({
          userId: u.userId,
          guildId: u.guildId,
          trust: u.trust,
          warnings: u.warnings ?? 0,
          lastInfractionAt: u.lastInfractionAt,
          lastTrustUpdateAt: u.lastTrustUpdateAt,
          label: getTrustLabel(u.trust, trustCfg),
        }));

        return res.json({
          ok: true,
          disabled: false,
          config: trustCfg,
          totalUsers,
          buckets: { low: lowCount, medium: mediumCount, high: highCount },
          topRisks,
          topSafe,
        });
      } catch (err) {
        return sendServerError(res, "/api/trust/summary", err);
      }
    },
  );

  app.get(
    "/api/guilds/:guildId/trust-config",
    requireDashboardAuth,
    canViewConfig,
    guardGuildParam,
    premiumParam,
    async (req, res) => {
      try {
        const guildId = String(req.params.guildId || "");
        if (!GuildConfig)
          return res
            .status(503)
            .json({ ok: false, error: "GUILD_CONFIG_MODEL_MISSING" });
        const trust = await getConfigForGuild(guildId);
        return res.json({ ok: true, trust });
      } catch (err) {
        return sendServerError(
          res,
          "/api/guilds/:guildId/trust-config GET",
          err,
        );
      }
    },
  );

  app.patch(
    "/api/guilds/:guildId/trust-config",
    requireDashboardAuth,
    canEditConfig,
    guardGuildParam,
    premiumParam,
    async (req, res) => {
      try {
        const guildId = String(req.params.guildId || "");
        const trustOverrides = normalizeTrustOverrides(
          req.body && req.body.trustOverrides,
        );
        if (!GuildConfig)
          return res
            .status(503)
            .json({ ok: false, error: "GUILD_CONFIG_MODEL_MISSING" });
        if (!trustOverrides)
          return res
            .status(400)
            .json({ ok: false, error: "INVALID_TRUST_CONFIG" });
        await GuildConfig.findOneAndUpdate(
          { guildId },
          { $set: { guildId, trustOverrides } },
          { upsert: true, returnDocument: "after" },
        ).lean();
        invalidateGuildConfig(guildId);
        if (typeof recordAudit === "function") {
          await recordAudit({
            req,
            action: "trust.config.update",
            guildId,
            actor:
              typeof getActorFromRequest === "function"
                ? getActorFromRequest(req)
                : null,
            payload: { keys: Object.keys(trustOverrides) },
          });
        }
        return res.json({ ok: true, trust: await getConfigForGuild(guildId) });
      } catch (err) {
        return sendServerError(
          res,
          "/api/guilds/:guildId/trust-config PATCH",
          err,
        );
      }
    },
  );
}

module.exports = { registerTrustRoutes };
