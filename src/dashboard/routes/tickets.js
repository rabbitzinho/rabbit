// src/dashboard/routes/tickets.js

const { sendServerError } = require("./_errors");
const { PermissionsBitField } = require("discord.js");
const {
  getGuild,
  getCachedChannel,
  resolveChannel,
  resolveMember,
} = require("../../services/guildService");

module.exports = {
  registerTicketsRoutes,
};

function registerTicketsRoutes(opts) {
  const {
    app,
    requireDashboardAuth,
    requirePerm,
    requireGuildAccess,
    rateLimit,
    sanitizeText,
    getActorFromRequest,
    recordAudit,
    _getClient,
    _getModels,
  } = opts;

  if (!app) throw new Error("registerTicketsRoutes: app is required");

  const canManageTickets =
    typeof requirePerm === "function"
      ? requirePerm({ anyOf: ["canManageTickets"] })
      : (req, res, next) => next();

  const guardGuildQuery =
    typeof requireGuildAccess === "function"
      ? requireGuildAccess({ from: "query", key: "guildId" })
      : (req, res, next) => next();

  const guardGuildQueryOptional =
    typeof requireGuildAccess === "function"
      ? requireGuildAccess({ from: "query", key: "guildId", optional: true })
      : (req, res, next) => next();

  const guardGuildBodyOptional =
    typeof requireGuildAccess === "function"
      ? requireGuildAccess({ from: "body", key: "guildId", optional: true })
      : (req, res, next) => next();

  function hasGuildAccess(req, guildId) {
    try {
      const u = req && req.dashboardUser;
      if (!u || !guildId) return false;
      const list = Array.isArray(u.allowedGuildIds)
        ? u.allowedGuildIds.filter(Boolean).map(String)
        : [];
      return (
        list.includes(String(guildId)) &&
        String(u.selectedGuildId || "") === String(guildId)
      );
    } catch {
      return false;
    }
  }

  // -----------------------------
  // List tickets (dashboard)
  // GET /api/tickets?guildId=...&status=open|closed|all&q=...&limit=...&cursor=...
  // -----------------------------
  app.get(
    "/api/tickets/assignees",
    requireDashboardAuth,
    canManageTickets,
    guardGuildQuery,
    rateLimit({
      windowMs: 60_000,
      max: 60,
      keyPrefix: "rl:tickets:assignees:",
    }),
    async (req, res) => {
      try {
        const guildId = String(req.query.guildId || "").trim();
        const query = String(req.query.q || "").trim();
        if (!/^\d{10,32}$/.test(guildId))
          return res.status(400).json({ ok: false, error: "INVALID_GUILD_ID" });
        if (query.length < 2) return res.json({ ok: true, items: [] });

        const client = _getClient ? _getClient() : null;
        const guild = getGuild(client, guildId);
        if (!guild)
          return res.status(404).json({ ok: false, error: "GUILD_NOT_FOUND" });

        let members;
        try {
          members = await guild.members.fetch({ query, limit: 100 });
        } catch {
          const normalizedQuery = query.toLowerCase();
          members = guild.members.cache.filter((member) =>
            String(member.displayName || member.user?.username || "")
              .toLowerCase()
              .includes(normalizedQuery),
          );
        }

        const models = _getModels ? _getModels() : {};
        const config = models.GuildConfig
          ? await models.GuildConfig.findOne({ guildId }).lean()
          : null;
        const featureRoles = config?.staffRolesByFeature?.tickets;
        const staffRoleIds = new Set(
          (Array.isArray(featureRoles) && featureRoles.length
            ? featureRoles
            : config?.staffRoleIds || []
          ).map(String),
        );
        const items = Array.from(members.values())
          .filter((member) => {
            if (!member || member.user?.bot) return false;
            const isServerAdmin = member.permissions?.has(
              PermissionsBitField.Flags.Administrator,
            );
            const hasStaffRole = Array.from(
              member.roles?.cache?.keys?.() || [],
            ).some((roleId) => staffRoleIds.has(String(roleId)));
            return isServerAdmin || hasStaffRole;
          })
          .map((member) => ({
            id: String(member.id),
            name:
              member.displayName ||
              member.user?.globalName ||
              member.user?.username ||
              String(member.id),
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, 25);

        return res.json({ ok: true, items });
      } catch (err) {
        return sendServerError(res, "GET /api/tickets/assignees", err);
      }
    },
  );

  app.get(
    "/api/tickets",
    requireDashboardAuth,
    canManageTickets,
    guardGuildQuery,
    rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "rl:tickets:list:" }),
    async (req, res) => {
      try {
        const { TicketModel } = _getModels ? _getModels() : {};
        if (!TicketModel)
          return res
            .status(503)
            .json({ ok: false, error: "Ticket model not available" });

        const guildId = (req.query.guildId || "").toString().trim();
        if (!guildId)
          return res
            .status(400)
            .json({ ok: false, error: "guildId is required" });

        const statusRaw = (req.query.status || "open")
          .toString()
          .trim()
          .toLowerCase();
        const status =
          statusRaw === "all"
            ? "all"
            : statusRaw === "closed"
              ? "closed"
              : "open";
        const q = (req.query.q || "").toString().trim();
        const priority = (req.query.priority || "all")
          .toString()
          .trim()
          .toLowerCase();
        const assignee = (req.query.assignee || "").toString().trim();
        const sortBySla = String(req.query.sort || "") === "sla";
        const cursor = (req.query.cursor || "").toString().trim();

        let limit = Number(req.query.limit || 50);
        if (!Number.isFinite(limit) || limit <= 0) limit = 50;
        limit = Math.max(1, Math.min(200, Math.floor(limit)));

        const query = { guildId };
        if (status !== "all") query.status = status;
        const and = [];
        if (priority === "normal") {
          and.push({ $or: [{ priority: "normal" }, { priority: null }] });
        } else if (["low", "high", "urgent"].includes(priority)) {
          query.priority = priority;
        }

        if (q) {
          // Basic search: ticketNumber exact, userId exact, username/subject partial
          const or = [];
          const asNum = Number(q);
          if (Number.isFinite(asNum) && asNum > 0)
            or.push({ ticketNumber: asNum });
          if (/^\d{10,32}$/.test(q)) or.push({ userId: q });
          const re = new RegExp(escapeRegExp(q), "i");
          or.push({ username: re });
          or.push({ subject: re });
          and.push({ $or: or });
        }

        if (assignee) {
          const re = new RegExp(escapeRegExp(assignee.slice(0, 80)), "i");
          and.push(
            /^\d{10,32}$/.test(assignee)
              ? { assignedToId: assignee }
              : { assignedToName: re },
          );
        }

        // Preserve creation-time pagination unless SLA ordering was requested.
        if (cursor && !sortBySla) {
          const parts = cursor.split("|");
          const cursorDate = parts[0] ? new Date(parts[0]) : null;
          const cursorId = parts[1] || null;
          if (cursorDate && !Number.isNaN(cursorDate.getTime()) && cursorId) {
            and.push({
              $or: [
                { createdAt: { $lt: cursorDate } },
                { createdAt: cursorDate, _id: { $lt: cursorId } },
              ],
            });
          } else if (cursorDate && !Number.isNaN(cursorDate.getTime())) {
            query.createdAt = { $lt: cursorDate };
          }
        }

        if (and.length) query.$and = and;

        if (sortBySla) {
          const noDeadline = new Date("9999-12-31T23:59:59.999Z");
          const pipeline = [
            { $match: query },
            {
              $addFields: {
                ticketSlaSortAt: {
                  $cond: [
                    { $eq: ["$status", "closed"] },
                    noDeadline,
                    { $ifNull: ["$slaDueAt", noDeadline] },
                  ],
                },
                ticketSlaSortId: { $toString: "$_id" },
              },
            },
          ];
          if (cursor) {
            const [cursorValue, cursorId] = cursor.split("|");
            const cursorDate = new Date(cursorValue);
            if (!Number.isNaN(cursorDate.getTime()) && cursorId) {
              pipeline.push({
                $match: {
                  $or: [
                    { ticketSlaSortAt: { $gt: cursorDate } },
                    {
                      $and: [
                        { ticketSlaSortAt: cursorDate },
                        { ticketSlaSortId: { $gt: cursorId } },
                      ],
                    },
                  ],
                },
              });
            }
          }
          pipeline.push(
            { $sort: { ticketSlaSortAt: 1, ticketSlaSortId: 1 } },
            { $limit: limit + 1 },
          );
          const result = await TicketModel.aggregate(pipeline);
          const hasMore = result.length > limit;
          const items = result.slice(0, limit);
          let nextCursor = null;
          if (hasMore && items.length) {
            const last = items[items.length - 1];
            nextCursor = `${new Date(last.ticketSlaSortAt).toISOString()}|${last.ticketSlaSortId}`;
          }
          items.forEach((item) => {
            delete item.ticketSlaSortAt;
            delete item.ticketSlaSortId;
          });
          return res.json({ ok: true, items, nextCursor });
        }

        const items = await TicketModel.find(query)
          .sort({ createdAt: -1, _id: -1 })
          .limit(limit)
          .lean();

        let nextCursor = null;
        if (items && items.length === limit) {
          const last = items[items.length - 1];
          const d = last && last.createdAt ? new Date(last.createdAt) : null;
          if (d && !Number.isNaN(d.getTime()) && last && last._id) {
            nextCursor = `${d.toISOString()}|${last._id}`;
          }
        }

        return res.json({ ok: true, items, nextCursor });
      } catch (err) {
        return sendServerError(res, "GET /api/tickets", err);
      }
    },
  );

  app.post(
    "/api/tickets/:ticketId/manage",
    requireDashboardAuth,
    canManageTickets,
    guardGuildBodyOptional,
    guardGuildQueryOptional,
    rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "rl:tickets:manage:" }),
    async (req, res) => {
      try {
        const { TicketModel } = _getModels ? _getModels() : {};
        if (!TicketModel)
          return res
            .status(503)
            .json({ ok: false, error: "Ticket model not available" });

        const ticketId = String(req.params.ticketId || "").trim();
        const ticket = ticketId
          ? await TicketModel.findById(ticketId).lean()
          : null;
        if (!ticket)
          return res.status(404).json({ ok: false, error: "Ticket not found" });

        const guildId = String(
          req.body?.guildId || ticket.guildId || "",
        ).trim();
        if (!guildId)
          return res
            .status(400)
            .json({ ok: false, error: "guildId is required" });
        if (String(ticket.guildId) !== guildId || !hasGuildAccess(req, guildId))
          return res.status(403).json({ ok: false, error: "NO_GUILD_ACCESS" });

        const priority = String(req.body?.priority || "normal").toLowerCase();
        if (!["low", "normal", "high", "urgent"].includes(priority))
          return res.status(400).json({ ok: false, error: "INVALID_PRIORITY" });

        const rawAssigneeId = String(req.body?.assignedToId || "").trim();
        if (rawAssigneeId && !/^\d{10,32}$/.test(rawAssigneeId))
          return res.status(400).json({ ok: false, error: "INVALID_ASSIGNEE" });

        const rawSlaHours = req.body?.slaHours;
        const slaHours =
          rawSlaHours === "" || rawSlaHours == null ? 0 : Number(rawSlaHours);
        if (![0, 4, 8, 24, 48, 72].includes(slaHours))
          return res.status(400).json({ ok: false, error: "INVALID_SLA" });

        let assignedToName = null;
        if (rawAssigneeId) {
          const client = _getClient ? _getClient() : null;
          const member = await resolveMember(client, guildId, rawAssigneeId);
          if (!member)
            return res
              .status(400)
              .json({ ok: false, error: "ASSIGNEE_NOT_IN_GUILD" });
          assignedToName =
            member.displayName ||
            member.user?.globalName ||
            member.user?.username ||
            rawAssigneeId;
        }

        const now = new Date();
        const actor =
          (getActorFromRequest && getActorFromRequest(req)) || "dashboard";
        await TicketModel.updateOne(
          { _id: ticketId, guildId },
          {
            $set: {
              assignedToId: rawAssigneeId || null,
              assignedToName,
              priority,
              slaHours,
              slaDueAt: slaHours
                ? new Date(now.getTime() + slaHours * 60 * 60 * 1000)
                : null,
              metadataUpdatedAt: now,
              metadataUpdatedById: String(actor),
            },
          },
        );

        const updatedTicket = await TicketModel.findById(ticketId).lean();
        if (recordAudit) {
          await recordAudit({
            req,
            action: "ticket.metadata.update",
            guildId,
            targetUserId: ticket.userId,
            actor,
            payload: { ticketId, priority, slaHours },
          });
        }

        return res.json({ ok: true, ticket: updatedTicket });
      } catch (err) {
        return sendServerError(res, "POST /api/tickets/:ticketId/manage", err);
      }
    },
  );

  // -----------------------------
  // Ticket audit/timeline (dashboard)
  // GET /api/tickets/:ticketId/audit?guildId=...
  // Uses Ticket + TicketLog as a lightweight timeline.
  // -----------------------------
  app.get(
    "/api/tickets/:ticketId/audit",
    requireDashboardAuth,
    canManageTickets,
    guardGuildQueryOptional,
    rateLimit({ windowMs: 60_000, max: 240, keyPrefix: "rl:tickets:audit:" }),
    async (req, res) => {
      try {
        const { TicketModel, TicketLogModel } = _getModels ? _getModels() : {};
        if (!TicketModel)
          return res
            .status(503)
            .json({ ok: false, error: "Ticket model not available" });

        const ticketId = (req.params.ticketId || "").toString().trim();
        if (!ticketId)
          return res
            .status(400)
            .json({ ok: false, error: "ticketId is required" });

        const ticket = await TicketModel.findById(ticketId).lean();
        if (!ticket)
          return res.status(404).json({ ok: false, error: "Ticket not found" });

        const guildId = (req.query.guildId || ticket.guildId || "")
          .toString()
          .trim();
        if (!guildId)
          return res
            .status(400)
            .json({ ok: false, error: "guildId is required" });

        if (!hasGuildAccess(req, guildId)) {
          return res.status(403).json({ ok: false, error: "NO_GUILD_ACCESS" });
        }

        const items = [];
        // Open event
        if (ticket.createdAt) {
          items.push({
            action: "opened",
            createdAt: new Date(ticket.createdAt).toISOString(),
            actorId: ticket.userId || null,
            actorUsername: ticket.username || null,
          });
        }

        // Closed event (from Ticket or TicketLog)
        let closedAt = ticket.closedAt || null;
        let closedByUsername = ticket.closedByUsername || null;
        let closedById = ticket.closedById || null;
        if ((!closedAt || !closedByUsername) && TicketLogModel) {
          try {
            const log = await TicketLogModel.findOne({
              $or: [{ ticketId: ticket._id }, { channelId: ticket.channelId }],
            })
              .sort({ createdAt: -1 })
              .lean();
            if (log) {
              closedAt = closedAt || log.closedAt;
              closedByUsername = closedByUsername || log.closedByUsername;
              closedById = closedById || log.closedById;
            }
          } catch {}
        }

        if (closedAt) {
          items.push({
            action: "closed",
            createdAt: new Date(closedAt).toISOString(),
            actorId: closedById || null,
            actorUsername: closedByUsername || null,
          });
        }

        // Ensure chronological
        items.sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return ta - tb;
        });

        return res.json({ ok: true, items });
      } catch (err) {
        return sendServerError(res, "GET /api/tickets/:ticketId/audit", err);
      }
    },
  );

  // -----------------------------
  // Ticket messages (for dashboard view)
  // GET /api/tickets/:ticketId/messages?guildId=...&limit=...
  // Returns the most recent messages from the ticket thread.
  // -----------------------------
  app.get(
    "/api/tickets/:ticketId/messages",
    requireDashboardAuth,
    canManageTickets,
    guardGuildQueryOptional,
    rateLimit({ windowMs: 60_000, max: 240, keyPrefix: "rl:tickets:msgs:" }),
    async (req, res) => {
      try {
        const { TicketModel } = _getModels ? _getModels() : {};
        if (!TicketModel)
          return res
            .status(503)
            .json({ ok: false, error: "Ticket model not available" });

        const ticketId = (req.params.ticketId || "").toString().trim();
        if (!ticketId)
          return res
            .status(400)
            .json({ ok: false, error: "ticketId is required" });

        const ticket = await TicketModel.findById(ticketId).lean();
        if (!ticket)
          return res.status(404).json({ ok: false, error: "Ticket not found" });

        const guildId = (
          req.query.guildId ||
          req.body?.guildId ||
          ticket.guildId ||
          ""
        )
          .toString()
          .trim();
        if (!guildId)
          return res
            .status(400)
            .json({ ok: false, error: "guildId is required" });

        if (!hasGuildAccess(req, guildId)) {
          return res.status(403).json({ ok: false, error: "NO_GUILD_ACCESS" });
        }

        let limit = Number(req.query.limit || 25);
        if (!Number.isFinite(limit) || limit <= 0) limit = 25;
        limit = Math.max(1, Math.min(50, Math.floor(limit)));

        const client = _getClient ? _getClient() : null;
        if (!client)
          return res
            .status(503)
            .json({ ok: false, error: "Discord client not available" });

        const guild = getGuild(client, guildId);
        if (!guild)
          return res.status(404).json({ ok: false, error: "Guild not found" });

        const channelId = ticket.channelId;
        if (!channelId)
          return res
            .status(400)
            .json({ ok: false, error: "Ticket channelId is missing" });

        // Fetch the thread channel and its recent messages.
        const ch = await resolveChannel(client, guildId, channelId);
        if (!ch || !ch.messages || typeof ch.messages.fetch !== "function") {
          return res
            .status(404)
            .json({ ok: false, error: "Ticket thread not accessible" });
        }

        const msgs = await ch.messages.fetch({ limit });
        const items = Array.from(msgs.values())
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
          // Hide bot/system noise by default so operators see the user's context.
          .filter((m) => {
            if (!m) return false;
            const raw = (m.content || "").toString().trim();
            if (!raw) return false;

            // Hide generic bot/system noise, but KEEP dashboard staff replies.
            const isBot = !!(m.author && m.author.bot);
            if (isBot) {
              const pfxA = "Resposta da equipa:";
              const pfxB = "**Resposta da equipa:**";
              return raw.startsWith(pfxA) || raw.startsWith(pfxB);
            }
            return true;
          })
          .map((m) => {
            const authorUsername = m.author ? m.author.username || "" : "";
            const authorId = m.author ? m.author.id : "";
            const raw = (m.content || "").toString();
            const pfxA = "Resposta da equipa:";
            const pfxB = "**Resposta da equipa:**";
            const trimmed = raw.trim();
            const isStaffReply =
              trimmed.startsWith(pfxA) || trimmed.startsWith(pfxB);
            let rawForDisplay = raw;
            if (isStaffReply) {
              if (trimmed.startsWith(pfxB))
                rawForDisplay = trimmed.slice(pfxB.length).trimStart();
              else rawForDisplay = trimmed.slice(pfxA.length).trimStart();
            }
            const clean = sanitizeText
              ? sanitizeText(rawForDisplay, { maxLen: 2000, stripHtml: true })
              : rawForDisplay.slice(0, 2000);
            return {
              id: m.id,
              authorId,
              authorUsername,
              isBot: !!(m.author && m.author.bot),
              isStaffReply: !!isStaffReply,
              createdAt: m.createdAt ? m.createdAt.toISOString() : null,
              content: clean,
            };
          });

        return res.json({ ok: true, items });
      } catch (err) {
        return sendServerError(res, "GET /api/tickets/:ticketId/messages", err);
      }
    },
  );

  // -----------------------------
  // Close/reopen ticket
  // -----------------------------
  app.post(
    "/api/tickets/:ticketId/close",
    requireDashboardAuth,
    canManageTickets,
    guardGuildBodyOptional,
    guardGuildQueryOptional,
    // Keep UX smooth: allow normal operator usage without tripping 429 on repeated clicks.
    // Still protected by global /api limiter + per-IP keying.
    rateLimit({ windowMs: 60_000, max: 120, keyPrefix: "rl:tickets:close:" }),
    async (req, res) => {
      try {
        const { TicketModel, TicketLogModel } = _getModels ? _getModels() : {};
        if (!TicketModel)
          return res
            .status(503)
            .json({ ok: false, error: "Ticket model not available" });

        const ticketId = (req.params.ticketId || "").toString().trim();
        if (!ticketId)
          return res
            .status(400)
            .json({ ok: false, error: "ticketId is required" });

        const ticket = await TicketModel.findById(ticketId).lean();
        if (!ticket)
          return res.status(404).json({ ok: false, error: "Ticket not found" });

        const guildId = (req.body?.guildId || ticket.guildId || "")
          .toString()
          .trim();
        if (!guildId)
          return res
            .status(400)
            .json({ ok: false, error: "guildId is required" });

        if (!hasGuildAccess(req, guildId)) {
          return res.status(403).json({ ok: false, error: "NO_GUILD_ACCESS" });
        }

        const actor =
          (getActorFromRequest && getActorFromRequest(req)) || "dashboard";
        const closedAt = new Date();

        // Update DB
        await TicketModel.updateOne(
          { _id: ticketId },
          {
            $set: {
              status: "closed",
              closedAt,
              closedById: actor,
              closedByUsername: actor,
            },
          },
        );

        // Keep legacy analytics consistent: TicketLog is used by /api/mod/overview.
        if (TicketLogModel) {
          try {
            await TicketLogModel.updateOne(
              {
                $or: [{ ticketId: ticketId }, { channelId: ticket.channelId }],
              },
              {
                $set: { closedAt, closedById: actor, closedByUsername: actor },
              },
            );
          } catch {}
        }

        // Try to archive/lock thread
        const client = _getClient ? _getClient() : null;
        if (client) {
          const ch = getCachedChannel(client, guildId, ticket.channelId);
          if (ch && typeof ch.setArchived === "function") {
            try {
              await ch.setLocked(true, "Closed via dashboard");
            } catch {}
            try {
              await ch.setArchived(true, "Closed via dashboard");
            } catch {}
          }
        }

        if (recordAudit) {
          await recordAudit({
            req,
            action: "ticket.close",
            guildId,
            targetUserId: ticket.userId,
            actor,
            payload: { ticketId },
          });
        }

        return res.json({ ok: true });
      } catch (err) {
        return sendServerError(res, "POST /api/tickets/:ticketId/close", err);
      }
    },
  );

  app.post(
    "/api/tickets/:ticketId/reopen",
    requireDashboardAuth,
    canManageTickets,
    guardGuildBodyOptional,
    guardGuildQueryOptional,
    rateLimit({ windowMs: 60_000, max: 120, keyPrefix: "rl:tickets:reopen:" }),
    async (req, res) => {
      try {
        const { TicketModel, TicketLogModel } = _getModels ? _getModels() : {};
        if (!TicketModel)
          return res
            .status(503)
            .json({ ok: false, error: "Ticket model not available" });

        const ticketId = (req.params.ticketId || "").toString().trim();
        if (!ticketId)
          return res
            .status(400)
            .json({ ok: false, error: "ticketId is required" });

        const ticket = await TicketModel.findById(ticketId).lean();
        if (!ticket)
          return res.status(404).json({ ok: false, error: "Ticket not found" });

        const guildId = (req.body?.guildId || ticket.guildId || "")
          .toString()
          .trim();
        if (!guildId)
          return res
            .status(400)
            .json({ ok: false, error: "guildId is required" });

        if (!hasGuildAccess(req, guildId)) {
          return res.status(403).json({ ok: false, error: "NO_GUILD_ACCESS" });
        }

        const actor =
          (getActorFromRequest && getActorFromRequest(req)) || "dashboard";

        await TicketModel.updateOne(
          { _id: ticketId },
          {
            $set: {
              status: "open",
              closedAt: null,
              closedById: null,
              closedByUsername: null,
            },
          },
        );

        if (TicketLogModel) {
          try {
            await TicketLogModel.updateOne(
              {
                $or: [{ ticketId: ticketId }, { channelId: ticket.channelId }],
              },
              {
                $set: {
                  closedAt: null,
                  closedById: null,
                  closedByUsername: null,
                },
              },
            );
          } catch {}
        }

        const client = _getClient ? _getClient() : null;
        if (client) {
          const ch = getCachedChannel(client, guildId, ticket.channelId);
          if (ch && typeof ch.setArchived === "function") {
            try {
              await ch.setArchived(false, "Reopened via dashboard");
            } catch {}
            try {
              await ch.setLocked(false, "Reopened via dashboard");
            } catch {}
          }
        }

        if (recordAudit) {
          await recordAudit({
            req,
            action: "ticket.reopen",
            guildId,
            targetUserId: ticket.userId,
            actor,
            payload: { ticketId },
          });
        }

        return res.json({ ok: true });
      } catch (err) {
        return sendServerError(res, "POST /api/tickets/:ticketId/reopen", err);
      }
    },
  );

  // Reply to a ticket from the dashboard
  app.post(
    "/api/tickets/:ticketId/reply",
    requireDashboardAuth,
    canManageTickets,
    guardGuildBodyOptional,
    guardGuildQueryOptional,
    rateLimit({ windowMs: 60_000, max: 240, keyPrefix: "rl:tickets:reply:" }),
    async (req, res) => {
      try {
        const { TicketModel } = _getModels ? _getModels() : {};
        if (!TicketModel) {
          return res
            .status(503)
            .json({ ok: false, error: "Ticket model not available" });
        }

        const ticketId = (req.params.ticketId || "").toString().trim();
        const rawGuildId = (req.body?.guildId || "").toString().trim();
        const content = sanitizeText
          ? sanitizeText(req.body?.content || "", {
              maxLen: 2000,
              stripHtml: true,
            })
          : (req.body?.content || "").toString().slice(0, 2000);

        if (!ticketId) {
          return res
            .status(400)
            .json({ ok: false, error: "ticketId is required" });
        }
        if (!content) {
          return res
            .status(400)
            .json({ ok: false, error: "content is required" });
        }

        const ticket = await TicketModel.findById(ticketId).lean();
        if (!ticket) {
          return res.status(404).json({ ok: false, error: "Ticket not found" });
        }

        const guildId = rawGuildId || ticket.guildId || "";
        if (!guildId) {
          return res
            .status(400)
            .json({ ok: false, error: "guildId is required" });
        }

        if (!hasGuildAccess(req, guildId)) {
          return res.status(403).json({ ok: false, error: "NO_GUILD_ACCESS" });
        }

        const client = _getClient ? _getClient() : null;
        if (!client) {
          return res
            .status(503)
            .json({ ok: false, error: "Client not available" });
        }

        const guild = getGuild(client, guildId);
        if (!guild) {
          return res.status(404).json({ ok: false, error: "Guild not found" });
        }

        const channelId = ticket.channelId;
        if (!channelId) {
          return res
            .status(404)
            .json({ ok: false, error: "Ticket channel not found" });
        }

        const channel = resolveChannel(client, guildId, channelId, {
          fetch: false,
        });
        if (!channel || !channel.isTextBased?.()) {
          return res.status(404).json({
            ok: false,
            error: "Ticket channel not found or not text-based",
          });
        }

        const actor =
          (getActorFromRequest && getActorFromRequest(req)) || "dashboard";
        // Make staff replies visually distinct in Discord while still allowing the dashboard
        // to detect and show them (see /messages filtering).
        const prefix = "**Resposta da equipa:**";

        await channel.send(`${prefix}\n${content}`);

        try {
          await TicketModel.updateOne(
            { _id: ticketId },
            {
              $set: {
                lastMessageAt: new Date(),
                lastResponderId: actor,
                lastResponderName: actor,
                lastResponderAt: new Date(),
              },
            },
          );
        } catch (e) {
          console.warn(
            "[Dashboard] Failed to update ticket lastMessageAt:",
            e?.message || e,
          );
        }

        if (recordAudit) {
          await recordAudit({
            req,
            action: "ticket.reply",
            guildId,
            targetUserId: ticket.userId,
            actor,
            payload: { ticketId },
          });
        }

        return res.json({ ok: true });
      } catch (err) {
        return sendServerError(res, "/api/tickets/:ticketId/reply", err);
      }
    },
  );
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
