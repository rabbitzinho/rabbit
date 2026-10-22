// src/dashboard/routes/tempVoice.js

const { invalidateGuildConfig } = require("../../systems/guildConfigService");
const {
  resolveChannel,
  resolveUser,
  formatUserTag,
} = require("../../services/guildService");
const { isBotOwner } = require("../botRoles");

function registerTempVoiceRoutes({
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
}) {
  const guardGuildQuery =
    typeof requireGuildAccess === "function"
      ? requireGuildAccess({ from: "query", key: "guildId" })
      : (req, res, next) => next();

  const guardGuildBody =
    typeof requireGuildAccess === "function"
      ? requireGuildAccess({ from: "body", key: "guildId" })
      : (req, res, next) => next();

  // Módulo premium: sem premium ativo a configuração é recusada.
  const premiumGuard =
    typeof requirePremium === "function"
      ? requirePremium({ from: "body", key: "guildId" })
      : (req, res, next) => next();

  const canViewConfig =
    typeof requirePerm === "function"
      ? requirePerm({ anyOf: ["canViewConfig", "canEditConfig"] })
      : (req, res, next) => next();

  const canEditConfig =
    typeof requirePerm === "function"
      ? requirePerm({ anyOf: ["canEditConfig"] })
      : (req, res, next) => next();

  app.get(
    "/api/temp-voice/config",
    requireDashboardAuth,
    canViewConfig,
    guardGuildQuery,
    async (req, res) => {
      try {
        const guildId = sanitizeId(req.query.guildId || "");
        if (!guildId)
          return res
            .status(400)
            .json({ ok: false, error: "GUILD_ID_REQUIRED" });
        if (!GuildConfig)
          return res
            .status(503)
            .json({ ok: false, error: "GUILD_CONFIG_MODEL_MISSING" });

        let cfg = await GuildConfig.findOne({ guildId }).lean();
        if (!cfg) {
          cfg = await GuildConfig.create({ guildId });
          cfg = cfg.toObject();
        }

        const tv = cfg.tempVoice || {};
        return res.json({
          ok: true,
          config: {
            enabled: tv.enabled === true,
            baseChannelIds: Array.isArray(tv.baseChannelIds)
              ? tv.baseChannelIds
              : [],
            categoryId: tv.categoryId || null,
            deleteDelaySeconds:
              typeof tv.deleteDelaySeconds === "number"
                ? tv.deleteDelaySeconds
                : 10,
            maxUsersPerRoom:
              typeof tv.maxUsersPerRoom === "number" && tv.maxUsersPerRoom > 0
                ? tv.maxUsersPerRoom
                : null,
          },
        });
      } catch (err) {
        console.error("[Dashboard] /api/temp-voice/config GET error:", err);
        return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
      }
    },
  );

  app.post(
    "/api/temp-voice/config",
    requireDashboardAuth,
    canEditConfig,
    guardGuildBody,
    premiumGuard,
    async (req, res) => {
      try {
        const guildId = sanitizeId(req.body.guildId || "");
        if (!guildId)
          return res
            .status(400)
            .json({ ok: false, error: "GUILD_ID_REQUIRED" });
        if (!GuildConfig)
          return res
            .status(503)
            .json({ ok: false, error: "GUILD_CONFIG_MODEL_MISSING" });

        const u = req.dashboardUser;
        const perms = (u && u.permissions) || {};
        const isAdmin = isBotOwner(u);
        if (!isAdmin && !perms.canEditConfig) {
          return res.status(403).json({ ok: false, error: "NO_PERMISSION" });
        }

        const enabled =
          req.body.enabled === true || req.body.enabled === "true";
        let baseChannelIds = req.body.baseChannelIds || [];
        if (typeof baseChannelIds === "string") {
          baseChannelIds = baseChannelIds
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        }
        if (!Array.isArray(baseChannelIds)) baseChannelIds = [];

        const categoryId =
          sanitizeText(req.body.categoryId || "", {
            maxLen: 32,
            stripHtml: true,
          }) || null;
        let deleteDelaySeconds = parseInt(req.body.deleteDelaySeconds, 10);
        if (!Number.isFinite(deleteDelaySeconds) || deleteDelaySeconds < 2)
          deleteDelaySeconds = 10;

        let maxUsersPerRoom = req.body.maxUsersPerRoom;
        if (
          maxUsersPerRoom === "" ||
          maxUsersPerRoom === null ||
          maxUsersPerRoom === undefined
        ) {
          maxUsersPerRoom = null;
        } else {
          maxUsersPerRoom = parseInt(String(maxUsersPerRoom), 10);
          if (!Number.isFinite(maxUsersPerRoom) || maxUsersPerRoom < 1)
            maxUsersPerRoom = null;
        }

        const update = {
          tempVoice: {
            enabled,
            baseChannelIds,
            categoryId,
            deleteDelaySeconds,
            maxUsersPerRoom,
          },
        };

        await GuildConfig.findOneAndUpdate(
          { guildId },
          { $set: update },
          { returnDocument: "after", upsert: true },
        ).lean();

        // Evita servir config obsoleta (cache de 1 min do guildConfigService).
        invalidateGuildConfig(guildId);

        return res.json({ ok: true, config: update.tempVoice });
      } catch (err) {
        console.error("[Dashboard] /api/temp-voice/config POST error:", err);
        return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
      }
    },
  );

  app.get(
    "/api/temp-voice/active",
    requireDashboardAuth,
    canViewConfig,
    guardGuildQuery,
    async (req, res) => {
      try {
        const guildId = sanitizeId(req.query.guildId || "");
        if (!guildId)
          return res
            .status(400)
            .json({ ok: false, error: "GUILD_ID_REQUIRED" });
        if (!TempVoiceChannel) return res.json({ ok: true, items: [] });

        const docs = await TempVoiceChannel.find({ guildId }).lean();

        const client = typeof getClient === "function" ? getClient() : null;

        async function resolveChannelName(id) {
          const ch = await resolveChannel(client, guildId, id);
          return ch && typeof ch.name === "string" ? ch.name : null;
        }

        async function resolveOwnerTag(id) {
          const u = await resolveUser(client, id);
          return formatUserTag(u);
        }

        const items = [];
        for (const d of docs) {
          const channelName = await resolveChannelName(d.channelId);
          const baseChannelName = await resolveChannelName(d.baseChannelId);
          const ownerTag = await resolveOwnerTag(d.ownerId);
          items.push({
            guildId: d.guildId,
            channelId: d.channelId,
            channelName,
            ownerId: d.ownerId,
            ownerTag,
            baseChannelId: d.baseChannelId,
            baseChannelName,
            createdAt: d.createdAt,
          });
        }

        return res.json({ ok: true, items });
      } catch (err) {
        console.error("[Dashboard] /api/temp-voice/active GET error:", err);
        return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
      }
    },
  );
}

module.exports = { registerTempVoiceRoutes };
