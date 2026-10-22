// src/dashboard/routes/mod.js

const { sendServerError } = require("./_errors");

function registerModRoutes({
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
  mongoose,
  logger,
  warningsService,
  infractionsService,
  _getClient,
  _getModels,
}) {
  const rlWarn = rateLimit({
    windowMs: 60_000,
    max: 30,
    keyPrefix: "rl:mod:warn:",
  });
  const rlMute = rateLimit({
    windowMs: 60_000,
    max: 20,
    keyPrefix: "rl:mod:mute:",
  });
  const rlUnmute = rateLimit({
    windowMs: 60_000,
    max: 30,
    keyPrefix: "rl:mod:unmute:",
  });
  const rlKick = rateLimit({
    windowMs: 60_000,
    max: 10,
    keyPrefix: "rl:mod:kick:",
  });
  const rlBan = rateLimit({
    windowMs: 60_000,
    max: 5,
    keyPrefix: "rl:mod:ban:",
  });
  const rlUnban = rateLimit({
    windowMs: 60_000,
    max: 5,
    keyPrefix: "rl:mod:unban:",
  });
  // Reset trust can be used in short bursts (bulk-cleanups). Keep protection, but avoid breaking UX.
  const rlReset = rateLimit({
    windowMs: 60_000,
    max: 60,
    keyPrefix: "rl:mod:reset:",
  });
  // Removing infractions is often done in short bursts; allow higher throughput.
  const rlRemoveInf = rateLimit({
    windowMs: 60_000,
    max: 120,
    keyPrefix: "rl:mod:removeInf:",
  });
  const rlOverview = rateLimit({
    windowMs: 20_000,
    max: 30,
    keyPrefix: "rl:mod:overview:",
  });
  const rlTopOnline = rateLimit({
    windowMs: 20_000,
    max: 40,
    keyPrefix: "rl:mod:topOnline:",
  });

  const guardGuildBody =
    typeof requireGuildAccess === "function"
      ? requireGuildAccess({ from: "body", key: "guildId" })
      : (req, res, next) => next();

  const guardGuildQuery =
    typeof requireGuildAccess === "function"
      ? requireGuildAccess({ from: "query", key: "guildId" })
      : (req, res, next) => next();

  // Small in-memory cache for overview panels (per guild+range). Keeps DB load low
  // without affecting moderation actions. TTL is intentionally short.
  const _overviewCache = new Map(); // key -> { exp:number, value:any }
  const OVERVIEW_CACHE_TTL_MS = 45_000;

  function cacheGet(key) {
    const hit = _overviewCache.get(key);
    if (!hit) return null;
    if (!hit.exp || hit.exp < Date.now()) {
      _overviewCache.delete(key);
      return null;
    }
    return hit.value;
  }

  function cacheSet(key, value) {
    _overviewCache.set(key, { exp: Date.now() + OVERVIEW_CACHE_TTL_MS, value });
  }

  function getClient() {
    return typeof _getClient === "function" ? _getClient() : null;
  }

  function getModels() {
    return typeof _getModels === "function" ? _getModels() : {};
  }

  // ==============================
  // Mod actions (Dashboard -> Bot)
  // ==============================

  const canAct =
    typeof requirePerm === "function"
      ? requirePerm({ anyOf: ["canActOnCases"] })
      : (req, res, next) => next();
  const canViewLogs =
    typeof requirePerm === "function"
      ? requirePerm({ anyOf: ["canViewLogs", "canActOnCases"] })
      : (req, res, next) => next();

  function registerMemberActionRoute(action, limiter) {
    const actionName = action.toLowerCase();
    app.post(
      `/api/mod/${actionName}`,
      requireDashboardAuth,
      canAct,
      guardGuildBody,
      limiter,
      async (req, res) => {
        const schema = action === "BAN" ? ModBanSchema : ModWarnSchema;
        const parsed = schema.safeParse(req.body || {});
        if (!parsed.success) {
          return res
            .status(400)
            .json({ ok: false, error: `Invalid ${actionName} payload` });
        }

        const guildId = sanitizeId(parsed.data.guildId);
        const userId = sanitizeId(parsed.data.userId);
        const reason =
          sanitizeText(parsed.data.reason, { maxLen: 1000, stripHtml: true }) ||
          `Dashboard ${actionName}`;
        let durationMs = null;
        if (action === "BAN" && parsed.data.duration) {
          durationMs = parseDuration(parsed.data.duration);
          if (
            !durationMs ||
            durationMs < 60_000 ||
            durationMs > 365 * 24 * 60 * 60 * 1000
          ) {
            return res.status(400).json({
              ok: false,
              error:
                "Temporary ban duration must be between 1 minute and 365 days",
            });
          }
        }
        const actor = getActorFromRequest(req);
        await recordAudit({
          req,
          action: `mod.${actionName}`,
          guildId,
          targetUserId: userId,
          actor,
          payload: { reason },
        });

        if (!guildId || !userId) {
          return res
            .status(400)
            .json({ ok: false, error: "guildId and userId are required" });
        }

        const client = getClient();
        if (!client) {
          return res.status(500).json({ ok: false, error: "Client not ready" });
        }

        try {
          const result = await executeMemberAction({
            client,
            guildId,
            userId,
            action,
            reason,
            durationMs,
            executorId: req.dashboardUser && req.dashboardUser._id,
            actor,
            source: "dashboard",
          });
          const response = {
            ok: true,
            caseId: result?.infraction?.caseId || null,
          };
          if (result?.expiresAt) response.expiresAt = result.expiresAt;
          return res.json(response);
        } catch (error) {
          const statusCode =
            error?.code === "USER_NOT_FOUND_IN_GUILD"
              ? 404
              : error?.code === "BOT_MEMBER_NOT_AVAILABLE"
                ? 500
                : error?.code?.startsWith("FAILED_TO_")
                  ? 500
                  : 400;
          return res.status(statusCode).json({
            ok: false,
            error: error?.message || `Failed to ${actionName} member`,
            code: error?.code || "MODERATION_ACTION_FAILED",
          });
        }
      },
    );
  }

  registerMemberActionRoute("KICK", rlKick);
  registerMemberActionRoute("BAN", rlBan);

  app.post(
    "/api/mod/unban",
    requireDashboardAuth,
    canAct,
    guardGuildBody,
    rlUnban,
    async (req, res) => {
      const parsed = ModUnbanSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid unban payload" });
      }

      const guildId = sanitizeId(parsed.data.guildId);
      const userId = sanitizeId(parsed.data.userId);
      const reason =
        sanitizeText(parsed.data.reason, { maxLen: 1000, stripHtml: true }) ||
        "Dashboard unban";
      const actor = getActorFromRequest(req);
      await recordAudit({
        req,
        action: "mod.unban",
        guildId,
        targetUserId: userId,
        actor,
        payload: { reason },
      });

      if (!guildId || !/^\d{10,32}$/.test(userId)) {
        return res
          .status(400)
          .json({ ok: false, error: "guildId and valid userId are required" });
      }

      const client = getClient();
      if (!client) {
        return res.status(500).json({ ok: false, error: "Client not ready" });
      }

      try {
        const result = await executeUnbanAction({
          client,
          guildId,
          userId,
          reason,
          executorId: req.dashboardUser && req.dashboardUser._id,
          actor,
          source: "dashboard",
        });
        return res.json({
          ok: true,
          caseId: result?.infraction?.caseId || null,
        });
      } catch (error) {
        const statusCode =
          error?.code === "USER_NOT_BANNED" || error?.code === "GUILD_NOT_FOUND"
            ? 404
            : error?.code === "BOT_MISSING_BAN_PERMISSION"
              ? 403
              : error?.code === "FAILED_TO_UNBAN"
                ? 500
                : 400;
        return res.status(statusCode).json({
          ok: false,
          error: error?.message || "Failed to unban user",
          code: error?.code || "UNBAN_FAILED",
        });
      }
    },
  );

  app.post(
    "/api/mod/warn",
    requireDashboardAuth,
    canAct,
    guardGuildBody,
    rlWarn,
    async (req, res) => {
      try {
        const body = req.body || {};
        const parseResult = ModWarnSchema.safeParse(body);
        if (!parseResult.success) {
          return res
            .status(400)
            .json({ ok: false, error: "Invalid warn payload" });
        }

        const { guildId: g0, userId: u0, reason: r0 } = parseResult.data;
        const guildId = sanitizeId(g0);
        const userId = sanitizeId(u0);
        const reason = sanitizeText(r0, { maxLen: 1000, stripHtml: true });
        const actor = getActorFromRequest(req);

        await recordAudit({
          req,
          action: "mod.warn",
          guildId,
          targetUserId: userId,
          actor,
          payload: { reason },
        });

        if (!guildId || !userId) {
          return res
            .status(400)
            .json({ ok: false, error: "guildId and userId are required" });
        }

        const client = getClient();
        if (!client) {
          return res.status(500).json({ ok: false, error: "Client not ready" });
        }

        const result = await dashboardWarn({
          client,
          guildId,
          userId,
          reason,
          actor,
        });

        const dbUser = result && result.dbUser ? result.dbUser : null;

        return res.json({
          ok: true,
          dbUser: dbUser
            ? { warnings: dbUser.warnings, trust: dbUser.trust }
            : null,
        });
      } catch (err) {
        if (err && err.code) {
          if (err.code === "USER_NOT_FOUND_IN_GUILD") {
            return res
              .status(404)
              .json({ ok: false, error: "User not found in guild" });
          }
          if (err.code === "BOT_MEMBER_NOT_AVAILABLE") {
            return res
              .status(500)
              .json({ ok: false, error: "Bot member not available" });
          }
          if (err.code === "CANNOT_WARN_BOT") {
            return res
              .status(400)
              .json({ ok: false, error: "Cannot warn the bot" });
          }
          if (err.code === "TARGET_ROLE_HIGHER_OR_EQUAL") {
            return res.status(400).json({
              ok: false,
              error: "Target role is higher or equal to bot",
            });
          }
          if (err.code === "CANNOT_WARN_ADMINS") {
            return res.status(400).json({
              ok: false,
              error: "Cannot warn administrators via dashboard",
            });
          }
          if (err.code === "CLIENT_NOT_READY") {
            return res
              .status(500)
              .json({ ok: false, error: "Client not ready" });
          }
        }

        return sendServerError(res, "/api/mod/warn", err);
      }
    },
  );

  app.post(
    "/api/mod/mute",
    requireDashboardAuth,
    canAct,
    guardGuildBody,
    rlMute,
    async (req, res) => {
      try {
        const body = req.body || {};
        const parseResult = ModMuteSchema.safeParse(body);
        if (!parseResult.success) {
          return res
            .status(400)
            .json({ ok: false, error: "Invalid mute payload" });
        }

        const {
          guildId: g0,
          userId: u0,
          duration: d0,
          reason: r0,
        } = parseResult.data;
        const guildId = sanitizeId(g0);
        const userId = sanitizeId(u0);
        const duration = sanitizeText(d0, { maxLen: 32, stripHtml: true });
        const reason = sanitizeText(r0, { maxLen: 1000, stripHtml: true });
        const actor = getActorFromRequest(req);

        await recordAudit({
          req,
          action: "mod.mute",
          guildId,
          targetUserId: userId,
          actor,
          payload: { reason },
        });

        if (!guildId || !userId) {
          return res
            .status(400)
            .json({ ok: false, error: "guildId and userId are required" });
        }

        const client = getClient();
        if (!client) {
          return res.status(500).json({ ok: false, error: "Client not ready" });
        }

        const r = reason || "Dashboard mute";
        const parsed = parseDuration(duration);
        const durationMs = parsed || config.muteDuration || 10 * 60 * 1000;

        const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
        if (durationMs > MAX_TIMEOUT_MS) {
          return res
            .status(400)
            .json({ ok: false, error: "Duration too long (max 28d)." });
        }

        const { guild, member } = await resolveGuildMember(
          client,
          guildId,
          userId,
        );
        if (!guild || !member) {
          return res
            .status(404)
            .json({ ok: false, error: "User not found in guild" });
        }

        const me = guild.members.me;
        if (!me) {
          return res
            .status(500)
            .json({ ok: false, error: "Bot member not available" });
        }

        if (member.id === me.id) {
          return res
            .status(400)
            .json({ ok: false, error: "Cannot mute the bot" });
        }

        if (member.roles.highest.position >= me.roles.highest.position) {
          return res.status(400).json({
            ok: false,
            error: "Target role is higher or equal to bot",
          });
        }

        if (!member.moderatable) {
          return res
            .status(400)
            .json({ ok: false, error: "Member is not moderatable by the bot" });
        }

        await member
          .timeout(durationMs, `Muted by dashboard: ${r}`)
          .catch((e) => {
            throw new Error(e?.message || "Failed to timeout");
          });

        const dbUser = await warningsService
          .applyMutePenalty(guild.id, member.id)
          .catch(() => null);

        // Persist an infraction for history
        await infractionsService
          .create({
            guild,
            user: member.user,
            moderator: client.user,
            type: "MUTE",
            reason: actor ? `${r} (dashboard: ${actor})` : r,
            duration: durationMs,
            source: "dashboard",
          })
          .catch(() => null);

        await logger(
          client,
          "Dashboard Mute",
          member.user,
          client.user,
          `Duration: **${formatDuration(durationMs)}**\nReason: **${r}**` +
            (actor ? `\nExecutor (dashboard): **${actor}**` : ""),
          guild,
        ).catch(() => null);

        return res.json({
          ok: true,
          durationMs,
          durationLabel: formatDuration(durationMs),
          dbUser: dbUser
            ? { warnings: dbUser.warnings, trust: dbUser.trust }
            : null,
        });
      } catch (err) {
        console.error("[Dashboard] /api/mod/mute error:", err);
        return res
          .status(500)
          .json({ ok: false, error: err?.message || "Internal Server Error" });
      }
    },
  );

  app.post(
    "/api/mod/unmute",
    requireDashboardAuth,
    canAct,
    guardGuildBody,
    rlUnmute,
    async (req, res) => {
      try {
        const body = req.body || {};
        const parseResult = ModUnmuteSchema.safeParse(body);
        if (!parseResult.success) {
          return res
            .status(400)
            .json({ ok: false, error: "Invalid unmute payload" });
        }

        const { guildId: g0, userId: u0, reason: r0 } = parseResult.data;
        const guildId = sanitizeId(g0);
        const userId = sanitizeId(u0);
        const reason = sanitizeText(r0, { maxLen: 1000, stripHtml: true });
        const actor = getActorFromRequest(req);

        await recordAudit({
          req,
          action: "mod.unmute",
          guildId,
          targetUserId: userId,
          actor,
          payload: { reason },
        });

        if (!guildId || !userId) {
          return res
            .status(400)
            .json({ ok: false, error: "guildId and userId are required" });
        }

        const client = getClient();
        if (!client) {
          return res.status(500).json({ ok: false, error: "Client not ready" });
        }

        const r = reason || "Dashboard unmute";

        const { guild, member } = await resolveGuildMember(
          client,
          guildId,
          userId,
        );
        if (!guild || !member) {
          return res
            .status(404)
            .json({ ok: false, error: "User not found in guild" });
        }

        const me = guild.members.me;
        if (!me) {
          return res
            .status(500)
            .json({ ok: false, error: "Bot member not available" });
        }

        if (member.roles.highest.position >= me.roles.highest.position) {
          return res.status(400).json({
            ok: false,
            error: "Target role is higher or equal to bot",
          });
        }

        await member.timeout(null, `Unmuted by dashboard: ${r}`).catch((e) => {
          throw new Error(e?.message || "Failed to remove timeout");
        });

        await logger(
          client,
          "Dashboard Unmute",
          member.user,
          client.user,
          `Reason: **${r}**` +
            (actor ? `\nExecutor (dashboard): **${actor}**` : ""),
          guild,
        ).catch(() => null);

        return res.json({ ok: true });
      } catch (err) {
        console.error("[Dashboard] /api/mod/unmute error:", err);
        return res
          .status(500)
          .json({ ok: false, error: err?.message || "Internal Server Error" });
      }
    },
  );

  app.post(
    "/api/mod/reset-trust",
    requireDashboardAuth,
    canAct,
    guardGuildBody,
    rlReset,
    async (req, res) => {
      try {
        const body = req.body || {};
        const parseResult = ModWarnSchema.safeParse(body);
        if (!parseResult.success) {
          return res
            .status(400)
            .json({ ok: false, error: "Invalid warn payload" });
        }

        const { guildId: g0, userId: u0, reason: r0 } = parseResult.data;
        const guildId = sanitizeId(g0);
        const userId = sanitizeId(u0);
        const reason = sanitizeText(r0, { maxLen: 1000, stripHtml: true });
        const actor = getActorFromRequest(req);

        await recordAudit({
          req,
          action: "mod.resetTrust",
          guildId,
          targetUserId: userId,
          actor,
          payload: { reason },
        });

        if (!guildId || !userId) {
          return res
            .status(400)
            .json({ ok: false, error: "guildId and userId are required" });
        }

        const client = getClient();
        if (!client) {
          return res.status(500).json({ ok: false, error: "Client not ready" });
        }

        const { guild, member } = await resolveGuildMember(
          client,
          guildId,
          userId,
        );
        if (!guild || !member) {
          return res
            .status(404)
            .json({ ok: false, error: "User not found in guild" });
        }

        const me = guild.members.me;
        if (!me) {
          return res
            .status(500)
            .json({ ok: false, error: "Bot member not available" });
        }

        if (
          member.roles.highest &&
          me.roles.highest &&
          member.roles.highest.comparePositionTo(me.roles.highest) >= 0
        ) {
          return res
            .status(403)
            .json({ ok: false, error: "User has higher or equal role" });
        }

        const baseReason = reason || "Dashboard reset trust/warnings";
        const trustCfg = await require("../../utils/trust").getGuildTrustConfig(
          guild.id,
        );
        const baseTrust = typeof trustCfg.base === "number" ? trustCfg.base : 0;

        const dbUser = await warningsService
          .resetUser(guild.id, member.id, baseTrust, baseReason)
          .catch(() => null);

        // Clear timeout if present
        try {
          const hasTimeoutFlag =
            typeof member.isCommunicationDisabled === "function"
              ? member.isCommunicationDisabled()
              : !!member.communicationDisabledUntilTimestamp;

          if (hasTimeoutFlag && typeof member.timeout === "function") {
            await member.timeout(null, baseReason).catch(() => null);
          }
        } catch {}

        // Remove infractions history for this user in this guild
        const { Infraction } = getModels();
        if (Infraction) {
          try {
            await Infraction.deleteMany({
              guildId: guild.id,
              userId: member.id,
            }).exec();
          } catch {}
        }

        return res.json({
          ok: true,
          dbUser: dbUser
            ? { warnings: dbUser.warnings, trust: dbUser.trust }
            : null,
        });
      } catch (err) {
        console.error("[Dashboard] /api/mod/reset-trust error:", err);
        return res
          .status(500)
          .json({ ok: false, error: err?.message || "Internal Server Error" });
      }
    },
  );

  app.post(
    "/api/mod/remove-infraction",
    requireDashboardAuth,
    canAct,
    guardGuildBody,
    rlRemoveInf,
    async (req, res) => {
      try {
        const { guildId: g0, userId: u0, infractionId: id0 } = req.body || {};
        const guildId = sanitizeId(g0);
        const userId = sanitizeId(u0);
        const infractionId =
          typeof id0 === "string" || typeof id0 === "number"
            ? String(id0)
            : null;
        const actor = getActorFromRequest(req);

        await recordAudit({
          req,
          action: "mod.removeInfraction",
          guildId,
          targetUserId: userId,
          actor,
          payload: { infractionId },
        });

        if (!guildId || !userId || !infractionId) {
          return res.status(400).json({
            ok: false,
            error: "Missing guildId, userId or infractionId",
          });
        }

        const { Infraction } = getModels();
        if (!Infraction) {
          return res
            .status(500)
            .json({ ok: false, error: "Infraction model not available" });
        }

        const rawCollection = Infraction.collection;
        if (!rawCollection) {
          return res
            .status(500)
            .json({ ok: false, error: "Infractions collection not available" });
        }

        const orFilters = [];

        if (infractionId) {
          if (
            typeof infractionId === "string" &&
            /^[0-9a-fA-F]{24}$/.test(infractionId)
          ) {
            try {
              orFilters.push({
                _id: new mongoose.Types.ObjectId(infractionId),
                guildId,
                userId,
              });
            } catch {}
          }

          orFilters.push({ _id: infractionId, guildId, userId });

          const asNumber = Number(infractionId);
          if (Number.isFinite(asNumber)) {
            orFilters.push({ caseId: asNumber, guildId, userId });
          }
        }

        const query = orFilters.length
          ? { $or: orFilters }
          : { guildId, userId };

        const inf = await rawCollection.findOne(query);
        if (!inf) {
          return res
            .status(404)
            .json({ ok: false, error: "Infraction not found" });
        }

        // permission guard (role hierarchy) if we can resolve
        const client = getClient();
        if (client) {
          try {
            const resolved = await resolveGuildMember(client, guildId, userId);
            const guild = resolved.guild;
            const member = resolved.member;
            if (guild && member && guild.members && guild.members.me) {
              const me = guild.members.me;
              if (
                member.roles?.highest &&
                me.roles?.highest &&
                member.roles.highest.comparePositionTo(me.roles.highest) >= 0
              ) {
                return res
                  .status(403)
                  .json({ ok: false, error: "User has higher or equal role" });
              }
            }
          } catch {}
        }

        if (typeof warningsService.removeInfractionEffects === "function") {
          try {
            await warningsService.removeInfractionEffects(
              guildId,
              userId,
              inf.type || "",
            );
          } catch {}
        }

        await rawCollection.deleteOne({ _id: inf._id, guildId, userId });

        return res.json({ ok: true });
      } catch (err) {
        console.error("[Dashboard] /api/mod/remove-infraction error:", err);
        return res
          .status(500)
          .json({ ok: false, error: err?.message || "Internal Server Error" });
      }
    },
  );

  app.get(
    "/api/mod/overview",
    requireDashboardAuth,
    canViewLogs,
    guardGuildQuery,
    rlOverview,
    async (req, res) => {
      try {
        const guildId = (req.query.guildId || "").toString().trim();
        if (!guildId) {
          return res.status(400).json({ ok: false, error: "Missing guildId" });
        }

        // Supported ranges for server insights.
        // Keep backward compatibility for older clients using 24h/1y.
        const rawRange = (req.query.range || "7d").toString();
        const range = ["7d", "14d", "30d", "24h", "1y"].includes(rawRange)
          ? rawRange
          : "7d";
        let windowHours = 24 * 7;
        if (range === "24h") windowHours = 24;
        else if (range === "14d") windowHours = 24 * 14;
        else if (range === "30d") windowHours = 24 * 30;
        else if (range === "1y") windowHours = 24 * 365;

        const now = new Date();
        const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);

        const cacheKey = `modOverview:${guildId}:${range}`;
        const cached = cacheGet(cacheKey);
        if (cached) return res.json(cached);

        const result = {
          ok: true,
          guildId,
          windowHours,
          range,
          since: since.toISOString(),
          // Your bot does not implement ban/kick. Keep fields for backwards compatibility,
          // but only compute what is real: WARN and MUTE infractions.
          moderationCounts: {
            warn: 0,
            mute: 0,
            unmute: 0,
            kick: 0,
            ban: 0,
            other: 0,
          },
          tickets: { total: 0, open: 0, closed: 0 },
        };

        const { TicketLog, Infraction, User } = getModels();

        // Moderation counts: use infractions as the single source of truth.
        // (No ban/kick in this bot; unmute is not tracked as an infraction.)
        try {
          if (Infraction) {
            const rows = await Infraction.aggregate([
              { $match: { guildId, createdAt: { $gte: since } } },
              { $group: { _id: "$type", count: { $sum: 1 } } },
            ]);

            result.moderationCounts.warn = 0;
            result.moderationCounts.mute = 0;

            for (const row of rows || []) {
              const k = String(row._id || "").toUpperCase();
              const c = Number(row.count || 0) || 0;
              if (k === "WARN") result.moderationCounts.warn = c;
              else if (k === "MUTE") result.moderationCounts.mute = c;
            }
          }
        } catch (err) {
          console.error(
            "[Dashboard] /api/mod/overview infraction counts error:",
            err,
          );
        }

        try {
          if (TicketLog) {
            const tq = { guildId, createdAt: { $gte: since } };
            const tickets = await TicketLog.find(tq, {
              createdAt: 1,
              closedAt: 1,
            }).lean();
            result.tickets.total = tickets.length;
            for (const t of tickets) {
              if (t.closedAt) result.tickets.closed++;
              else result.tickets.open++;
            }
          }
        } catch (err) {
          console.error("[Dashboard] /api/mod/overview tickets error:", err);
        }

        // Trust risk breakdown (optional). Helps the "Server Insights" panel.
        // Safe to ignore if User model is not available.
        try {
          if (User) {
            const rows = await User.aggregate([
              { $match: { guildId } },
              {
                $bucket: {
                  groupBy: "$trust",
                  boundaries: [0, 21, 41, 61, 81, 101],
                  default: "unknown",
                  output: { count: { $sum: 1 } },
                },
              },
            ]);

            const map = new Map();
            for (const r of rows || []) {
              map.set(String(r._id), Number(r.count || 0) || 0);
            }

            result.riskBreakdown = [
              { label: "0-20", value: map.get("0") || 0 },
              { label: "21-40", value: map.get("21") || 0 },
              { label: "41-60", value: map.get("41") || 0 },
              { label: "61-80", value: map.get("61") || 0 },
              { label: "81-100", value: map.get("81") || 0 },
            ];
          }
        } catch (err) {
          console.error(
            "[Dashboard] /api/mod/overview risk breakdown error:",
            err,
          );
        }

        // Provide a stable, frontend-friendly stats object.
        try {
          const mc = result.moderationCounts || {};
          const warns = Number(mc.warn || 0) || 0;
          const mutes = Number(mc.mute || 0) || 0;
          result.stats = {
            totalActions: warns + mutes,
            warns,
            mutes,
          };
        } catch {}
        cacheSet(cacheKey, result);
        return res.json(result);
      } catch (err) {
        console.error("[Dashboard] /api/mod/overview error:", err);
        return res
          .status(500)
          .json({ ok: false, error: err?.message || "Internal Server Error" });
      }
    },
  );

  // ==============================
  // Activity ("Top Online")
  // ==============================
  app.get(
    "/api/mod/top-online",
    requireDashboardAuth,
    canViewLogs,
    guardGuildQuery,
    rlTopOnline,
    async (req, res) => {
      try {
        const guildId = sanitizeId(req.query.guildId || "");
        const range = String(req.query.range || "7d").trim();

        const { UserActivity, PresenceSession } = getModels();

        let days = 7;
        if (range === "14d") days = 14;
        else if (range === "30d") days = 30;

        const now = new Date();
        const windowStart = new Date(
          now.getTime() - days * 24 * 60 * 60 * 1000,
        );

        let rows = [];
        let mode = "presence";

        // Prefer presence sessions (true online time). Fallback to message activity if model not available.
        if (PresenceSession) {
          rows = await PresenceSession.aggregate([
            {
              $match: {
                guildId,
                isBot: { $ne: true },
                startAt: { $lt: now },
                $or: [{ endAt: { $gte: windowStart } }, { endAt: null }],
              },
            },
            {
              $addFields: {
                _ws: { $literal: windowStart },
                _now: { $literal: now },
                _end: { $ifNull: ["$endAt", now] },
              },
            },
            {
              $addFields: {
                effStart: { $max: ["$startAt", "$_ws"] },
                effEnd: { $min: ["$_end", "$_now"] },
              },
            },
            {
              $addFields: {
                secondsOnline: {
                  $divide: [{ $subtract: ["$effEnd", "$effStart"] }, 1000],
                },
              },
            },
            { $match: { secondsOnline: { $gt: 0 } } },
            {
              $group: {
                _id: "$userId",
                secondsOnline: { $sum: "$secondsOnline" },
              },
            },
            { $sort: { secondsOnline: -1 } },
            { $limit: 12 },
          ]);
        } else {
          mode = "messages";
        }

        if ((!rows || !rows.length) && UserActivity) {
          // Fallback: message activity (existing behavior)
          mode = "messages";
          const start = new Date(
            Date.UTC(
              now.getUTCFullYear(),
              now.getUTCMonth(),
              now.getUTCDate(),
              0,
              0,
              0,
              0,
            ),
          );
          start.setUTCDate(start.getUTCDate() - (days - 1));

          rows = await UserActivity.aggregate([
            { $match: { guildId, day: { $gte: start } } },
            { $group: { _id: "$userId", messages: { $sum: "$messages" } } },
            { $sort: { messages: -1 } },
            { $limit: 12 },
          ]);
        }

        const ids = rows.map((r) => String(r._id));
        const client = getClient();
        const guild = client?.guilds?.cache?.get(guildId) || null;

        const nameById = new Map();
        // Membros que já não pertencem ao servidor: não devem constar no registo.
        const goneIds = new Set();
        for (const id of ids) {
          let name = null;
          let stillMember = false;
          try {
            const cached = guild?.members?.cache?.get(id) || null;
            if (cached) {
              name = cached.displayName || cached.user?.username || null;
              stillMember = true;
            } else if (guild) {
              try {
                const fetched = await guild.members.fetch(id);
                name = fetched?.displayName || fetched?.user?.username || null;
                stillMember = true;
              } catch (e) {
                // 10007 = Unknown Member → saiu do servidor.
                // Qualquer outro erro é transitório (rede/rate limit): mantém-se.
                if (!e || e.code !== 10007) stillMember = true;
              }
            } else {
              // Sem guild em cache não conseguimos validar: não descartamos.
              stillMember = true;
            }
          } catch {}
          if (name) nameById.set(id, name);
          if (!stillMember) goneIds.add(id);
        }

        const items = rows
          .filter((r) => !goneIds.has(String(r._id)))
          .map((r) => {
            const id = String(r._id);
            const item = {
              userId: id,
              username: nameById.get(id) || null,
            };
            if (mode === "presence")
              item.secondsOnline = Math.round(
                Number(r.secondsOnline || 0) || 0,
              );
            else item.messages = Number(r.messages || 0) || 0;
            return item;
          });

        return res.json({ ok: true, range, mode, items });
      } catch (err) {
        return sendServerError(res, "/api/mod/top-online", err);
      }
    },
  );
}

module.exports = { registerModRoutes };
