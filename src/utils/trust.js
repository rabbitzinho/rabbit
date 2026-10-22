// src/utils/trust.js

const config = require("../config/defaultConfig");
const { t } = require("../systems/i18n");

function getTrustConfig() {
  const cfg = config.trust || {};

  return {
    // base on/off
    enabled: cfg.enabled !== false,

    // base range
    base: cfg.base ?? 50,
    min: cfg.min ?? 0,
    max: cfg.max ?? 100,

    // penalties
    warnPenalty: cfg.warnPenalty ?? 5,
    mutePenalty: cfg.mutePenalty ?? 15,

    // regen
    regenPerDay: cfg.regenPerDay ?? 1,
    regenMaxDays: cfg.regenMaxDays ?? 30,

    // thresholds
    lowThreshold: cfg.lowThreshold ?? 25,
    highThreshold: cfg.highThreshold ?? 75,

    // dynamic penalties / bonuses
    lowTrustWarningsPenalty: cfg.lowTrustWarningsPenalty ?? 1,
    lowTrustMessagesPenalty: cfg.lowTrustMessagesPenalty ?? 1,
    highTrustMessagesBonus: cfg.highTrustMessagesBonus ?? 0,

    lowTrustMuteMultiplier: cfg.lowTrustMuteMultiplier ?? 1.5,
    highTrustMuteMultiplier: cfg.highTrustMuteMultiplier ?? 0.8,

    // Ajuste adaptativo da automoderação ao Trust médio do servidor (opt-in).
    adaptive: {
      enabled: cfg.adaptive?.enabled === true,
      strictDelta: cfg.adaptive?.strictDelta ?? -1,
      lenientDelta: cfg.adaptive?.lenientDelta ?? 1,
      minSampleSize: cfg.adaptive?.minSampleSize ?? 5,
    },
  };
}

function normalizeTrustOverrides(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const ranges = {
    base: [0, 100],
    min: [0, 100],
    max: [0, 100],
    warnPenalty: [0, 100],
    mutePenalty: [0, 100],
    regenPerDay: [0, 50],
    regenMaxDays: [0, 365],
    lowThreshold: [0, 100],
    highThreshold: [0, 100],
    lowTrustWarningsPenalty: [0, 25],
    lowTrustMessagesPenalty: [0, 25],
    highTrustMessagesBonus: [0, 25],
  };
  const multipliers = ["lowTrustMuteMultiplier", "highTrustMuteMultiplier"];
  const allowed = new Set([
    "enabled",
    ...Object.keys(ranges),
    ...multipliers,
    "adaptive",
  ]);
  const out = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.has(key)) return null;
    if (key === "enabled") {
      if (typeof value !== "boolean") return null;
      out.enabled = value;
    } else if (ranges[key]) {
      const [min, max] = ranges[key];
      if (!Number.isInteger(value) || value < min || value > max) return null;
      out[key] = value;
    } else if (multipliers.includes(key)) {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0.1 ||
        value > 10
      )
        return null;
      out[key] = value;
    } else {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
      const adaptive = {};
      for (const [adaptiveKey, adaptiveValue] of Object.entries(value)) {
        if (adaptiveKey === "enabled") {
          if (typeof adaptiveValue !== "boolean") return null;
        } else if (
          adaptiveKey === "strictDelta" ||
          adaptiveKey === "lenientDelta"
        ) {
          if (
            !Number.isInteger(adaptiveValue) ||
            adaptiveValue < -25 ||
            adaptiveValue > 25
          )
            return null;
        } else if (adaptiveKey === "minSampleSize") {
          if (
            !Number.isInteger(adaptiveValue) ||
            adaptiveValue < 1 ||
            adaptiveValue > 500
          )
            return null;
        } else return null;
        adaptive[adaptiveKey] = adaptiveValue;
      }
      out.adaptive = adaptive;
    }
  }

  if (out.min !== undefined && out.max !== undefined && out.min > out.max)
    return null;
  if (
    out.base !== undefined &&
    ((out.min !== undefined && out.base < out.min) ||
      (out.max !== undefined && out.base > out.max))
  )
    return null;
  if (
    out.lowThreshold !== undefined &&
    out.highThreshold !== undefined &&
    out.lowThreshold >= out.highThreshold
  )
    return null;
  return out;
}

async function getGuildTrustConfig(guildId) {
  const base = getTrustConfig();
  if (!guildId) return base;
  const { getGuildConfig } = require("../systems/guildConfigService");
  const configForGuild = await getGuildConfig(String(guildId));
  const overrides =
    normalizeTrustOverrides(configForGuild && configForGuild.trustOverrides) ||
    {};
  const effective = {
    ...base,
    ...overrides,
    adaptive: { ...base.adaptive, ...(overrides.adaptive || {}) },
  };
  return normalizeTrustOverrides(effective) ? effective : base;
}

function getTrustLabel(trust, trustCfg, langOverride) {
  const cfg = trustCfg || getTrustConfig();
  if (!cfg.enabled) return "N/A";

  const trustValue = Number.isFinite(trust) ? trust : cfg.base;

  if (trustValue <= cfg.lowThreshold)
    return t("log.trustRisk.high", langOverride || null);
  if (trustValue >= cfg.highThreshold)
    return t("log.trustRisk.low", langOverride || null);
  return t("log.trustRisk.medium", langOverride || null);
}

function getEffectiveMaxWithPenalty(
  baseMax,
  trustCfg,
  trustValue,
  options = {},
) {
  const cfg = trustCfg || getTrustConfig();
  if (!cfg.enabled) return baseMax;

  const { penaltyKey, minFloor = 1 } = options;
  const tValue = Number.isFinite(trustValue) ? trustValue : cfg.base;

  let effective = baseMax;

  if (tValue <= cfg.lowThreshold && penaltyKey) {
    const penalty = Number(cfg[penaltyKey] ?? 0);
    if (Number.isFinite(penalty) && penalty > 0) {
      effective = Math.max(minFloor, baseMax - penalty);
    }
  }

  return effective;
}

function getEffectiveMaxWarnings(baseMaxWarnings, trustCfg, trustValue) {
  return getEffectiveMaxWithPenalty(baseMaxWarnings, trustCfg, trustValue, {
    penaltyKey: "lowTrustWarningsPenalty",
    minFloor: 1,
  });
}

function getEffectiveMaxMessages(baseMaxMessages, trustCfg, trustValue) {
  const cfg = trustCfg || getTrustConfig();
  if (!cfg.enabled) return baseMaxMessages;

  const tValue = Number.isFinite(trustValue) ? trustValue : cfg.base;
  let effective = baseMaxMessages;

  if (tValue <= cfg.lowThreshold) {
    const penalty = Number(cfg.lowTrustMessagesPenalty ?? 0);
    if (Number.isFinite(penalty) && penalty > 0) {
      effective = Math.max(1, baseMaxMessages - penalty);
    }
  } else if (tValue >= cfg.highThreshold) {
    const bonus = Number(cfg.highTrustMessagesBonus ?? 0);
    if (Number.isFinite(bonus) && bonus > 0) {
      effective = effective + bonus;
    }
  }

  return effective;
}

function getEffectiveMuteDuration(baseMs, trustCfg, trustValue) {
  const cfg = trustCfg || getTrustConfig();
  if (!cfg.enabled) return baseMs;

  const tValue = Number.isFinite(trustValue) ? trustValue : cfg.base;
  let duration = baseMs;

  if (tValue <= cfg.lowThreshold) {
    duration = Math.round(baseMs * cfg.lowTrustMuteMultiplier);
  } else if (tValue >= cfg.highThreshold) {
    duration = Math.round(baseMs * cfg.highTrustMuteMultiplier);
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  const MIN_MS = 30 * 1000;
  const MAX_MS = 28 * DAY_MS;

  if (!Number.isFinite(duration) || duration < MIN_MS) duration = MIN_MS;
  if (duration > MAX_MS) duration = MAX_MS;

  return duration;
}

/**
 * Calcula o ajuste adaptativo da automoderação a partir do Trust médio do
 * servidor. Regra (opt-in via `trust.adaptive.enabled`):
 *  - média <= lowThreshold  => servidor "problemático"  => mais rígido (strictDelta)
 *  - média >= highThreshold => servidor "saudável"      => mais tolerante (lenientDelta)
 *  - caso contrário          => neutro (sem ajuste)
 * Amostras pequenas (abaixo de `minSampleSize`) nunca ajustam, para evitar
 * reagir ao Trust de meia dúzia de membros.
 *
 * @param {object} [trustCfg]
 * @param {{ avgTrust?: number, sampleSize?: number }} [stats]
 * @returns {{ applied: boolean, level: string, delta: number }}
 */
function getAdaptiveAutomodAdjustment(trustCfg, stats = {}) {
  const cfg = trustCfg || getTrustConfig();
  const adaptive = cfg.adaptive || {};

  if (!cfg.enabled || adaptive.enabled !== true) {
    return { applied: false, level: "off", delta: 0 };
  }

  const minSampleSize = Number.isFinite(Number(adaptive.minSampleSize))
    ? Number(adaptive.minSampleSize)
    : 5;

  // `Number(null)` seria 0 (finito), o que faria uma amostra vazia parecer
  // "Trust médio = 0"; por isso validamos o tipo antes de converter.
  const avgTrust =
    typeof stats.avgTrust === "number" && Number.isFinite(stats.avgTrust)
      ? stats.avgTrust
      : NaN;
  const sampleSize =
    typeof stats.sampleSize === "number" && Number.isFinite(stats.sampleSize)
      ? stats.sampleSize
      : NaN;

  if (
    !Number.isFinite(avgTrust) ||
    !Number.isFinite(sampleSize) ||
    sampleSize < minSampleSize
  ) {
    return { applied: false, level: "insufficient", delta: 0 };
  }

  const strictDelta = Number.isFinite(Number(adaptive.strictDelta))
    ? Number(adaptive.strictDelta)
    : -1;
  const lenientDelta = Number.isFinite(Number(adaptive.lenientDelta))
    ? Number(adaptive.lenientDelta)
    : 1;

  if (avgTrust <= cfg.lowThreshold)
    return { applied: true, level: "strict", delta: strictDelta };
  if (avgTrust >= cfg.highThreshold)
    return { applied: true, level: "lenient", delta: lenientDelta };
  return { applied: false, level: "neutral", delta: 0 };
}

/**
 * Aplica o ajuste adaptativo ao limite de warns antes do mute automático.
 * @param {number} baseMaxWarnings - valor já ajustado pelo Trust do utilizador
 * @param {object} [trustCfg]
 * @param {{ avgTrust?: number, sampleSize?: number }} [stats]
 * @returns {{ maxWarnings: number, applied: boolean, level: string, delta: number }}
 */
function getAdaptiveMaxWarnings(baseMaxWarnings, trustCfg, stats) {
  const base = Number.isFinite(Number(baseMaxWarnings))
    ? Number(baseMaxWarnings)
    : 0;
  const adj = getAdaptiveAutomodAdjustment(trustCfg, stats);

  return {
    maxWarnings: Math.max(1, base + (adj.delta || 0)),
    applied: adj.applied,
    level: adj.level,
    delta: adj.delta,
  };
}

module.exports = {
  getTrustConfig,
  getGuildTrustConfig,
  normalizeTrustOverrides,
  getTrustLabel,
  getEffectiveMaxWarnings,
  getEffectiveMaxMessages,
  getEffectiveMuteDuration,
  getAdaptiveAutomodAdjustment,
  getAdaptiveMaxWarnings,
};
