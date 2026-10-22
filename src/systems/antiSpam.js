// src/systems/antiSpam.js
//
// Simple anti-spam system with per-user sliding window and trust-aware thresholds.
// This replaces a previous truncated implementation that used similar concepts
// (interval, maxMessages, softActions, trust integration, etc.).

const { PermissionsBitField } = require("discord.js");

const infractionsService = require("./infractionsService");
const logger = require("./logger");
const warningsService = require("./warningsService");
const { tContext } = require("./i18n");
const { fetchMember } = require("../services/discordFetchCache");
const {
  getGuildTrustConfig,
  getEffectiveMaxMessages,
  getEffectiveMuteDuration,
} = require("../utils/trust");
const { incrementAntiSpamActions } = require("./status");
const { getFeature } = require("./featuresService");

function resolveGuildAntiSpamConfig(featureConfig) {
  const feature = featureConfig || {};
  return {
    enabled: feature.enabled === true,
    interval: Number(feature.intervalSeconds ?? 10) * 1000,
    maxMessages: Number(feature.maxMessages ?? 5),
    muteDuration: Number(feature.muteDurationMinutes ?? 5) * 60_000,
    actionCooldown: Number(feature.actionCooldownSeconds ?? 120) * 1000,
    minLength: Number(feature.minLength ?? 6),
    similarityThreshold: Number(feature.similarityThreshold ?? 0.85),
    ignoreAttachments: feature.ignoreAttachments !== false,
    bypassAdmins: feature.bypassAdmins !== false,
    bypassRoles: [],
    channels: {},
    sendMessage: feature.sendMessage !== false,
    softActions: {
      enabled: feature.softActionsEnabled === true,
      strikeWindowMs: Number(feature.strikeWindowSeconds ?? 600) * 1000,
      strikesToMute: Number(feature.strikesToMute ?? 2),
    },
  };
}

async function getGuildAntiSpamConfig(guildId) {
  const featureConfig = await getFeature(guildId, "antiSpam").catch(() => null);
  return resolveGuildAntiSpamConfig(featureConfig);
}

// In-memory tracking: guildId+userId -> state
// state = { entries: [{ ts, norm }], lastActionAt, strikes, lastStrikeAt }
const messageMap = new Map();

// Safety limits
const CLEANUP_INTERVAL_MS = 60 * 1000;
const MAX_HISTORY_PER_USER = 20;
const MAX_TEXT_LENGTH = 300;
const MAX_LEVENSHTEIN_LENGTH = 200;

// Schedule cleanup to avoid memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, state] of messageMap.entries()) {
    const entries = Array.isArray(state.entries) ? state.entries : [];
    const last = entries.length ? entries[entries.length - 1].ts : 0;
    if (!last || now - last > 5 * 60 * 1000) {
      messageMap.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS).unref?.();

// Normaliza texto para comparação de similaridade
function normalizeTextForSimilarity(text) {
  if (!text) return "";
  let s = text.toString().slice(0, MAX_TEXT_LENGTH);

  s = s
    // remover emojis custom
    .replace(/<a?:\w+:\d+>/g, " ")
    // remover links
    .replace(/https?:\/\/\S+/g, " ")
    // remover menções / hashtags
    .replace(/[@#]\S+/g, " ")
    // remover markdown / caracteres repetidos
    .replace(/[`_*|~>-]+/g, " ")
    // resto de pontuação
    .replace(/[^\w\s]/g, " ")
    // espaços múltiplos
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (s.length > MAX_LEVENSHTEIN_LENGTH) {
    s = s.slice(0, MAX_LEVENSHTEIN_LENGTH);
  }
  return s;
}

// Levenshtein distance (para similaridade fuzzy)
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const m = a.length;
  const n = b.length;

  // DP em matriz 1D (otimização simples)
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cb = b.charCodeAt(j - 1);
      const cost = ca === cb ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) {
      prev[j] = curr[j];
    }
  }

  return prev[n];
}

function similarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length) || 1;
  return 1 - dist / maxLen;
}

function getUserKey(message) {
  const g = message.guild;
  const u = message.author;
  if (!g || !u) return null;
  return `${g.id}:${u.id}`;
}

async function antiSpam(message, client) {
  try {
    if (!message.guild) return;
    if (!message.author || message.author.bot) return;

    const antiCfg = await getGuildAntiSpamConfig(message.guild.id);
    if (antiCfg.enabled === false) return;

    const key = getUserKey(message);
    if (!key) return;

    const guild = message.guild;

    // Resolver membro
    const member =
      message.member || (await fetchMember(guild, message.author.id));
    if (!member) return;

    // Bypass admins / bypass roles
    if (
      antiCfg.bypassAdmins !== false &&
      member.permissions.has(PermissionsBitField.Flags.Administrator)
    ) {
      return;
    }
    const bypassRoles = Array.isArray(antiCfg.bypassRoles)
      ? antiCfg.bypassRoles
      : [];
    if (bypassRoles.length && member.roles.cache.hasAny(...bypassRoles)) {
      return;
    }

    // Config base + override por canal
    const baseCfg = antiCfg;
    const channelOverride = baseCfg.channels?.[message.channel.id] || null;

    const intervalMs = Number(
      channelOverride?.interval ?? baseCfg.interval ?? 10_000,
    );
    const maxMessages = Number(
      channelOverride?.maxMessages ?? baseCfg.maxMessages ?? 5,
    );
    const muteDurationMs = Number(
      channelOverride?.muteDuration ?? baseCfg.muteDuration ?? 5 * 60 * 1000,
    );
    const actionCooldownMs = Number(
      channelOverride?.actionCooldown ??
        baseCfg.actionCooldown ??
        2 * 60 * 1000,
    );

    const minLength = Number(baseCfg.minLength ?? 6);
    const ignoreAttachments = baseCfg.ignoreAttachments ?? true;
    const similarityThreshold = Number(baseCfg.similarityThreshold ?? 0.85);

    // Ignorar mensagens só com anexos (se configurado)
    const rawContent = (message.content || "").trim();
    const hasAttachments = message.attachments && message.attachments.size > 0;
    if (!rawContent && hasAttachments && ignoreAttachments) {
      return;
    }

    // Mensagens muito curtas não contam para spam (mas ainda assim são registadas)
    const isTooShort = rawContent.length > 0 && rawContent.length < minLength;

    const now = Date.now();
    let state = messageMap.get(key);
    if (!state) {
      state = { entries: [], lastActionAt: 0, strikes: 0, lastStrikeAt: 0 };
      messageMap.set(key, state);
    }

    // Limpar histórico fora da janela e limitar tamanho
    const pruned = [];
    for (const entry of state.entries) {
      if (now - entry.ts <= intervalMs) {
        pruned.push(entry);
      }
    }
    state.entries = pruned;
    if (state.entries.length > MAX_HISTORY_PER_USER) {
      state.entries = state.entries.slice(-MAX_HISTORY_PER_USER);
    }

    const norm = isTooShort ? "" : normalizeTextForSimilarity(rawContent);

    // Guardar esta mensagem no histórico
    state.entries.push({
      ts: now,
      norm,
    });
    if (state.entries.length > MAX_HISTORY_PER_USER) {
      state.entries.shift();
    }

    // Se for demasiado curta, não considerar spam
    if (isTooShort || !norm) {
      messageMap.set(key, state);
      return;
    }

    // Contar quantas mensagens semelhantes existem na janela.
    // Otimizações:
    //  - Comparar apenas as últimas N mensagens (reduz CPU sob carga)
    //  - Atalho para igualdade exata (evita Levenshtein)
    //  - Early-break quando já atingimos o threshold base
    const COMPARE_LAST_N = 8;
    let similarCount = 1; // esta mensagem
    const startIdx = Math.max(0, state.entries.length - 1 - COMPARE_LAST_N);
    for (let i = startIdx; i < state.entries.length - 1; i++) {
      const e = state.entries[i];
      if (!e.norm) continue;
      if (e.norm === norm) {
        similarCount++;
      } else {
        const sim = similarity(norm, e.norm);
        if (!isFinite(sim) || Number.isNaN(sim)) continue;
        if (sim >= similarityThreshold) {
          similarCount++;
        }
      }
      if (similarCount >= maxMessages) break;
    }

    // Fast-path: se ainda não atingiu o threshold base, não precisamos de ir à BD.
    // Isto reduz drasticamente I/O em servidores com muito tráfego.
    if (similarCount < maxMessages) {
      messageMap.set(key, state);
      return;
    }

    // Trust integration (apenas quando o utilizador já está perto de ação punitiva)
    const trustCfg = await getGuildTrustConfig(guild.id);
    let trustValue = typeof trustCfg.base === "number" ? trustCfg.base : 0;
    try {
      const trustUser = await warningsService.getOrCreateUser(
        guild.id,
        message.author.id,
      );
      if (trustUser && typeof trustUser.trust === "number") {
        trustValue = trustUser.trust;
      }
    } catch {
      // se falhar, fica base
    }

    const effectiveMaxMsgs = getEffectiveMaxMessages(
      maxMessages,
      trustCfg,
      trustValue,
    );
    const effectiveMuteDuration = getEffectiveMuteDuration(
      muteDurationMs,
      trustCfg,
      trustValue,
    );

    if (similarCount < effectiveMaxMsgs) {
      messageMap.set(key, state);
      return;
    }

    // Cooldown entre punições
    if (state.lastActionAt && now - state.lastActionAt < actionCooldownMs) {
      messageMap.set(key, state);
      return;
    }

    // Soft actions (warn -> depois mute)
    const softCfg = baseCfg.softActions || {};
    let action = "MUTE";

    if (softCfg.enabled) {
      const windowMs = Number(softCfg.strikeWindowMs || 10 * 60 * 1000);
      const strikesToMute = Number(softCfg.strikesToMute || 2);

      if (!state.lastStrikeAt || now - state.lastStrikeAt > windowMs) {
        state.strikes = 0;
      }

      state.strikes = (state.strikes || 0) + 1;
      state.lastStrikeAt = now;

      if (state.strikes < strikesToMute) {
        action = "WARN";
      } else {
        action = "MUTE";
      }
    }

    state.lastActionAt = now;
    messageMap.set(key, state);

    const me = guild.members.me;
    const channelPerms = message.channel?.permissionsFor?.(me);
    const canTimeout =
      !!me &&
      !!channelPerms &&
      channelPerms.has(PermissionsBitField.Flags.ModerateMembers);

    const publicNotify = baseCfg.sendMessage !== false;

    const baseReason = await tContext(message, "antispam.autoReason");

    if (action === "WARN" || !canTimeout) {
      // Apenas WARN (ou fallback se não pudermos mutar)
      let dbUser = null;
      try {
        dbUser = await warningsService.addWarning(
          guild.id,
          message.author.id,
          1,
        );
      } catch (e) {
        console.error("[antiSpam] Failed to add warning:", e);
      }

      try {
        await infractionsService.create({
          guild,
          user: message.author,
          moderator: client.user,
          type: "WARN",
          reason: baseReason,
          duration: null,
          source: "antispam",
        });
      } catch (e) {
        console.error("[antiSpam] Failed to create infraction (WARN):", e);
      }

      if (publicNotify) {
        try {
          const warnMsg =
            (await tContext(message, "antispam.warnPublic", {
              userMention: `${message.author}`,
              warnings: dbUser?.warnings ?? "N/A",
              maxWarnings: effectiveMaxMsgs,
            })) || `${message.author} recebeu um aviso automático por spam.`;
          await message.channel.send(warnMsg);
        } catch {
          // evitar crash do bot
        }
      }

      try {
        await logger(
          client,
          "Anti-spam Warn",
          message.author,
          client.user,
          (await tContext(message, "log.actions.antispamWarn", {
            threshold: effectiveMaxMsgs,
            intervalMs,
            similarityPct: Math.round(similarityThreshold * 100),
            trustAfter: trustCfg.enabled
              ? `${trustValue}/${trustCfg.max}`
              : "N/A",
          })) ||
            `User exceeded spam threshold (${similarCount}/${effectiveMaxMsgs}) in #${message.channel?.name || "unknown"}.`,
          guild,
        );
      } catch (e) {
        console.error("[antiSpam] Failed to log antispam warn:", e);
      }

      try {
        incrementAntiSpamActions();
      } catch {}

      return;
    }

    // MUTE
    let muteMs = effectiveMuteDuration;
    if (!Number.isFinite(muteMs) || muteMs <= 0) {
      muteMs = muteDurationMs;
    }

    try {
      await member.timeout(
        muteMs,
        `${baseReason} (timeout: ${Math.round(muteMs / 1000)}s)`,
      );
    } catch (e) {
      console.error("[antiSpam] Failed to apply timeout:", e);
    }

    let dbUserAfterMute = null;
    try {
      dbUserAfterMute = await warningsService.applyMutePenalty(
        guild.id,
        message.author.id,
      );
    } catch (e) {
      console.error("[antiSpam] Failed to apply mute penalty:", e);
    }

    try {
      await infractionsService.create({
        guild,
        user: message.author,
        moderator: client.user,
        type: "MUTE",
        reason: baseReason,
        duration: muteMs,
        source: "antispam",
      });
    } catch (e) {
      console.error("[antiSpam] Failed to create infraction (MUTE):", e);
    }

    if (publicNotify) {
      try {
        const mins = Math.max(1, Math.round(muteMs / 60000));
        const muteMsg =
          (await tContext(message, "antispam.mutePublic", {
            userMention: `${message.author}`,
            minutes: mins,
          })) ||
          `${message.author} foi silenciado automaticamente por spam durante ${mins} minutos.`;
        await message.channel.send(muteMsg);
      } catch {
        // swallow
      }
    }

    try {
      await logger(
        client,
        "Anti-spam Mute",
        message.author,
        client.user,
        (await tContext(message, "log.actions.antispamMute", {
          durationMinutes: Math.max(1, Math.round(muteMs / 60000)),
          threshold: effectiveMaxMsgs,
          intervalMs,
          similarityPct: Math.round(similarityThreshold * 100),
          trustAfter:
            dbUserAfterMute && trustCfg.enabled
              ? `${dbUserAfterMute.trust}/${trustCfg.max}`
              : trustCfg.enabled
                ? `${trustValue}/${trustCfg.max}`
                : "N/A",
        })) ||
          `User muted automatically for spam for ${Math.max(
            1,
            Math.round(muteMs / 60000),
          )} minutes.`,
        guild,
      );
    } catch (e) {
      console.error("[antiSpam] Failed to log antispam mute:", e);
    }

    try {
      incrementAntiSpamActions();
    } catch {}
  } catch (err) {
    console.error("[antiSpam] Error:", err);
  }
}

module.exports = antiSpam;
module.exports.resolveGuildAntiSpamConfig = resolveGuildAntiSpamConfig;
