// src/dashboard/routes/users.js

const { sendServerError } = require("./_errors");
const rateLimit = require("../../systems/rateLimit");
const { getGuild } = require("../../services/guildService");

/**
 * Users routes (Dashboard -> Users tab)
 *
 * Discord cache is used by default (fast, avoids gateway spam).
 * Full member sync is opt-in (sync=1) and guarded.
 */
function registerUsersRoutes({
  app,
  requireDashboardAuth,
  requireGuildAccess,
  requirePerm,
  getClient,
  sanitizeId,
  guildMembersLastFetch,
  infractionsService,
  TicketLogModel,
}) {
  const guardGuildParam =
    typeof requireGuildAccess === "function"
      ? requireGuildAccess({ from: "params", key: "guildId" })
      : (req, res, next) => next();

  const canViewUsers =
    typeof requirePerm === "function"
      ? requirePerm({
          anyOf: ["canManageUsers", "canViewLogs", "canActOnCases"],
        })
      : (req, res, next) => next();
  function mapMemberRoles(member, guild) {
    try {
      // Hide @everyone (same id as guild) and managed/integration roles.
      return (
        member?.roles?.cache
          ?.filter((r) => r && r.id !== guild.id && !r.managed)
          .map((r) => ({ id: r.id, name: r.name })) || []
      );
    } catch {
      return [];
    }
  }

  // Resumo público de um membro, partilhado pela listagem e pelo export.
  function mapMemberSummary(member, guild) {
    return {
      id: member.id,
      username: member.user?.username || null,
      discriminator: member.user?.discriminator || null,
      tag: member.user?.tag || null,
      bot: !!member.user?.bot,
      joinedAt: member.joinedAt || null,
      roles: mapMemberRoles(member, guild),
    };
  }

  // Comparador de membros segundo a chave de ordenação pedida.
  // Por omissão: nome. "joined" = entrada mais recente primeiro; "id" = ID.
  function makeComparator(sortKey) {
    return (a, b) => {
      if (sortKey === "joined") {
        const aj = a.joinedAt ? new Date(a.joinedAt).getTime() : 0;
        const bj = b.joinedAt ? new Date(b.joinedAt).getTime() : 0;
        return (
          bj - aj ||
          String(a.username || a.tag || "").localeCompare(
            String(b.username || b.tag || ""),
          )
        );
      }
      if (sortKey === "id") {
        return String(a.id).localeCompare(String(b.id), undefined, {
          numeric: true,
        });
      }
      const an = (a.username || a.tag || "").toLowerCase();
      const bn = (b.username || b.tag || "").toLowerCase();
      return an.localeCompare(bn) || String(a.id).localeCompare(String(b.id));
    };
  }

  // Guild members (for Users tab) - paginated + optional search
  app.get(
    "/api/guilds/:guildId/users",
    requireDashboardAuth,
    canViewUsers,
    guardGuildParam,
    rateLimit({ windowMs: 60_000, max: 120, keyPrefix: "rl:users:list:" }),
    async (req, res) => {
      try {
        const _client = getClient();
        if (!_client)
          return res.json({
            ok: true,
            page: 1,
            limit: 50,
            total: 0,
            items: [],
          });

        const guildId = sanitizeId(req.params.guildId);
        if (!guildId)
          return res
            .status(400)
            .json({ ok: false, error: "guildId is required" });

        const guild = getGuild(_client, guildId);
        if (!guild)
          return res.status(404).json({ ok: false, error: "Guild not found" });

        const page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
        const limitRaw = parseInt(req.query.limit || "50", 10);
        const limit = Math.min(
          Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 10),
          200,
        );

        const search = (req.query.search || "").toString().trim();
        const sync = String(req.query.sync || "") === "1";
        // Por omissão a tab de Utilizadores mostra apenas pessoas; os bots podem
        // ser incluídos explicitamente (usersIncludeBots no dashboard).
        const includeBots = ["1", "true", "yes"].includes(
          String(req.query.includeBots || "").toLowerCase(),
        );

        // Ordenação. Por omissão: nome (comportamento anterior). "joined" = data de
        // entrada (mais recentes primeiro); "id" = ID.
        const sortKey = (req.query.sort || "").toString().trim().toLowerCase();
        const compareItems = makeComparator(sortKey);

        // Sync mode (explicit): full fetch, but guarded to avoid gateway spam.
        // If within cooldown, skip the fetch but still return cached results (avoid 429 UX).
        const now = Date.now();
        const last = guildMembersLastFetch.get(guildId) || 0;
        const canSync = now - last >= 2 * 60 * 1000;

        if (sync && canSync) {
          try {
            await guild.members.fetch();
            guildMembersLastFetch.set(guildId, Date.now());
          } catch (e) {
            console.warn(
              "[Dashboard] Failed to sync member list for guild",
              guildId,
              e,
            );
          }
        }

        // Auto-warm cache once if empty and the user did not request search.
        // This prevents "no users until I press Sync" for large guilds.
        if (!sync && !search && guild.members.cache.size === 0 && canSync) {
          try {
            await guild.members.fetch();
            guildMembersLastFetch.set(guildId, Date.now());
          } catch (e) {
            console.warn(
              "[Dashboard] Failed to warm member cache for guild",
              guildId,
              e,
            );
          }
        }

        // Search mode: use Discord query fetch when possible (faster than full list)
        if (search) {
          let items = [];
          const q = search.toLowerCase();

          try {
            const coll = await guild.members.fetch({
              query: search,
              limit: Math.min(limit, 100),
            });
            items = coll.map((m) => mapMemberSummary(m, guild));
          } catch {
            // Fallback to cache search
            items = guild.members.cache
              .filter((m) => {
                const tag = (m.user?.tag || "").toLowerCase();
                const username = (m.user?.username || "").toLowerCase();
                const id = (m.id || "").toLowerCase();
                return (
                  tag.includes(q) || username.includes(q) || id.includes(q)
                );
              })
              .map((m) => mapMemberSummary(m, guild));
          }

          items.sort(compareItems);

          if (!includeBots) items = items.filter((it) => !it.bot);

          const total = items.length;
          const start = (page - 1) * limit;
          const end = start + limit;
          return res.json({
            ok: true,
            page,
            limit,
            total,
            items: items.slice(start, end),
          });
        }

        // Default listing: cache-based + paginated
        let items = guild.members.cache
          .filter((m) => includeBots || !m.user?.bot)
          .map((m) => mapMemberSummary(m, guild));

        items.sort(compareItems);

        const total = items.length;
        const start = (page - 1) * limit;
        const end = start + limit;
        return res.json({
          ok: true,
          page,
          limit,
          total,
          items: items.slice(start, end),
        });
      } catch (err) {
        return sendServerError(res, "/api/guilds/:guildId/users", err);
      }
    },
  );

  // Export guild members (CSV or JSON) with the same filters as the list.
  app.get(
    "/api/guilds/:guildId/users/export",
    requireDashboardAuth,
    canViewUsers,
    guardGuildParam,
    rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "rl:users:export:" }),
    async (req, res) => {
      try {
        const _client = getClient();
        const guildId = sanitizeId(req.params.guildId);
        if (!guildId)
          return res
            .status(400)
            .json({ ok: false, error: "guildId is required" });
        if (!_client)
          return res
            .status(503)
            .json({ ok: false, error: "Discord client not ready" });

        const guild = getGuild(_client, guildId);
        if (!guild)
          return res.status(404).json({ ok: false, error: "Guild not found" });

        const search = (req.query.search || "").toString().trim().toLowerCase();
        const includeBots = ["1", "true", "yes"].includes(
          String(req.query.includeBots || "").toLowerCase(),
        );
        const sortKey = (req.query.sort || "").toString().trim().toLowerCase();
        const format =
          (req.query.format || "csv").toString().trim().toLowerCase() === "json"
            ? "json"
            : "csv";

        // Aquece a cache se estiver vazia (respeitando o cooldown).
        const now = Date.now();
        const last = guildMembersLastFetch.get(guildId) || 0;
        if (guild.members.cache.size === 0 && now - last >= 2 * 60 * 1000) {
          try {
            await guild.members.fetch();
            guildMembersLastFetch.set(guildId, Date.now());
          } catch (e) {
            console.warn(
              "[Dashboard] Failed to warm member cache for export",
              guildId,
              e,
            );
          }
        }

        let items = guild.members.cache
          .filter((m) => includeBots || !m.user?.bot)
          .map((m) => mapMemberSummary(m, guild));

        if (search) {
          items = items.filter((it) => {
            const tag = (it.tag || "").toLowerCase();
            const username = (it.username || "").toLowerCase();
            return (
              tag.includes(search) ||
              username.includes(search) ||
              String(it.id).includes(search)
            );
          });
        }

        items.sort(makeComparator(sortKey));

        const MAX_EXPORT = 10000;
        const truncated = items.length > MAX_EXPORT;
        if (truncated) items = items.slice(0, MAX_EXPORT);

        const stamp = new Date().toISOString().slice(0, 10);
        if (format === "json") {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="users-${guildId}-${stamp}.json"`,
          );
          return res.send(
            JSON.stringify(
              { ok: true, guildId, total: items.length, truncated, items },
              null,
              2,
            ),
          );
        }

        const csvCell = (v) =>
          '"' +
          String(v == null ? "" : v)
            .replace(/"/g, '""')
            .replace(/\r?\n/g, " ") +
          '"';
        const lines = ["id,username,tag,bot,joinedAt,roles"];
        for (const it of items) {
          const roles = (it.roles || []).map((r) => r.name).join("; ");
          lines.push(
            [
              csvCell(it.id),
              csvCell(it.username || ""),
              csvCell(it.tag || ""),
              csvCell(it.bot ? "true" : "false"),
              csvCell(it.joinedAt ? new Date(it.joinedAt).toISOString() : ""),
              csvCell(roles),
            ].join(","),
          );
        }

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="users-${guildId}-${stamp}.csv"`,
        );
        return res.send(lines.join("\n"));
      } catch (err) {
        return sendServerError(res, "/api/guilds/:guildId/users/export", err);
      }
    },
  );

  // User history (infractions + tickets)
  app.get(
    "/api/guilds/:guildId/users/:userId/history",
    requireDashboardAuth,
    canViewUsers,
    guardGuildParam,
    async (req, res) => {
      try {
        const guildId = sanitizeId(req.params.guildId);
        const userId = sanitizeId(req.params.userId);
        if (!guildId || !userId) {
          return res
            .status(400)
            .json({ ok: false, error: "guildId and userId are required" });
        }

        if (!infractionsService) {
          return res
            .status(503)
            .json({ ok: false, error: "Infractions service not available" });
        }

        const [infractions, counts, ticketDocs] = await Promise.all([
          infractionsService.getRecentInfractions(guildId, userId, 10),
          infractionsService.countInfractionsByType(guildId, userId),
          TicketLogModel
            ? TicketLogModel.find({ guildId, userId })
                .sort({ createdAt: -1 })
                .limit(10)
                .lean()
            : Promise.resolve([]),
        ]);

        const tickets = (ticketDocs || []).map((t) => ({
          ticketNumber: t.ticketNumber,
          createdAt: t.createdAt || null,
          closedAt: t.closedAt || null,
        }));

        return res.json({
          ok: true,
          infractions: infractions || [],
          counts: counts || {},
          tickets,
        });
      } catch (err) {
        return sendServerError(
          res,
          "/api/guilds/:guildId/users/:userId/history",
          err,
        );
      }
    },
  );
}

module.exports = { registerUsersRoutes };
