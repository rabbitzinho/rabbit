// src/dashboard/audit.js
//
// Helpers de auditoria da dashboard: extração do ator a partir do pedido e
// registo em Mongo. Extraído de src/dashboard.js.

const { safeAuditPayload } = require("./sanitize");

/**
 * Resolve o ator de uma ação a partir do pedido (JWT > body > header), truncado a 64 chars.
 */
function getActorFromRequest(req) {
  if (!req) return null;
  const headerActor =
    (req.headers &&
      (req.headers["x-dashboard-actor"] || req.headers["X-Dashboard-Actor"])) ||
    null;
  const bodyActor = req.body && req.body.actor;
  const jwtActor = req.dashboardUser && req.dashboardUser.username;
  const raw = (jwtActor || bodyActor || headerActor || "").toString().trim();
  if (!raw) return null;
  return raw.length > 64 ? raw.slice(0, 64) : raw;
}

/**
 * Fábrica do registador de auditoria. Recebe uma função que devolve o modelo
 * DashboardAudit (ou null) para permitir testes sem Mongo.
 */
function createAuditRecorder({ getModel }) {
  return async function recordAudit({
    req,
    action,
    guildId,
    targetUserId,
    actor,
    payload,
  }) {
    const DashboardAudit = typeof getModel === "function" ? getModel() : null;
    if (!DashboardAudit) return;
    try {
      const ip = req?.ip || req?.connection?.remoteAddress || null;
      const ua = req?.headers?.["user-agent"] || null;

      await DashboardAudit.create({
        route: req?.path || req?.originalUrl || "unknown",
        method: req?.method || "UNKNOWN",
        actor: actor || null,
        action: action || null,
        guildId: guildId || null,
        targetUserId: targetUserId || null,
        ip,
        userAgent: ua,
        payload: safeAuditPayload(payload || null),
      });
    } catch (err) {
      console.error("[Dashboard] Failed to record audit log:", err);
    }
  };
}

module.exports = { getActorFromRequest, createAuditRecorder };
