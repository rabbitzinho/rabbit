// src/systems/giveaways.js

const { EmbedBuilder, PermissionsBitField } = require("discord.js");
const GuildConfig = require("../database/models/GuildConfig");
const GiveawayPost = require("../database/models/GiveawayPost");
const { fetchChannel } = require("../services/discordFetchCache");

const GAMERPOWER_BASE = "https://www.gamerpower.com/api";
const FETCH_TIMEOUT_MS = 15_000;
const SCHEDULER_MS = 10_000;
const MIN_POLL_SECONDS = 60;
const MAX_POLL_SECONDS = 3600;
const HARD_CAP_PER_CYCLE = 50;
const DEFAULT_429_MS = 5 * 60 * 1000;

const ALLOWED_PLATFORMS = new Set(["steam", "epic-games-store", "ubisoft"]);

const runningGuilds = new Set();
const statusByGuild = new Map();
const retryUntilByGuild = new Map();

let started = false;
let scheduler = null;

// A GamerPower decora o título com sufixos como "(Steam) Giveaway",
// "(Steam) Key Giveaway", "Steam Key Giveaway" ou "(Beta) Steam Key Giveaway".
// O embed deve mostrar apenas o nome do jogo, por isso removemos esses sufixos
// (e prefixos de plataforma) de forma iterativa até o título estabilizar.
const TITLE_SUFFIX_PAREN_RE =
  /[\s\-–—:|]*(?:\[|\()\s*(steam(\s*key)?|epic\s*games?|ubisoft|uplay|dlc|beta|early\s*access|playtest|key|giveaway)\s*(?:\]|\))\s*$/i;
const TITLE_SUFFIX_WORD_RE =
  /[\s\-–—:|]*\b(steam(\s*key)?|epic\s*games?|ubisoft|uplay|key|giveaway)\s*$/i;
const TITLE_PREFIX_RE =
  /^\s*(?:\[|\()?\s*(steam(\s*key)?|epic\s*games?|ubisoft|uplay)\s*(?:\]|\))?\s*[:\-–—|]*\s*/i;

function cleanTitle(title) {
  if (!title) return "Giveaway";

  let s = String(title).trim();
  let prev;
  do {
    prev = s;
    s = s
      .replace(TITLE_SUFFIX_PAREN_RE, "")
      .replace(TITLE_SUFFIX_WORD_RE, "")
      .trim();
  } while (s && s !== prev);

  s = s.replace(TITLE_PREFIX_RE, "").trim();
  s = s
    .replace(/^[\s\-–—:|]+|[\s\-–—:|]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return s || "Giveaway";
}

function formatDate(value) {
  if (!value || value === "N/A") return "—";

  const d = new Date(value);
  if (isNaN(d.getTime())) return value;

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  return `${day}/${month}/${year}`;
}

function parseUnix(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

function toIso(msOrDate) {
  if (!msOrDate) return null;
  const d = msOrDate instanceof Date ? msOrDate : new Date(msOrDate);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeImageUrl(url) {
  const u = String(url || "").trim();
  if (!u || u === "N/A") return "";
  return u.startsWith("http://") ? "https://" + u.slice("http://".length) : u;
}

function platformApiParam(plat) {
  const p = String(plat || "")
    .toLowerCase()
    .trim();
  if (!p) return null;
  if (p.includes("steam")) return "steam";
  if (p.includes("epic")) return "epic-games-store";
  if (p.includes("ubisoft") || p.includes("uplay")) return "ubisoft";
  return ALLOWED_PLATFORMS.has(p) ? p : null;
}

function resolvePlatform(it, fallback) {
  const p = String(it.platforms || "").toLowerCase();

  if (p.includes("steam")) return "steam";
  if (p.includes("epic")) return "epic";
  if (p.includes("ubisoft") || p.includes("uplay")) return "ubisoft";

  const fb = platformApiParam(fallback);
  if (fb === "epic-games-store") return "epic";
  return fb || fallback;
}

function badgeUrl(platform, base, id) {
  if (!base) return "";
  const root = String(base).replace(/\/+$/g, "");

  if (platform === "steam") return `${root}/platform-badge/steam.png?v=${id}`;
  if (platform === "epic") return `${root}/platform-badge/epic.png?v=${id}`;
  if (platform === "ubisoft")
    return `${root}/platform-badge/ubisoft.png?v=${id}`;

  return "";
}

function buildLinks(g, platform) {
  const browser = g.giveaway_url || g.gamerpower_url || "";
  const client = g.open_giveaway_url || "";

  const SEP = "   ";
  const links = [];

  if (browser) {
    links.push(`**[Open in browser ↗](${browser})**`);
  }

  if (client) {
    if (platform === "steam") {
      links.push(`**[Open in Steam Client ↗](${client})**`);
    } else if (platform === "epic") {
      links.push(`**[Open in Epic Games ↗](${client})**`);
    } else if (platform === "ubisoft") {
      links.push(`**[Open in Ubisoft Games ↗](${client})**`);
    }
  }

  return links.join(SEP);
}

function makeEmbed(g, platform, baseUrl) {
  const title = cleanTitle(g.title);

  const worth = g.worth && g.worth !== "N/A" ? `~~${g.worth}~~` : "";
  const endUnix = parseUnix(g.end_date);
  const endDate = formatDate(g.end_date);

  const freeLine = `**Free** until ${endUnix ? `<t:${endUnix}:d>` : endDate}`;
  const links = buildLinks(g, platform);

  const description =
    [worth, freeLine].filter(Boolean).join(" ") + (links ? `\n\n${links}` : "");

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "via .rabbitstuff.xyz" });

  const image = normalizeImageUrl(g.image);
  if (image) embed.setImage(image);

  const badge = badgeUrl(platform, baseUrl, g.id || Date.now());
  if (badge) embed.setThumbnail(badge);

  return embed;
}

function itemPublishedMs(it) {
  const d = it?.published_date ? new Date(it.published_date) : null;
  if (d && !isNaN(d.getTime())) return d.getTime();
  return 0;
}

function sortNewestFirst(items) {
  return [...items].sort((a, b) => itemPublishedMs(b) - itemPublishedMs(a));
}

function parseRetryAfterMs(res) {
  const raw = res.headers?.get?.("retry-after");
  if (!raw) return DEFAULT_429_MS;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_POLL_SECONDS * 1000, Math.max(1000, seconds * 1000));
  }
  const when = Date.parse(raw);
  if (!Number.isNaN(when)) {
    return Math.min(MAX_POLL_SECONDS * 1000, Math.max(1000, when - Date.now()));
  }
  return DEFAULT_429_MS;
}

function effectivePollMs(gcfg) {
  const sec = Number(gcfg?.pollIntervalSeconds ?? 60);
  const safe = Number.isFinite(sec)
    ? Math.max(MIN_POLL_SECONDS, Math.min(MAX_POLL_SECONDS, sec))
    : MIN_POLL_SECONDS;
  return safe * 1000;
}

function effectiveMaxPerCycle(gcfg) {
  const n = Number(gcfg?.maxPerCycle);
  if (!Number.isFinite(n) || n <= 0) return HARD_CAP_PER_CYCLE;
  return Math.min(HARD_CAP_PER_CYCLE, Math.max(1, Math.round(n)));
}

function ensureStatus(guildId, patch = {}) {
  const id = String(guildId);
  const prev = statusByGuild.get(id) || {
    enabled: false,
    channelId: null,
    lastPollAt: null,
    nextPollAt: null,
    lastSentAt: null,
    lastError: null,
  };
  const next = { ...prev, ...patch };
  statusByGuild.set(id, next);
  return next;
}

function getStatus(guildId) {
  if (!guildId) return null;
  return statusByGuild.get(String(guildId)) || null;
}

function uniqueItemKey(it) {
  const url =
    it.open_giveaway_url ||
    it.giveaway_url ||
    it.gamerpower_url ||
    it.open_giveaway;
  if (url && String(url).trim()) return String(url).trim();
  if (it?.id != null) return `id:${it.id}`;
  return null;
}

async function fetchGiveaways(platform) {
  const plat = platformApiParam(platform);
  if (!plat) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const url = `${GAMERPOWER_BASE}/giveaways?platform=${encodeURIComponent(plat)}&type=game`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (compatible; .rabbit/1.0; +https://github.com/maze92/rabbit-bot)",
      },
      signal: controller.signal,
    });

    if (res.status === 429) {
      const err = new Error(`GamerPower rate limited (429) for ${plat}`);
      err.statusCode = 429;
      err.retryAfterMs = parseRetryAfterMs(res);
      throw err;
    }

    if (!res.ok) {
      const err = new Error(`GamerPower HTTP ${res.status} for ${plat}`);
      err.statusCode = res.status;
      throw err;
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error(`GamerPower returned non-array payload for ${plat}`);
    }
    return data;
  } catch (err) {
    if (err && err.statusCode) throw err;
    if (
      err &&
      (err.name === "AbortError" ||
        err.message === "This operation was aborted")
    ) {
      const timeoutErr = new Error(
        `GamerPower timeout (${FETCH_TIMEOUT_MS}ms) for ${plat}`,
      );
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function canPostToChannel(channel, client) {
  if (
    !channel ||
    typeof channel.isTextBased !== "function" ||
    !channel.isTextBased()
  )
    return false;
  try {
    const perms = channel.permissionsFor?.(client.user);
    if (!perms) return false;
    return (
      perms.has(PermissionsBitField.Flags.SendMessages) &&
      perms.has(PermissionsBitField.Flags.EmbedLinks)
    );
  } catch {
    return false;
  }
}

async function postGiveaway(client, channel, g, platform, baseUrl) {
  if (!canPostToChannel(channel, client)) {
    return { ok: false, reason: "missing_permissions" };
  }

  try {
    const embed = makeEmbed(g, platform, baseUrl);
    await channel.send({ embeds: [embed] });
    return { ok: true };
  } catch (err) {
    console.error("[Giveaways] Failed to send embed:", err?.message || err);
    return { ok: false, reason: err?.message || "send_failed" };
  }
}

async function processGuild(client, cfg, { force = false } = {}) {
  const guildId = String(cfg.guildId);
  const gcfg = cfg.giveaways || {};

  if (runningGuilds.has(guildId))
    return { skipped: true, reason: "already_running" };
  runningGuilds.add(guildId);

  const now = Date.now();
  const pollMs = effectivePollMs(gcfg);
  const channelId = gcfg.channelId ? String(gcfg.channelId) : null;

  ensureStatus(guildId, {
    enabled: gcfg.enabled === true,
    channelId,
    lastPollAt: toIso(now),
    nextPollAt: toIso(now + pollMs),
    lastError: null,
  });

  try {
    if (gcfg.enabled !== true) {
      ensureStatus(guildId, { enabled: false, lastError: null });
      return { skipped: true, reason: "disabled" };
    }

    const retryUntil = retryUntilByGuild.get(guildId) || 0;
    if (!force && retryUntil > now) {
      ensureStatus(guildId, {
        lastError: "À espera do Retry-After da GamerPower",
        nextPollAt: toIso(retryUntil),
      });
      return { skipped: true, reason: "backoff" };
    }

    if (!channelId) {
      const msg = "Canal de publicação não configurado";
      console.warn(`[Giveaways] ${msg} (guild ${guildId})`);
      ensureStatus(guildId, { lastError: msg });
      return { skipped: true, reason: "no_channel" };
    }

    const channel = await fetchChannel(client, channelId).catch(() => null);
    if (!canPostToChannel(channel, client)) {
      const msg = "Canal em falta ou sem permissão SendMessages/EmbedLinks";
      console.warn(
        `[Giveaways] ${msg} (guild ${guildId}, channel ${channelId})`,
      );
      ensureStatus(guildId, { lastError: msg });
      return { skipped: true, reason: "bad_channel" };
    }

    const platforms =
      Array.isArray(gcfg.platforms) && gcfg.platforms.length
        ? gcfg.platforms
        : ["steam"];
    const maxPerCycle = effectiveMaxPerCycle(gcfg);

    const sentThisCycle = new Set();
    let sentCount = 0;

    for (const plat of platforms) {
      if (sentCount >= maxPerCycle) break;

      const apiPlat = platformApiParam(plat);
      if (!apiPlat) continue;

      const items = sortNewestFirst(await fetchGiveaways(apiPlat));

      for (const it of items) {
        if (!it?.id) continue;
        if (sentCount >= maxPerCycle) break;

        const uniqueKey = uniqueItemKey(it);
        if (!uniqueKey) continue;
        if (sentThisCycle.has(uniqueKey)) continue;

        const or = [{ giveawayId: it.id }];
        if (!uniqueKey.startsWith("id:")) or.push({ url: uniqueKey });

        const exists = await GiveawayPost.findOne({ guildId, $or: or }).lean();
        if (exists) continue;

        const platform = resolvePlatform(it, apiPlat);
        const posted = await postGiveaway(
          client,
          channel,
          it,
          platform,
          gcfg.publicBaseUrl,
        );

        if (!posted.ok) {
          ensureStatus(guildId, { lastError: posted.reason || "send_failed" });
          // Do not persist — retry next cycle.
          continue;
        }

        try {
          await GiveawayPost.create({
            guildId,
            giveawayId: it.id,
            url: uniqueKey.startsWith("id:") ? null : uniqueKey,
            platform,
            type: "game",
            title: it.title || null,
            postedAt: new Date(),
          });
        } catch (createErr) {
          // Duplicate index: already recorded by a parallel run. Safe to ignore.
          if (createErr?.code !== 11000) {
            console.error(
              "[Giveaways] Failed to persist GiveawayPost:",
              createErr?.message || createErr,
            );
          }
        }

        sentThisCycle.add(uniqueKey);
        sentCount++;
        ensureStatus(guildId, {
          lastSentAt: toIso(Date.now()),
          lastError: null,
        });
      }
    }

    retryUntilByGuild.delete(guildId);
    return { ok: true, sent: sentCount };
  } catch (err) {
    const retryAfterMs = Number(err?.retryAfterMs);
    if (
      err?.statusCode === 429 &&
      Number.isFinite(retryAfterMs) &&
      retryAfterMs > 0
    ) {
      const until = Date.now() + retryAfterMs;
      retryUntilByGuild.set(guildId, until);
      ensureStatus(guildId, {
        lastError: err.message || "GamerPower 429",
        nextPollAt: toIso(until),
      });
      console.warn(
        `[Giveaways] Rate limited for guild ${guildId}, retry at ${toIso(until)}`,
      );
    } else {
      console.error(
        `[Giveaways] Error processing guild ${guildId}:`,
        err?.message || err,
      );
      ensureStatus(guildId, {
        lastError: String(err?.message || err).slice(0, 180),
      });
    }
    return { ok: false, error: err?.message || String(err) };
  } finally {
    runningGuilds.delete(guildId);
  }
}

async function triggerGuild(client, guildId) {
  const id = String(guildId || "").trim();
  if (!id) throw new Error("guildId is required");

  const cfg = await GuildConfig.findOne({ guildId: id }).lean();
  if (!cfg) throw new Error("Guild config not found");

  return processGuild(client, cfg, { force: true });
}

async function tick(client) {
  let configs = [];
  try {
    configs = await GuildConfig.find({ "giveaways.enabled": true }).lean();
  } catch (err) {
    console.error(
      "[Giveaways] Failed loading GuildConfig:",
      err?.message || err,
    );
    return;
  }

  const now = Date.now();
  const enabledIds = new Set();

  for (const cfg of configs) {
    if (!cfg?.guildId) continue;
    const guildId = String(cfg.guildId);
    enabledIds.add(guildId);

    const gcfg = cfg.giveaways || {};
    const st = ensureStatus(guildId, {
      enabled: true,
      channelId: gcfg.channelId || null,
    });

    const nextAt = st.nextPollAt ? Date.parse(st.nextPollAt) : 0;
    if (Number.isFinite(nextAt) && nextAt > now) continue;

    await processGuild(client, cfg, { force: false });
  }

  for (const [id, st] of statusByGuild.entries()) {
    if (!enabledIds.has(id) && st.enabled) {
      ensureStatus(id, { enabled: false });
    }
  }
}

async function startGiveaways(client) {
  if (started) {
    return module.exports._instance;
  }
  started = true;

  const api = {
    triggerGuild: (guildId) => triggerGuild(client, guildId),
    getStatus,
    client,
  };

  module.exports._instance = api;
  module.exports.getStatus = getStatus;
  module.exports.triggerGuild = api.triggerGuild;

  // Seed status so the dashboard is not blank before the first tick.
  try {
    const configs = await GuildConfig.find({
      "giveaways.enabled": true,
    }).lean();
    const soon = Date.now() + 1500;
    for (const cfg of configs) {
      if (!cfg?.guildId) continue;
      ensureStatus(String(cfg.guildId), {
        enabled: true,
        channelId: cfg.giveaways?.channelId || null,
        nextPollAt: toIso(soon),
        lastError: null,
      });
    }
  } catch (err) {
    console.warn("[Giveaways] Failed to seed status:", err?.message || err);
  }

  const run = () => {
    tick(client).catch((err) => {
      console.error("[Giveaways] Scheduler tick failed:", err?.message || err);
    });
  };

  setTimeout(run, 1500).unref?.();
  scheduler = setInterval(run, SCHEDULER_MS);
  scheduler.unref?.();

  console.log("[Giveaways] Free-To-Keep scheduler started");
  return api;
}

module.exports = startGiveaways;
module.exports.getStatus = getStatus;
module.exports.cleanTitle = cleanTitle;
module.exports.triggerGuild = async function triggerGuildNotReady() {
  throw new Error("Giveaways system not started");
};
