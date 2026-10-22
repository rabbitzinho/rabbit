// src/systems/configManager.js

const fs = require("fs");
const path = require("path");
const config = require("../config/defaultConfig");

function isPlainObject(v) {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function deepGet(obj, pathStr) {
  const parts = String(pathStr || "")
    .split(".")
    .filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (!isPlainObject(cur) && !Array.isArray(cur)) return undefined;
    cur = cur[p];
    if (cur === undefined) return undefined;
  }
  return cur;
}

function deepSet(obj, pathStr, value) {
  const parts = String(pathStr || "")
    .split(".")
    .filter(Boolean);
  if (!parts.length) return;

  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!isPlainObject(cur[p])) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function deepDelete(obj, pathStr) {
  const parts = String(pathStr || "")
    .split(".")
    .filter(Boolean);
  if (!parts.length) return;

  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!isPlainObject(cur[p])) return;
    cur = cur[p];
  }

  const last = parts[parts.length - 1];
  if (isPlainObject(cur) && Object.prototype.hasOwnProperty.call(cur, last)) {
    delete cur[last];
  }
}

function cloneJsonSafe(v) {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return null;
  }
}

// ✅ Only allow safe runtime edits here.
// DO NOT include role IDs, channel IDs, feeds, staffRoles, guildId, TOKEN, etc.
const ALLOWED_PATHS = new Set([
  "language",
  "notifications.dmOnWarn",
  "notifications.dmOnMute",
  "maxWarnings",
  "muteDuration",

  "antiSpam.enabled",
  "antiSpam.interval",
  "antiSpam.maxMessages",
  "antiSpam.muteDuration",
  "antiSpam.actionCooldown",
  "antiSpam.bypassAdmins",
  "antiSpam.sendMessage",
  "antiSpam.minLength",
  "antiSpam.ignoreAttachments",
  "antiSpam.similarityThreshold",

  "dashboard.maxLogs",
  "dashboard.maxDbLogs",

  "gameNews.enabled",
  "gameNews.logEnabled",
  "gameNews.interval",
  "gameNews.maxPerCycle",
  "gameNews.keepHashes",
  "gameNews.maxAgeDays",
  "gameNews.jitterMs",
  "gameNews.perFeedJitterMs",
  "gameNews.retry.attempts",
  "gameNews.retry.baseDelayMs",
  "gameNews.retry.jitterMs",
  "gameNews.backoff.maxFails",
  "gameNews.backoff.pauseMs",

  "tickets.autoDeleteClosed.enabled",
  "tickets.autoDeleteClosed.delayMs",
  "globalMaintenance.enabled",
  "globalMaintenance.message",
  "globalMaintenance.allowStaff",

  "automation.enabled",
  "automation.autoMute.enabled",
  "automation.autoMute.warnsToMute",
  "automation.autoMute.muteDurationMs",

  "slash.enabled",
  "slash.registerOnStartup",
]);

function validateValue(pathStr, value) {
  // Stronger validation (still permissive enough to avoid regressions).
  // Goal: prevent obviously invalid configs (negative durations, NaN, extreme values).

  const isFiniteNumber = (n) => typeof n === "number" && Number.isFinite(n);
  const isInt = (n) => isFiniteNumber(n) && Number.isInteger(n);
  const inRange = (n, min, max) => isFiniteNumber(n) && n >= min && n <= max;
  const inRangeInt = (n, min, max) => isInt(n) && n >= min && n <= max;

  if (pathStr === "language") {
    return value === "pt" || value === "en";
  }

  if (pathStr === "globalMaintenance.message") {
    return typeof value === "string" && value.trim().length <= 180;
  }

  // booleans
  const boolPaths = new Set([
    "notifications.dmOnWarn",
    "notifications.dmOnMute",
    "trust.enabled",
    "antiSpam.enabled",
    "antiSpam.softActions.enabled",
    "antiSpam.bypassAdmins",
    "antiSpam.sendMessage",
    "antiSpam.ignoreAttachments",
    "gameNews.enabled",
    "gameNews.logEnabled",
    "tickets.autoDeleteClosed.enabled",
    "globalMaintenance.enabled",
    "globalMaintenance.allowStaff",
    "automation.enabled",
    "automation.autoMute.enabled",
    "slash.enabled",
    "slash.registerOnStartup",
  ]);
  if (boolPaths.has(pathStr)) return typeof value === "boolean";

  // Per-path numeric constraints
  switch (pathStr) {
    case "maxWarnings":
      return inRangeInt(value, 0, 50);
    case "muteDuration":
      // ms: 0..30 days
      return inRangeInt(value, 0, 30 * 24 * 60 * 60 * 1000);

    // Trust core
    case "trust.base":
    case "trust.min":
    case "trust.max":
    case "trust.lowThreshold":
    case "trust.highThreshold":
      return inRangeInt(value, 0, 100);

    case "trust.warnPenalty":
    case "trust.mutePenalty":
      return inRangeInt(value, 0, 100);

    case "trust.regenPerDay":
      return inRangeInt(value, 0, 50);
    case "trust.regenMaxDays":
      return inRangeInt(value, 0, 365);

    case "trust.lowTrustWarningsPenalty":
    case "trust.lowTrustMessagesPenalty":
    case "trust.highTrustMessagesBonus":
      return inRangeInt(value, 0, 25);

    case "trust.lowTrustMuteMultiplier":
    case "trust.highTrustMuteMultiplier":
      return inRange(value, 0.1, 10);

    // Anti-spam
    case "antiSpam.interval":
    case "antiSpam.muteDuration":
    case "antiSpam.actionCooldown":
      // ms: 0..24h
      return inRangeInt(value, 0, 24 * 60 * 60 * 1000);

    case "antiSpam.softActions.strikeWindowMs":
      return inRangeInt(value, 0, 24 * 60 * 60 * 1000);
    case "antiSpam.softActions.strikesToMute":
      return inRangeInt(value, 1, 10);

    case "antiSpam.maxMessages":
      return inRangeInt(value, 1, 100);

    case "antiSpam.minLength":
      return inRangeInt(value, 0, 500);

    case "antiSpam.similarityThreshold":
      return inRange(value, 0, 1);

    // Dashboard
    case "dashboard.maxLogs":
      return inRangeInt(value, 10, 2000);
    case "dashboard.maxDbLogs":
      return inRangeInt(value, 50, 20000);

    // GameNews
    case "gameNews.interval":
    case "gameNews.maxPerCycle":
      return inRangeInt(value, 1, 10);

    case "gameNews.jitterMs":
    case "gameNews.perFeedJitterMs":
      return inRangeInt(value, 0, 24 * 60 * 60 * 1000);

    case "gameNews.keepHashes":
      return inRangeInt(value, 1, 200);

    case "gameNews.maxAgeDays":
      return inRangeInt(value, 1, 365);

    case "gameNews.retry.attempts":
      return inRangeInt(value, 0, 10);

    case "gameNews.retry.baseDelayMs":
    case "gameNews.retry.jitterMs":
      return inRangeInt(value, 0, 60 * 1000);

    case "gameNews.backoff.maxFails":
      return inRangeInt(value, 0, 20);

    case "gameNews.backoff.pauseMs":
      return inRangeInt(value, 0, 7 * 24 * 60 * 60 * 1000);

    // Tickets
    case "tickets.autoDeleteClosed.delayMs":
      return inRangeInt(value, 0, 365 * 24 * 60 * 60 * 1000);

    // Automation
    case "automation.autoMute.warnsToMute":
      return inRangeInt(value, 1, 50);
    case "automation.autoMute.muteDurationMs":
      return inRangeInt(value, 0, 30 * 24 * 60 * 60 * 1000);

    default:
      // Generic numeric fields
      return isFiniteNumber(value);
  }
}

function flattenPatch(obj, prefix = "", out = {}) {
  if (!isPlainObject(obj)) return out;

  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v)) {
      flattenPatch(v, key, out);
    } else {
      out[key] = v;
    }
  }
  return out;
}

const overridesPath = path.join(__dirname, "../config/overrides.json");

// Allow setting `null` to clear an override (fallback to default behavior).
const NULLABLE_PATHS = new Set([
  "gameNews.maxPerCycle",
  "globalMaintenance.message",
]);

function readOverrides() {
  try {
    if (!fs.existsSync(overridesPath)) return {};
    const raw = fs.readFileSync(overridesPath, "utf8");
    const o = JSON.parse(raw);
    return isPlainObject(o) ? o : {};
  } catch {
    return {};
  }
}

function writeOverrides(obj) {
  fs.writeFileSync(overridesPath, JSON.stringify(obj, null, 2), "utf8");
}

function getPublicConfig() {
  // Return config but hide potentially sensitive stuff.
  const cloned = cloneJsonSafe(config) || {};

  // Remove sensitive-ish fields even if present.
  delete cloned.staffRoles;
  delete cloned.bannedWords;

  // GameNews feeds contain channel IDs
  if (cloned.gameNews) delete cloned.gameNews.sources;

  // Slash guildId is also sensitive
  if (cloned.slash) delete cloned.slash.guildId;

  // AntiSpam overrides can contain channel IDs / bypassRoles
  if (cloned.antiSpam) {
    delete cloned.antiSpam.channels;
    delete cloned.antiSpam.bypassRoles;
  }

  return cloned;
}

function getEditableSchema() {
  // Simple schema for UI rendering.
  // You can expand this later (min/max, steps, etc.)
  return {
    allowedPaths: Array.from(ALLOWED_PATHS),
  };
}

function applyPatch(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, error: "Patch must be an object." };
  }

  const overrides = readOverrides();
  const applied = [];
  const rejected = [];

  // Accept either:
  //  - { patches: [{ path, value }, ...] }
  //  - a plain object (will be flattened)
  let patchList = [];
  if (Array.isArray(payload.patches)) {
    patchList = payload.patches
      .filter((p) => p && typeof p.path === "string")
      .map((p) => ({ path: String(p.path), value: p.value }));
  } else {
    const flat = flattenPatch(payload);
    patchList = Object.entries(flat).map(([path, value]) => ({ path, value }));
  }

  for (const p of patchList) {
    const pathStr = p.path;
    const value = p.value;

    if (!ALLOWED_PATHS.has(pathStr)) {
      rejected.push({ path: pathStr });
      continue;
    }

    // Support null as "clear override" for explicitly nullable paths
    if (value === null) {
      if (!NULLABLE_PATHS.has(pathStr)) {
        rejected.push({ path: pathStr });
        continue;
      }
      deepDelete(overrides, pathStr);
      deepDelete(config, pathStr);
      applied.push(pathStr);
      continue;
    }

    if (!validateValue(pathStr, value)) {
      rejected.push({ path: pathStr });
      continue;
    }

    deepSet(overrides, pathStr, value);
    deepSet(config, pathStr, value);
    applied.push(pathStr);
  }

  try {
    writeOverrides(overrides);
  } catch (e) {
    return { ok: false, error: e?.message || "Failed writing overrides." };
  }

  return {
    ok: true,
    applied,
    rejected,
    config: getPublicConfig(),
  };
}

function getValue(pathStr) {
  if (!ALLOWED_PATHS.has(pathStr)) return undefined;
  return deepGet(config, pathStr);
}

module.exports = {
  getPublicConfig,
  getEditableSchema,
  applyPatch,
  getValue,
};
