// src/dashboard/routes/audit.js

const { sendServerError } = require("./_errors");
const { escapeRegex } = require("../../utils/regex");

function registerAuditRoutes({
  app,
  requireDashboardAuth,
  requirePerm,
  requireGuildAccess,
  sanitizeId,
  DashboardAudit,
}) {
  const guardGuildQuery =
    typeof requireGuildAccess === "function"
      ? requireGuildAccess({ from: "query", key: "guildId", optional: true })
      : (req, res, next) => next();

  const canViewConfig =
    typeof requirePerm === "function"
      ? requirePerm({ anyOf: ["canViewConfig", "canEditConfig"] })
      : (req, res, next) => next();

  // Lista das ações registadas na dashboard (auditoria), com filtros.
  app.get(
    "/api/audit",
    requireDashboardAuth,
    canViewConfig,
    guardGuildQuery,
    async (req, res) => {
      try {
        if (!DashboardAudit) {
          return res.json({
            ok: true,
            page: 1,
            limit: 25,
            total: 0,
            items: [],
            actions: [],
          });
        }

        const page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
        const limitRaw = parseInt(req.query.limit || "25", 10);
        const limit = Math.min(
          Math.max(Number.isFinite(limitRaw) ? limitRaw : 25, 1),
          100,
        );

        const requestedGuildId = sanitizeId(
          (req.query.guildId || "").toString().trim(),
        );
        const selectedGuildId = sanitizeId(
          (req.dashboardUser && req.dashboardUser.selectedGuildId) || "",
        );
        if (requestedGuildId && requestedGuildId !== selectedGuildId) {
          return res.status(403).json({ ok: false, error: "NO_GUILD_ACCESS" });
        }
        const guildId = requestedGuildId || selectedGuildId;
        if (!guildId) {
          return res
            .status(403)
            .json({ ok: false, error: "NO_GUILD_SELECTED" });
        }
        const action = (req.query.action || "").toString().trim();
        const search = (req.query.search || "").toString().trim();

        const query = {};
        if (guildId) query.guildId = guildId;
        if (action) query.action = action;

        if (search) {
          const rx = new RegExp(escapeRegex(search), "i");
          query.$or = [
            { actor: rx },
            { action: rx },
            { route: rx },
            { targetUserId: rx },
          ];
        }

        const total = await DashboardAudit.countDocuments(query);
        const items = await DashboardAudit.find(query)
          .sort({ at: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean();

        // Lista de ações distintas (para o filtro), apenas no primeiro pedido.
        let actions = [];
        if (page === 1) {
          const distinctQuery = { guildId };
          actions = (await DashboardAudit.distinct("action", distinctQuery))
            .filter((a) => typeof a === "string" && a)
            .sort();
        }

        return res.json({ ok: true, page, limit, total, items, actions });
      } catch (err) {
        return sendServerError(res, "/api/audit", err);
      }
    },
  );
}

module.exports = { registerAuditRoutes };
