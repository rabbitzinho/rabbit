// src/dashboard/routes/tickets.js

const { sendServerError } = require("./_errors");
const { PermissionsBitField } = require("discord.js");
const {
  getGuild,
  getCachedChannel,
  resolveChannel,
  resolveMember,
} = require("../../services/guildService");

const TICKET_TRANSCRIPT_MAX_MESSAGES = 1000;
const TICKET_TRANSCRIPT_PAGE_SIZE = 100;

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

  function createTicketActivityEvent(req, actorId, action, details) {
    return {
      action,
      actorId: String(actorId || "dashboard").slice(0, 64),
      actorUsername:
        String(req?.dashboardUser?.username || "").slice(0, 64) || null,
      createdAt: new Date(),
      details: details || null,
    };
  }

  async function appendTicketActivity(
    TicketModel,
    ticketId,
    guildId,
    req,
    actorId,
    action,
    details,
  ) {
    await TicketModel.updateOne(
      { _id: ticketId, guildId },
      {
        $push: {
          activity: {
            $each: [createTicketActivityEvent(req, actorId, action, details)],
            $slice: -100,
          },
        },
      },
    );
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

        let labels;
        if (req.body?.labels !== undefined) {
          const rawLabels = Array.isArray(req.body.labels)
            ? req.body.labels
            : typeof req.body.labels === "string"
              ? req.body.labels.split(",")
              : null;
          if (!rawLabels || rawLabels.length > 8)
            return res
              .status(400)
              .json({ ok: false, error: "INVALID_TICKET_LABELS" });
          labels = [];
          const seenLabels = new Set();
          for (const rawLabel of rawLabels) {
            const untrimmed = String(rawLabel || "").trim();
            if (untrimmed.length > 24)
              return res
                .status(400)
                .json({ ok: false, error: "INVALID_TICKET_LABELS" });
            const label = sanitizeText
              ? sanitizeText(untrimmed, { maxLen: 24, stripHtml: true }).trim()
              : untrimmed;
            if (!label) continue;
            const key = label.toLowerCase();
            if (seenLabels.has(key)) continue;
            seenLabels.add(key);
            labels.push(label);
          }
        }

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
        const nextAssigneeId = rawAssigneeId || null;
        const nextPriority = priority;
        const changes = {};
        const updatedMetadata = {};

        if (
          String(ticket.assignedToId || "") !== String(nextAssigneeId || "") ||
          String(ticket.assignedToName || "") !== String(assignedToName || "")
        ) {
          updatedMetadata.assignedToId = nextAssigneeId;
          updatedMetadata.assignedToName = assignedToName;
          changes.assignedTo = assignedToName || null;
        }
        if (String(ticket.priority || "normal") !== nextPriority) {
          updatedMetadata.priority = nextPriority;
          changes.priority = nextPriority;
        }
        if (Number(ticket.slaHours || 0) !== slaHours) {
          updatedMetadata.slaHours = slaHours;
          updatedMetadata.slaDueAt = slaHours
            ? new Date(now.getTime() + slaHours * 60 * 60 * 1000)
            : null;
          changes.slaHours = slaHours;
        }
        if (
          labels !== undefined &&
          JSON.stringify(ticket.labels || []) !== JSON.stringify(labels)
        ) {
          updatedMetadata.labels = labels;
          changes.labels = labels;
        }

        if (Object.keys(updatedMetadata).length) {
          updatedMetadata.metadataUpdatedAt = now;
          updatedMetadata.metadataUpdatedById = String(actor);
          await TicketModel.updateOne(
            { _id: ticketId, guildId },
            {
              $set: updatedMetadata,
              $push: {
                activity: {
                  $each: [
                    createTicketActivityEvent(
                      req,
                      actor,
                      "metadata_updated",
                      changes,
                    ),
                  ],
                  $slice: -100,
                },
              },
            },
          );
        }

        const updatedTicket = await TicketModel.findById(ticketId).lean();
        if (recordAudit && Object.keys(updatedMetadata).length) {
          await recordAudit({
            req,
            action: "ticket.metadata.update",
            guildId,
            targetUserId: ticket.userId,
            actor,
            payload: { ticketId, ...changes },
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
        const activity = Array.isArray(ticket.activity) ? ticket.activity : [];
        activity.forEach((event) => {
          if (!event || !event.action) return;
          items.push({
            action: event.action,
            createdAt: event.createdAt
              ? new Date(event.createdAt).toISOString()
              : null,
            actorId: event.actorId || null,
            actorUsername: event.actorUsername || null,
            details: event.details || null,
          });
        });

        // Open event
        if (ticket.createdAt) {
          items.push({
            action: "opened",
            createdAt: new Date(ticket.createdAt).toISOString(),
            actorId: ticket.userId || null,
            actorUsername: ticket.username || null,
          });
        }

        // Legacy close event (before activity history was added).
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

        const hasRecordedClose = activity.some(
          (event) => event && event.action === "closed",
        );
        if (closedAt && !hasRecordedClose) {
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

  app.get(
    "/api/tickets/:ticketId/transcript",
    requireDashboardAuth,
    canManageTickets,
    guardGuildQueryOptional,
    rateLimit({
      windowMs: 60_000,
      max: 5,
      keyPrefix: "rl:tickets:transcript:",
    }),
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
          req.query.guildId || ticket.guildId || "",
        ).trim();
        if (!guildId || String(ticket.guildId) !== guildId)
          return res.status(400).json({ ok: false, error: "INVALID_GUILD_ID" });
        if (!hasGuildAccess(req, guildId))
          return res.status(403).json({ ok: false, error: "NO_GUILD_ACCESS" });

        const client = _getClient ? _getClient() : null;
        const guild = getGuild(client, guildId);
        if (!guild)
          return res.status(404).json({ ok: false, error: "Guild not found" });
        const channel = ticket.channelId
          ? await resolveChannel(client, guildId, ticket.channelId)
          : null;
        if (!channel || !channel.messages?.fetch)
          return res
            .status(404)
            .json({ ok: false, error: "Ticket thread not accessible" });

        const messages = [];
        const seenIds = new Set();
        let before;
        while (messages.length < TICKET_TRANSCRIPT_MAX_MESSAGES) {
          const limit = Math.min(
            TICKET_TRANSCRIPT_PAGE_SIZE,
            TICKET_TRANSCRIPT_MAX_MESSAGES - messages.length,
          );
          const options = before ? { limit, before } : { limit };
          const batch = await channel.messages.fetch(options);
          const page = Array.from(batch.values());
          if (!page.length) break;

          for (const message of page) {
            if (!message || seenIds.has(String(message.id))) continue;
            seenIds.add(String(message.id));
            messages.push(message);
          }

          const oldest = page.reduce(
            (current, message) =>
              !current ||
              Number(message.createdTimestamp) <
                Number(current.createdTimestamp)
                ? message
                : current,
            null,
          );
          if (
            !oldest ||
            !oldest.id ||
            String(oldest.id) === String(before || "")
          )
            break;
          before = String(oldest.id);
          if (page.length < limit) break;
        }

        messages.sort(
          (a, b) => Number(a.createdTimestamp) - Number(b.createdTimestamp),
        );
        const cleanName = (value) =>
          String(value || "Unknown")
            .replace(/[\r\n\t]+/g, " ")
            .replace(/[\u0000-\u001f\u007f]/g, "")
            .slice(0, 80);
        const cleanContent = (value) =>
          String(value || "").replace(
            /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
            "",
          );
        const lines = [
          `Ticket #${ticket.ticketNumber || String(ticket._id).slice(-6)}`,
          `Server: ${cleanName(guild.name)}`,
          `Member: ${cleanName(ticket.username || ticket.userId)}`,
          `Created: ${ticket.createdAt ? new Date(ticket.createdAt).toISOString() : "Unknown"}`,
          `Messages exported: ${messages.length}`,
          `Export cap: ${TICKET_TRANSCRIPT_MAX_MESSAGES}; older messages may be omitted`,
          "",
        ];

        for (const message of messages) {
          const author = cleanName(
            message.member?.displayName ||
              message.author?.globalName ||
              message.author?.username,
          );
          const timestamp = message.createdAt
            ? new Date(message.createdAt).toISOString()
            : "Unknown time";
          const content = cleanContent(message.cleanContent || message.content);
          lines.push(
            `[${timestamp}] ${author}: ${content || "[no text content]"}`,
          );
          for (const attachment of Array.from(
            message.attachments?.values?.() || [],
          ).slice(0, 10)) {
            if (attachment.url)
              lines.push(
                `  Attachment: ${String(attachment.url).slice(0, 512)}`,
              );
          }
        }

        const ticketNumber = String(ticket.ticketNumber || "ticket").replace(
          /[^a-z0-9_-]/gi,
          "",
        );
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="ticket-${ticketNumber}.txt"`,
        );
        return res.send(lines.join("\n"));
      } catch (err) {
        return sendServerError(
          res,
          "GET /api/tickets/:ticketId/transcript",
          err,
        );
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
        await appendTicketActivity(
          TicketModel,
          ticketId,
          guildId,
          req,
          actor,
          "closed",
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
        await appendTicketActivity(
          TicketModel,
          ticketId,
          guildId,
          req,
          actor,
          "reopened",
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
          await appendTicketActivity(
            TicketModel,
            ticketId,
            guildId,
            req,
            actor,
            "staff_reply",
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
