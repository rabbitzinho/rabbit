// src/systems/maintenance.js

/**
 * Pequeno scheduler de manutenção para:
 * - limpar infrações muito antigas
 * - limpar logs antigos do dashboard
 *
 * Mantém a base de dados mais leve ao longo do tempo.
 */

const Infraction = require("../database/models/Infraction");
let DashboardLog = null;

try {
  DashboardLog = require("../database/models/DashboardLog");
} catch {
  // opcional
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 5 * 60 * 1000;

// Helpers puros (testáveis sem ligação à BD).
function resolveMaintenanceConfig(config) {
  const maintCfg = (config && config.maintenance) || {};
  const intervalRaw = Number(maintCfg.intervalMs ?? DEFAULT_INTERVAL_MS);

  return {
    enabled: maintCfg.enabled !== false,
    infractionDays: Number(maintCfg.pruneInfractionsOlderThanDays ?? 180),
    dashboardLogDays: Number(maintCfg.pruneDashboardLogsOlderThanDays ?? 60),
    intervalMs:
      Number.isFinite(intervalRaw) && intervalRaw >= MIN_INTERVAL_MS
        ? intervalRaw
        : DEFAULT_INTERVAL_MS,
  };
}

function computeCutoff(days, now) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ts = Number.isFinite(now) ? now : Date.now();
  return new Date(ts - n * DAY_MS);
}

function buildPruneFilter(cutoff) {
  return { createdAt: { $lt: cutoff } };
}

async function runOnce(config) {
  const cfg = resolveMaintenanceConfig(config);
  const now = Date.now();

  const infCutoff = computeCutoff(cfg.infractionDays, now);
  if (infCutoff) {
    try {
      const res = await Infraction.deleteMany(buildPruneFilter(infCutoff));
      if (res?.deletedCount) {
        console.log(
          `[Maintenance] Removed ${res.deletedCount} old infractions (older than ${cfg.infractionDays}d).`,
        );
      }
    } catch (err) {
      console.error("[Maintenance] Failed to prune infractions:", err);
    }
  }

  const logCutoff = computeCutoff(cfg.dashboardLogDays, now);
  if (DashboardLog && logCutoff) {
    try {
      const res = await DashboardLog.deleteMany(buildPruneFilter(logCutoff));
      if (res?.deletedCount) {
        console.log(
          `[Maintenance] Removed ${res.deletedCount} old dashboard logs (older than ${cfg.dashboardLogDays}d).`,
        );
      }
    } catch (err) {
      console.error("[Maintenance] Failed to prune dashboard logs:", err);
    }
  }
}

function startMaintenance(config) {
  const cfg = resolveMaintenanceConfig(config);
  if (!cfg.enabled) {
    console.log("[Maintenance] Disabled in config.maintenance.enabled");
    return;
  }

  console.log(
    `[Maintenance] Scheduler running every ${Math.round(cfg.intervalMs / 60000)} minutes.`,
  );

  // run once on startup (without blocking)
  runOnce(config).catch(() => null);

  setInterval(() => {
    runOnce(config).catch(() => null);
  }, cfg.intervalMs).unref?.();
}

module.exports = {
  startMaintenance,
  runOnce,
  resolveMaintenanceConfig,
  computeCutoff,
  buildPruneFilter,
};
