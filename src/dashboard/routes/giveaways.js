// src/dashboard/routes/giveaways.js
//
// Dashboard routes to configure GamerPower giveaways per guild.

const { z } = require("zod");
const path = require("path");
const fs = require("fs");
const startGiveaways = require("../../systems/giveaways");
const { invalidateGuildConfig } = require("../../systems/guildConfigService");
const { escapeRegex } = require("../../utils/regex");

const GAMERPOWER_BASE = "https://www.gamerpower.com/api";
const BADGE_DIR = path.join(
  __dirname,
  "../../../public/assets/platform-badges",
);

function platformBadgePublicUrl(platform, baseUrl, cacheKey) {
  const p = String(platform || "").toLowerCase();
  const base = String(baseUrl || process.env.PUBLIC_BASE_URL || "")
    .trim()
    .replace(/\/+$/g, "");
  if (!base) return "";
  if (p.includes("steam"))
    return `${base}/platform-badge/steam.png?v=steam-${cacheKey || "1"}`;
  if (p.includes("epic"))
    return `${base}/platform-badge/epic.png?v=epic-${cacheKey || "1"}`;
  if (p.includes("ubisoft") || p.includes("uplay"))
    return `${base}/platform-badge/ubisoft.png?v=ubisoft-${cacheKey || "1"}`;
  return "";
}

function derivePublicBaseUrl(req) {
  const xfProto = (req.headers["x-forwarded-proto"] || "")
    .toString()
    .split(",")[0]
    .trim();
  const xfHost = (req.headers["x-forwarded-host"] || "")
    .toString()
    .split(",")[0]
    .trim();
  const proto = xfProto || req.protocol || "https";
  const host = xfHost || req.get("host") || "";
  if (!host) return null;
  const p = proto === "http" || proto === "https" ? proto : "https";
  return `${p}://${host}`;
}

function registerGiveawaysRoutes(ctx) {
  const {
    app,
    requireDashboardAuth,
    requirePerm,
    requireGuildAccess,
    rateLimit,
    sanitizeId,
    sanitizeText,
    recordAudit,
    getActorFromRequest,
    getClient,
    GuildConfig,
    GiveawayPost,
    requirePremium,
  } = ctx;

  // Some deployments of this codebase expose a smaller ctx surface.
  // Express will throw if any middleware handler is undefined.
  const noop = (req, res, next) => next();
  // Some of these are factories (return a middleware). Others are direct middleware.
  const auth =
    typeof requireDashboardAuth === "function" ? requireDashboardAuth : noop;
  const rlMedium =
    rateLimit && typeof rateLimit.medium === "function"
      ? rateLimit.medium
      : noop;

  const safeFactory = (factory, args) => {
    try {
      if (typeof factory !== "function") return noop;
      const mw = factory(args);
      return typeof mw === "function" ? mw : noop;
    } catch {
      return noop;
    }
  };

  const guardGuildQuery = safeFactory(requireGuildAccess, {
    from: "query",
    key: "guildId",
    optional: false,
  });
  const guardGuildBody = safeFactory(requireGuildAccess, {
    from: "body",
    key: "guildId",
    optional: false,
  });
  const premiumGuard = safeFactory(requirePremium, {
    from: "body",
    key: "guildId",
  });
  const premiumGuardQuery = safeFactory(requirePremium, {
    from: "query",
    key: "guildId",
  });
  const canManage = safeFactory(requirePerm, {
    anyOf: ["canManageGameNews", "canEditConfig"],
  });

  const GiveawaysConfigSchema = z.object({
    enabled: z.boolean().optional(),
    channelId: z.string().nullable().optional(),
    publicBaseUrl: z.string().optional(),
    platforms: z.array(z.string()).optional(),
    types: z.array(z.string()).optional(),
    pollIntervalSeconds: z.number().int().min(60).max(3600).optional(),
    maxPerCycle: z.number().int().min(0).max(50).optional(),
  });

  const ALLOWED_PLATFORMS = new Set(["steam", "epic-games-store", "ubisoft"]);

  // Public, unauthenticated route to serve platform badges with correct headers.
  // Discord will fetch these URLs directly for embed thumbnails.
  app.get("/platform-badge/:name", (req, res) => {
    const name = String(req.params.name || "").toLowerCase();
    const file =
      name === "steam.png"
        ? "steam.png"
        : name === "epic.png"
          ? "epic.png"
          : name === "ubisoft.png"
            ? "ubisoft.png"
            : null;
    if (!file) return res.status(404).end();

    const full = path.join(BADGE_DIR, file);
    if (!fs.existsSync(full)) return res.status(404).end();

    // Avoid caches serving stale/incorrect images.
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.sendFile(full);
  });

  app.get(
    "/api/giveaways/config",
    auth,
    canManage,
    guardGuildQuery,
    async (req, res) => {
      try {
        const guildId = sanitizeId(req.query.guildId || "");
        const doc = await GuildConfig.findOne({ guildId })
          .lean()
          .catch(() => null);
        const cfg = doc && doc.giveaways ? doc.giveaways : {};
        const rawPlatforms = Array.isArray(cfg.platforms)
          ? cfg.platforms
          : ["steam"];
        const filteredPlatforms = rawPlatforms
          .map(String)
          .filter((p) => ALLOWED_PLATFORMS.has(String(p)));
        return res.json({
          ok: true,
          guildId,
          giveaways: {
            enabled: Boolean(cfg.enabled),
            channelId: cfg.channelId || null,
            publicBaseUrl: cfg.publicBaseUrl || null,
            platforms: filteredPlatforms.length ? filteredPlatforms : ["steam"],
            // Free-To-Keep mode posts only games.
            types: ["game"],
            pollIntervalSeconds:
              typeof cfg.pollIntervalSeconds === "number"
                ? cfg.pollIntervalSeconds
                : 60,
            maxPerCycle:
              typeof cfg.maxPerCycle === "number" ? cfg.maxPerCycle : 0,
          },
        });
      } catch {
        return res.status(500).json({ ok: false, error: "internal_error" });
      }
    },
  );

  app.post(
    "/api/giveaways/config",
    auth,
    canManage,
    rlMedium,
    guardGuildBody,
    premiumGuard,
    async (req, res) => {
      try {
        const guildId = sanitizeId(req.body.guildId || "");
        const payload =
          req.body && req.body.giveaways ? req.body.giveaways : req.body;

        const parsed = GiveawaysConfigSchema.safeParse(payload || {});
        if (!parsed.success) {
          return res.status(400).json({ ok: false, error: "invalid_payload" });
        }

        const next = parsed.data;

        // sanitize arrays
        const platforms = Array.isArray(next.platforms)
          ? next.platforms
              .map((s) => sanitizeText(s, { maxLen: 64, stripHtml: true }))
              .filter(Boolean)
          : undefined;

        const filteredPlatforms = platforms
          ? platforms
              .map(String)
              .filter((p) => ALLOWED_PLATFORMS.has(String(p)))
          : undefined;

        // Free-To-Keep mode posts only games. Ignore user-provided types.
        const types = ["game"];

        const update = {};
        if (typeof next.enabled === "boolean")
          update["giveaways.enabled"] = next.enabled;
        if (next.channelId === null || typeof next.channelId === "string")
          update["giveaways.channelId"] = next.channelId
            ? sanitizeId(next.channelId)
            : null;

        // Persist a public base URL so the bot can reference local platform badge PNGs via HTTPS.
        // If none is provided, derive it from the current request host/proto.
        const derivedBase =
          (process.env.PUBLIC_BASE_URL || "").trim() ||
          derivePublicBaseUrl(req);
        const providedBase = next.publicBaseUrl
          ? String(next.publicBaseUrl).trim()
          : "";
        const baseUrl =
          providedBase && /^https?:\/\//i.test(providedBase)
            ? providedBase.replace(/\/$/, "")
            : derivedBase
              ? derivedBase.replace(/\/$/, "")
              : null;
        if (baseUrl) update["giveaways.publicBaseUrl"] = baseUrl;
        if (filteredPlatforms)
          update["giveaways.platforms"] = filteredPlatforms;
        update["giveaways.types"] = types;
        if (typeof next.pollIntervalSeconds === "number")
          update["giveaways.pollIntervalSeconds"] = next.pollIntervalSeconds;
        if (typeof next.maxPerCycle === "number")
          update["giveaways.maxPerCycle"] = next.maxPerCycle;

        await GuildConfig.updateOne(
          { guildId },
          { $set: update },
          { upsert: true },
        ).catch(() => null);

        // Evita servir config obsoleta (cache de 1 min do guildConfigService).
        invalidateGuildConfig(guildId);

        // Return the persisted state to keep the UI in sync (prevents "snap back" after save).
        const doc = await GuildConfig.findOne({ guildId })
          .lean()
          .catch(() => null);
        const cfg = doc && doc.giveaways ? doc.giveaways : {};

        // Audit
        if (
          typeof recordAudit === "function" &&
          typeof getActorFromRequest === "function"
        ) {
          const actor = getActorFromRequest(req);
          recordAudit({
            guildId,
            actor,
            action: "giveaways.update",
            meta: { update },
          }).catch(() => {});
        }

        return res.json({
          ok: true,
          giveaways: {
            enabled: Boolean(cfg.enabled),
            channelId: cfg.channelId || null,
            publicBaseUrl: cfg.publicBaseUrl || baseUrl || null,
            platforms: Array.isArray(cfg.platforms) ? cfg.platforms : ["steam"],
            types: ["game"],
            pollIntervalSeconds:
              typeof cfg.pollIntervalSeconds === "number"
                ? cfg.pollIntervalSeconds
                : 60,
            maxPerCycle:
              typeof cfg.maxPerCycle === "number" ? cfg.maxPerCycle : 0,
          },
        });
      } catch {
        return res.status(500).json({ ok: false, error: "internal_error" });
      }
    },
  );

  // Histórico de giveaways já publicados neste servidor.
  app.get(
    "/api/giveaways/history",
    auth,
    canManage,
    guardGuildQuery,
    async (req, res) => {
      try {
        if (!GiveawayPost) {
          return res.json({
            ok: true,
            page: 1,
            limit: 25,
            total: 0,
            items: [],
            platforms: [],
          });
        }

        const guildId = sanitizeId(req.query.guildId || "");
        if (!guildId)
          return res.status(400).json({ ok: false, error: "guildId required" });

        const page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
        const limitRaw = parseInt(req.query.limit || "25", 10);
        const limit = Math.min(
          Math.max(Number.isFinite(limitRaw) ? limitRaw : 25, 1),
          100,
        );

        const platform = sanitizeText(req.query.platform || "", {
          maxLen: 64,
          stripHtml: true,
        });
        const search = sanitizeText(req.query.search || "", {
          maxLen: 120,
          stripHtml: true,
        });

        const query = { guildId };
        if (platform) query.platform = platform;
        if (search) {
          const rx = new RegExp(escapeRegex(search), "i");
          query.$or = [{ title: rx }, { platform: rx }, { type: rx }];
        }

        const total = await GiveawayPost.countDocuments(query);
        const items = await GiveawayPost.find(query)
          .sort({ postedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean();

        // Lista de plataformas distintas (para o filtro), apenas no primeiro pedido.
        let platforms = [];
        if (page === 1) {
          platforms = (await GiveawayPost.distinct("platform", { guildId }))
            .filter((p) => typeof p === "string" && p)
            .sort();
        }

        return res.json({ ok: true, page, limit, total, items, platforms });
      } catch {
        return res.status(500).json({ ok: false, error: "internal_error" });
      }
    },
  );

  // Status endpoint for dashboard UI (in-memory)
  app.get(
    "/api/giveaways/status",
    auth,
    canManage,
    guardGuildQuery,
    async (req, res) => {
      try {
        const guildId = String(req.query.guildId || "");
        if (!guildId)
          return res
            .status(400)
            .json({ ok: false, message: "guildId required" });

        let sys = null;
        try {
          sys = require("../../systems/giveaways");
        } catch {}
        const st =
          sys && typeof sys.getStatus === "function"
            ? sys.getStatus(guildId)
            : null;

        let channelName = null;
        try {
          const channelId = st && st.channelId ? String(st.channelId) : "";
          if (ctx.client && channelId) {
            const ch = await ctx.client.channels
              .fetch(channelId)
              .catch(() => null);
            if (ch && ch.name) channelName = ch.name;
          }
        } catch {}

        return res.json({
          ok: true,
          status: st ? { ...st, channelName } : null,
        });
      } catch (e) {
        return res.status(500).json({
          ok: false,
          message: e && e.message ? e.message : "status error",
        });
      }
    },
  );

  // Manual trigger ("Verificar agora")
  app.post(
    "/api/giveaways/trigger",
    auth,
    canManage,
    rlMedium,
    guardGuildQuery,
    premiumGuardQuery,
    async (req, res) => {
      try {
        const guildId = String(req.query.guildId || "");
        if (!guildId)
          return res
            .status(400)
            .json({ ok: false, message: "guildId required" });

        const inst =
          startGiveaways && startGiveaways._instance
            ? startGiveaways._instance
            : null;
        if (!inst || typeof inst.triggerGuild !== "function") {
          return res
            .status(503)
            .json({ ok: false, message: "system not ready" });
        }

        await inst.triggerGuild(guildId);
        return res.json({ ok: true });
      } catch (e) {
        return res.status(500).json({
          ok: false,
          message: e && e.message ? String(e.message) : "trigger error",
        });
      }
    },
  );

  app.get(
    "/api/giveaways/sample",
    auth,
    canManage,
    guardGuildQuery,
    async (req, res) => {
      try {
        const platform = sanitizeText(req.query.platform || "steam", {
          maxLen: 64,
          stripHtml: true,
        });
        const type = sanitizeText(req.query.type || "game", {
          maxLen: 32,
          stripHtml: true,
        });
        if (!ALLOWED_PLATFORMS.has(String(platform)))
          return res.status(400).json({ ok: false, error: "invalid_platform" });

        const url = `${GAMERPOWER_BASE}/giveaways?platform=${encodeURIComponent(String(platform))}&type=${encodeURIComponent(String(type))}`;
        const gp = await fetch(url, {
          method: "GET",
          headers: { accept: "application/json" },
        });
        if (!gp.ok)
          return res.status(502).json({ ok: false, error: "upstream_error" });
        const list = await gp.json().catch(() => []);
        const g =
          Array.isArray(list) && list.length
            ? list.find(
                (it) =>
                  it && it.image && it.image !== "N/A" && it.gamerpower_url,
              ) || list[0]
            : null;
        if (!g) return res.json({ ok: true, item: null });

        // O embed mostra apenas o nome do jogo (sem "(Steam) Key Giveaway", etc.).
        if (g && g.title) g.title = startGiveaways.cleanTitle(g.title);

        // Avoid mixed-content blocking on HTTPS dashboards.
        if (g && typeof g.image === "string" && g.image.startsWith("http://")) {
          g.image = "https://" + g.image.slice("http://".length);
        }

        return res.json({ ok: true, item: g });
      } catch {
        return res.status(500).json({ ok: false, error: "internal_error" });
      }
    },
  );

  // Send a test giveaway embed to the selected channel.
  app.post(
    "/api/giveaways/test",
    auth,
    canManage,
    rlMedium,
    guardGuildBody,
    async (req, res) => {
      try {
        const guildId = sanitizeId(req.body.guildId || "");
        const channelId = sanitizeId(req.body.channelId || "");
        const platform = sanitizeText(req.body.platform || "steam", {
          maxLen: 64,
          stripHtml: true,
        });
        if (!guildId || !channelId)
          return res.status(400).json({ ok: false, error: "missing_channel" });
        if (!ALLOWED_PLATFORMS.has(String(platform)))
          return res.status(400).json({ ok: false, error: "invalid_platform" });

        const client = typeof getClient === "function" ? getClient() : null;
        if (!client)
          return res
            .status(500)
            .json({ ok: false, error: "client_unavailable" });

        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (!ch || typeof ch.send !== "function")
          return res
            .status(404)
            .json({ ok: false, error: "channel_not_found" });

        const payload = await buildTestMessage({ platform, req });
        await ch.send(payload);

        return res.json({ ok: true });
      } catch (e) {
        // Surface a trimmed error to help debugging in production logs/UI.
        const msg = e && e.message ? String(e.message) : String(e);
        return res.status(500).json({
          ok: false,
          error: "internal_error",
          message: msg.slice(0, 180),
        });
      }
    },
  );
}

function normalizeImageUrl(url) {
  const u = String(url || "").trim();
  if (!u || u === "N/A") return "";
  return u.startsWith("http://") ? "https://" + u.slice("http://".length) : u;
}

function formatDateDMY(value) {
  const s = String(value || "").trim();
  if (!s || s === "N/A") return "";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getUTCFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function parseToUnixSeconds(value) {
  const s = String(value || "").trim();
  if (!s || s === "N/A") return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

function badgeFile(platform) {
  const p = String(platform || "").toLowerCase();
  if (p.includes("steam")) return path.join(BADGE_DIR, "steam.png");
  if (p.includes("epic")) return path.join(BADGE_DIR, "epic.png");
  return path.join(BADGE_DIR, "ubisoft.png");
}

function makeLinkLine({ browserUrl, clientUrl, platform }) {
  const browser = String(browserUrl || "").trim();
  const client = String(clientUrl || "").trim();
  if (!browser && !client) return "";
  const SEP =
    "\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0";
  const links = [];
  if (browser) links.push(`**[Open in browser ↗](${browser})**`);
  const p = String(platform || "").toLowerCase();
  if (p.includes("steam")) {
    if (client) links.push(`**[Open in Steam Client ↗](${client})**`);
  } else if (p.includes("epic")) {
    if (client) links.push(`**[Open in Epic Games ↗](${client})**`);
  } else if (p.includes("ubisoft")) {
    if (client) links.push(`**[Open in Ubisoft Games ↗](${client})**`);
  }
  return links.join(SEP);
}

async function buildTestMessage({ platform, req }) {
  const platParam = String(platform).includes("steam")
    ? "steam"
    : String(platform).includes("epic")
      ? "epic-games-store"
      : "ubisoft";
  const url = `${GAMERPOWER_BASE}/giveaways?platform=${encodeURIComponent(platParam)}&type=game`;
  const res = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
  }).catch(() => null);
  const list = res && res.ok ? await res.json().catch(() => []) : [];
  // Prefer an item that has an image and links, otherwise fall back to the first.
  const g =
    Array.isArray(list) && list.length
      ? list.find(
          (it) => it && it.image && it.image !== "N/A" && it.gamerpower_url,
        ) || list[0]
      : null;

  const title = g && g.title ? startGiveaways.cleanTitle(g.title) : "TEST";
  const worth = g && g.worth ? String(g.worth) : "";
  const until = formatDateDMY(g && g.end_date ? g.end_date : "");
  const untilUnix = parseToUnixSeconds(g && g.end_date ? g.end_date : "");
  const image = normalizeImageUrl(g && g.image ? g.image : "");
  const browserUrl =
    g && (g.giveaway_url || g.open_giveaway_url || g.gamerpower_url)
      ? String(g.giveaway_url || g.open_giveaway_url || g.gamerpower_url)
      : "https://www.gamerpower.com/";
  const clientUrl = g && g.open_giveaway_url ? String(g.open_giveaway_url) : "";
  const publisher = g && g.publisher ? String(g.publisher) : "";

  const untilText = untilUnix ? `<t:${untilUnix}:d>` : until || "—";
  const meta = `${worth && worth !== "N/A" ? `~~${worth}~~ ` : ""}**Free** until ${untilText}`;
  const linkLine = makeLinkLine({ browserUrl, clientUrl, platform: platParam });

  // If PUBLIC_BASE_URL is set, thumbnail will point to our own static PNGs.
  // Validate assets exist on disk to catch broken deploys.
  const badgePath = badgeFile(platParam);
  if (
    (process.env.PUBLIC_BASE_URL || "").trim() &&
    badgePath &&
    !fs.existsSync(badgePath)
  ) {
    throw new Error(`Platform badge missing on disk: ${badgePath}`);
  }
  const base =
    (process.env.PUBLIC_BASE_URL || "").trim() ||
    (req ? derivePublicBaseUrl(req) : null);
  const badgeUrl = base
    ? platformBadgePublicUrl(platParam, base, Date.now())
    : "";

  const embed = {
    title,
    description: linkLine
      ? `${meta}

${linkLine}`
      : meta,
    thumbnail: badgeUrl ? { url: badgeUrl } : undefined,
    image: image ? { url: image } : undefined,
    footer: {
      text: `via .rabbitstuff.xyz${publisher ? `  •  © ${publisher}` : ""}`,
    },
  };

  return {
    embeds: [embed],
    files: [],
  };
}

module.exports = { registerGiveawaysRoutes };
