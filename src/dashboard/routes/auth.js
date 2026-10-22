// src/dashboard/routes/auth.js
//
// Discord OAuth2-only authentication.
// Login is allowed for any user with access to at least one guild.
// The configured bot owner has global access; guild administrators remain
// limited to servers where Discord OAuth confirms their authority.

const { getGuild } = require("../../services/guildService");
const { getBotOwnerId, isGuildAdministrator } = require("../botRoles");

function registerAuthRoutes(ctx) {
  const {
    app,
    express,
    requireDashboardAuth,
    jwt,
    JWT_SECRET,
    sanitizeText,
    rateLimit,
    ADMIN_PERMISSIONS,
    getClient,
    sanitizeId,
  } = ctx;

  const crypto = require("crypto");
  const botOwnerId = getBotOwnerId(process.env.BOT_OWNER_IDS);
  const isBotOwnerUser = (userId) => String(userId || "") === botOwnerId;

  // OAuth robustness: avoid duplicate token exchanges, and gracefully handle Discord global rate limits.
  // Note: in-memory only. If you run multiple replicas, consider a shared store (e.g. Redis) to dedupe across instances.
  const oauthCodeCache = new Map(); // code -> { exp, redirectUrl }
  const oauthInflight = new Map(); // key -> exp
  // Global backoff for Discord OAuth token exchange 429s (shared IP/app limits).
  // When Discord tells us to wait minutes, do NOT keep retrying inside a single request.
  let oauthTokenCooldownUntilMs = 0;
  function oauthCooldownRemainingSec() {
    const rem = Math.ceil((oauthTokenCooldownUntilMs - Date.now()) / 1000);
    return rem > 0 ? rem : 0;
  }
  function nowMs() {
    return Date.now();
  }
  function sweepMaps() {
    const n = nowMs();
    for (const [k, v] of oauthCodeCache.entries())
      if (!v || v.exp <= n) oauthCodeCache.delete(k);
    for (const [k, exp] of oauthInflight.entries())
      if (!exp || exp <= n) oauthInflight.delete(k);
  }
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  function getClientIp(req) {
    const xf =
      (req.headers &&
        (req.headers["x-forwarded-for"] || req.headers["X-Forwarded-For"])) ||
      "";
    const ip =
      String(Array.isArray(xf) ? xf[0] : xf)
        .split(",")[0]
        .trim() ||
      req.ip ||
      "";
    return ip;
  }
  function inflightKey(req, state) {
    return `${getClientIp(req)}:${String(state || "").slice(0, 64)}`;
  }

  function oauthEnabled() {
    return !!(
      process.env.DISCORD_OAUTH_CLIENT_ID &&
      process.env.DISCORD_OAUTH_CLIENT_SECRET
    );
  }

  function getRedirectUri(req) {
    // Prefer explicit redirect URI (recommended). Fallback to inferred host.
    return (
      process.env.DISCORD_OAUTH_REDIRECT_URI ||
      `${req.protocol}://${req.get("host")}/api/auth/discord/callback`
    );
  }

  function parseCookies(req) {
    const header =
      req && req.headers && req.headers.cookie
        ? String(req.headers.cookie)
        : "";
    const out = {};
    header.split(";").forEach((part) => {
      const i = part.indexOf("=");
      if (i <= 0) return;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (!k) return;
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    });
    return out;
  }

  function setCookie(res, name, value, opts = {}) {
    const parts = [`${name}=${encodeURIComponent(value)}`];
    parts.push("Path=/");
    if (opts.maxAge != null)
      parts.push(`Max-Age=${Math.max(0, Number(opts.maxAge) || 0)}`);
    if (opts.httpOnly !== false) parts.push("HttpOnly");
    // Lax keeps the OAuth callback working while protecting most CSRF.
    parts.push(`SameSite=${opts.sameSite || "Lax"}`);
    if (opts.secure) parts.push("Secure");
    res.append("Set-Cookie", parts.join("; "));
  }

  function clearCookie(res, name) {
    // Clear both Secure and non-Secure variants to avoid stale cookies across proxy/HTTPS edge cases.
    try {
      res.append(
        "Set-Cookie",
        `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`,
      );
    } catch {}
    try {
      res.append(
        "Set-Cookie",
        `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
      );
    } catch {}
  }

  function isSecureRequest(req) {
    return !!(req && req.secure);
  }

  // Public status (UI convenience).
  app.get("/api/auth/oauth/status", (req, res) => {
    return res.json({ ok: true, enabled: oauthEnabled(), oauthOnly: true });
  });

  const rlCallback = rateLimit({
    windowMs: 60_000,
    max: 20,
    keyPrefix: "rl:auth:callback:",
  });

  // Discord OAuth2 start
  app.get("/api/auth/discord", (req, res) => {
    if (!oauthEnabled()) {
      return res
        .status(400)
        .send(
          "Discord OAuth is not configured. Set DISCORD_OAUTH_CLIENT_ID and DISCORD_OAUTH_CLIENT_SECRET.",
        );
    }

    const state = crypto.randomBytes(16).toString("hex");
    setCookie(res, "oauth_state", state, {
      httpOnly: true,
      sameSite: "Lax",
      secure: isSecureRequest(req),
      maxAge: 300,
    });

    const clientId = process.env.DISCORD_OAUTH_CLIENT_ID;
    const redirectUri = getRedirectUri(req);
    const scope = encodeURIComponent("identify guilds");

    const url =
      "https://discord.com/api/oauth2/authorize" +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      "&response_type=code" +
      `&scope=${scope}` +
      `&state=${encodeURIComponent(state)}`;

    return res.redirect(url);
  });

  // Discord OAuth2 callback
  app.get("/api/auth/discord/callback", rlCallback, async (req, res) => {
    try {
      if (!oauthEnabled())
        return res.status(400).send("Discord OAuth is not configured.");

      const code = typeof req.query.code === "string" ? req.query.code : "";
      const returnedState =
        typeof req.query.state === "string" ? req.query.state : "";
      sweepMaps();
      // If the callback is invoked twice with the same single-use code, reuse the cached redirect.
      if (code) {
        const cached = oauthCodeCache.get(code);
        if (cached && cached.redirectUrl) {
          if (cached.token) {
            setCookie(res, "dash_token", cached.token, {
              httpOnly: true,
              sameSite: "Lax",
              secure: isSecureRequest(req),
              maxAge: 4 * 60 * 60,
            });
          }
          return res.redirect(cached.redirectUrl);
        }
      }

      // Prevent parallel token exchanges for the same client/state.
      const lk = inflightKey(req, returnedState);
      if (oauthInflight.has(lk)) {
        const cached = code ? oauthCodeCache.get(code) : null;
        if (cached && cached.redirectUrl) {
          if (cached.token) {
            setCookie(res, "dash_token", cached.token, {
              httpOnly: true,
              sameSite: "Lax",
              secure: isSecureRequest(req),
              maxAge: 4 * 60 * 60,
            });
          }
          return res.redirect(cached.redirectUrl);
        }
        return res
          .status(429)
          .send("OAuth is already in progress. Please retry in a few seconds.");
      }
      oauthInflight.set(lk, nowMs() + 15000);

      try {
        const cookies = parseCookies(req);
        const expectedState = cookies.oauth_state || "";
        clearCookie(res, "oauth_state");

        if (
          !code ||
          !returnedState ||
          !expectedState ||
          returnedState !== expectedState
        ) {
          return res.status(400).send("Invalid OAuth state. Please try again.");
        }

        // Token exchange (tolerant of Discord rate limits).
        // Rationale: Discord may occasionally apply short-lived global 429s per app/IP.
        // Previously we bailed out when retry-after > 2s, which blocks first-time logins.
        const redirectUri = getRedirectUri(req);
        let tokenJson = null;
        let tokenRes = null;

        // If Discord told us to cool down for a long window, don't hammer /oauth2/token.
        const cooldownSec = oauthCooldownRemainingSec();
        if (cooldownSec > 0) {
          res.setHeader("Retry-After", String(cooldownSec));
          return res
            .status(429)
            .send(
              '<!doctype html><meta charset="utf-8" />' +
                "<title>Rate limited</title>" +
                '<div style="font-family:system-ui;padding:24px;max-width:720px;margin:0 auto">' +
                "<h2>Discord rate limit reached</h2>" +
                "<p>O Discord limitou temporariamente pedidos de login (HTTP 429).</p>" +
                `<p>Tenta novamente daqui a <b>${cooldownSec}</b> segundos.</p>` +
                "</div>",
            );
        }

        for (let attempt = 0; attempt < 4; attempt++) {
          tokenRes = await fetch("https://discord.com/api/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: process.env.DISCORD_OAUTH_CLIENT_ID,
              client_secret: process.env.DISCORD_OAUTH_CLIENT_SECRET,
              grant_type: "authorization_code",
              code,
              redirect_uri: redirectUri,
            }),
          });

          if (tokenRes.status === 429) {
            const body = await tokenRes.json().catch(() => ({}));
            const raHeader = tokenRes.headers.get("retry-after");
            const retryAfterSec = Math.max(
              0,
              Number.isFinite(Number(raHeader)) ? Number(raHeader) : 0,
              Number.isFinite(Number(body && body.retry_after))
                ? Number(body.retry_after)
                : 0,
            );

            // If Discord asks for a long cooldown (minutes), don't spin retries; set a global cooldown.
            if (retryAfterSec >= 10) {
              oauthTokenCooldownUntilMs =
                Date.now() + Math.ceil(retryAfterSec) * 1000;
              console.warn(
                "[OAuth] Token exchange rate limited (429). retryAfterSec=",
                retryAfterSec,
                "cooldown until",
                new Date(oauthTokenCooldownUntilMs).toISOString(),
              );
              res.setHeader("Retry-After", String(Math.ceil(retryAfterSec)));
              return res
                .status(429)
                .send(
                  '<!doctype html><meta charset="utf-8" />' +
                    "<title>Rate limited</title>" +
                    '<div style="font-family:system-ui;padding:24px;max-width:720px;margin:0 auto">' +
                    "<h2>Discord rate limit reached</h2>" +
                    "<p>O Discord limitou temporariamente pedidos de login (HTTP 429).</p>" +
                    `<p>Tenta novamente daqui a <b>${Math.ceil(retryAfterSec)}</b> segundos.</p>` +
                    "</div>",
                );
            }

            const waitSec = Math.min(
              9,
              Math.max(1, Math.ceil(retryAfterSec || 1)),
            );
            console.warn(
              "[OAuth] Token exchange rate limited (429). retryAfterSec=",
              retryAfterSec,
              "waiting",
              waitSec,
              "s",
            );
            await sleep(waitSec * 1000);
            continue;
          }

          tokenJson = await tokenRes.json().catch(() => ({}));
          break;
        }

        if (
          !tokenRes ||
          !tokenRes.ok ||
          !tokenJson ||
          !tokenJson.access_token
        ) {
          console.error(
            "[OAuth] Token exchange failed",
            tokenRes && tokenRes.status,
            tokenJson,
          );
          if (tokenRes && tokenRes.status === 429) {
            // Fall back to a friendly HTML page rather than a raw 429 string.
            return res
              .status(429)
              .send(
                '<!doctype html><meta charset="utf-8" />' +
                  "<title>Rate limited</title>" +
                  '<div style="font-family:system-ui;padding:24px;max-width:720px;margin:0 auto">' +
                  "<h2>Discord rate limit reached</h2>" +
                  "<p>O Discord limitou temporariamente pedidos de login (HTTP 429). Aguarda alguns segundos e volta a tentar.</p>" +
                  '<p><a href="/api/auth/login">Voltar a iniciar login</a></p>' +
                  "</div>",
              );
          }
          return res.status(400).send("Failed to exchange OAuth code.");
        }

        const accessToken = tokenJson.access_token;

        // Fetch user + guilds, retrying once on 429.
        let meRes = null;
        let me = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          meRes = await fetch("https://discord.com/api/users/@me", {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (meRes.status === 429) {
            const ra = Number(meRes.headers.get("retry-after") || 1);
            await sleep(
              Math.min(
                5,
                Math.max(1, Math.ceil(Number.isFinite(ra) ? ra : 1)),
              ) * 1000,
            );
            continue;
          }
          me = await meRes.json().catch(() => ({}));
          break;
        }
        if (!meRes || !meRes.ok || !me || !me.id) {
          console.error("[OAuth] /users/@me failed", meRes && meRes.status, me);
          return res.status(400).send("Failed to fetch Discord user.");
        }

        let guildsRes = null;
        let guilds = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          guildsRes = await fetch("https://discord.com/api/users/@me/guilds", {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (guildsRes.status === 429) {
            const ra = Number(guildsRes.headers.get("retry-after") || 1);
            await sleep(
              Math.min(
                5,
                Math.max(1, Math.ceil(Number.isFinite(ra) ? ra : 1)),
              ) * 1000,
            );
            continue;
          }
          guilds = await guildsRes.json().catch(() => []);
          break;
        }
        if (!guildsRes || !guildsRes.ok || !Array.isArray(guilds)) {
          console.error(
            "[OAuth] /users/@me/guilds failed",
            guildsRes && guildsRes.status,
            guilds,
          );
          return res.status(400).send("Failed to fetch Discord guilds.");
        }

        const client = typeof getClient === "function" ? getClient() : null;
        // IMPORTANT: Do NOT depend on the bot guild cache being ready here.
        // The allow-list is based on Discord OAuth's /users/@me/guilds response.
        // Bot presence is only enforced later during guild selection.
        const botGuildIds =
          client && client.guilds && client.guilds.cache
            ? Array.from(client.guilds.cache.keys()).map(String)
            : null;
        const botGuildInventory =
          isBotOwnerUser(me.id) &&
          client &&
          client.guilds &&
          client.guilds.cache
            ? Array.from(client.guilds.cache.values())
                .map((guild) => ({
                  id: String(guild.id),
                  name: typeof guild.name === "string" ? guild.name : null,
                  icon: typeof guild.icon === "string" ? guild.icon : null,
                  memberCount:
                    typeof guild.memberCount === "number"
                      ? guild.memberCount
                      : null,
                }))
                .slice(0, 200)
            : [];

        const allowedGuilds = guilds
          .filter((g) => g && g.id && isGuildAdministrator(g))
          .map((g) => {
            const botPresent = Array.isArray(botGuildIds)
              ? botGuildIds.includes(String(g.id))
              : null;
            return {
              id: String(g.id),
              name: typeof g.name === "string" ? g.name : null,
              icon: typeof g.icon === "string" ? g.icon : null,
              owner: g.owner === true,
              permissions:
                typeof g.permissions === "string"
                  ? g.permissions
                  : String(g.permissions || ""),
              botPresent,
            };
          })
          .filter((g) => (g.botPresent === null ? true : g.botPresent))
          .slice(0, 200);

        const allowedGuildIds = allowedGuilds.map((g) => g.id);
        const botOwner = isBotOwnerUser(me.id);

        // The bot owner can use global administration without guild access.
        if (allowedGuildIds.length === 0 && !botOwner) {
          clearCookie(res, "dash_token");
          const redirectUrl = `/?oauthError=NO_GUILDS`;
          oauthCodeCache.set(code, {
            exp: nowMs() + 180000,
            redirectUrl,
            token: null,
          });
          return res.redirect(redirectUrl);
        }

        const safeUsername = sanitizeText(me.username || "discord", {
          maxLen: 32,
          stripHtml: true,
        });
        const avatarHash = String(me.avatar || "");
        const userId = String(me.id || "");
        const hasCustomAvatar = /^(?:a_)?[a-f0-9]{8,64}$/i.test(avatarHash);
        const defaultAvatarIndex = /^\d+$/.test(userId)
          ? Number((BigInt(userId) >> 22n) % 6n)
          : null;
        const avatarUrl = hasCustomAvatar
          ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(userId)}/${avatarHash}.${avatarHash.startsWith("a_") ? "gif" : "png"}?size=64`
          : defaultAvatarIndex === null
            ? null
            : `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex}.png`;

        // Guild-scoped operations remain protected by the guild access middleware.
        const perms = botOwner
          ? Object.assign({}, ADMIN_PERMISSIONS || {}, { canManageUsers: true })
          : {};

        const token = jwt.sign(
          {
            t: "oauth",
            sub: String(me.id),
            username: safeUsername,
            avatarUrl,
            role: botOwner ? "BOT_OWNER" : "USER",
            permissions: perms,
            allowedGuildIds,
            allowedGuilds,
            botGuildInventory,
            selectedGuildId: null,
            guildScopeVersion: 2,
            profile: "UNSCOPED",
          },
          JWT_SECRET,
          { expiresIn: "4h" },
        );

        // Persist token server-side (preferred) so the frontend does not depend on localStorage.
        // Note: fetch calls are same-origin, so cookies are automatically sent.

        // If the user only has one guild, auto-select it by minting a scoped token.
        if (allowedGuildIds.length === 1 && !botOwner) {
          const scoped = await mintScopedToken({
            userId: String(me.id),
            username: safeUsername,
            avatarUrl,
            allowedGuildIds,
            allowedGuilds,
            guildId: allowedGuildIds[0],
          }).catch(() => null);
          if (scoped) {
            setCookie(res, "dash_token", scoped, {
              httpOnly: true,
              sameSite: "Lax",
              secure: isSecureRequest(req),
              maxAge: 4 * 60 * 60,
            });
            const redirectUrl = `/?selectGuild=0`;
            oauthCodeCache.set(code, {
              exp: nowMs() + 180000,
              redirectUrl,
              token: scoped,
            });
            return res.redirect(redirectUrl);
          }
        }

        setCookie(res, "dash_token", token, {
          httpOnly: true,
          sameSite: "Lax",
          secure: isSecureRequest(req),
          maxAge: 4 * 60 * 60,
        });
        const redirectUrl = `/?selectGuild=1`;
        oauthCodeCache.set(code, { exp: nowMs() + 180000, redirectUrl, token });
        return res.redirect(redirectUrl);
      } finally {
        oauthInflight.delete(lk);
      }
    } catch (err) {
      console.error("[OAuth] Callback error", err);
      return res.status(500).send("OAuth callback failed.");
    }
  });

  async function mintScopedToken({
    userId,
    username,
    avatarUrl,
    allowedGuildIds,
    allowedGuilds,
    botGuildInventory,
    guildId,
  }) {
    const gid = sanitizeId(guildId);
    if (!gid) return null;
    const allowed = Array.isArray(allowedGuildIds)
      ? allowedGuildIds.map(String)
      : [];
    if (!allowed.includes(String(gid))) return null;

    // Bot presence is required for scoped dashboard operations.
    const client = typeof getClient === "function" ? getClient() : null;
    const guild = getGuild(client, gid);
    if (!guild) return null;

    const botOwner = isBotOwnerUser(userId);

    // Guild-scoped tokens are available only when the user administers the guild.
    const meta = Array.isArray(allowedGuilds)
      ? allowedGuilds.find((g) => g && String(g.id) === String(gid))
      : null;
    if (!isGuildAdministrator(meta)) return null;

    const profile = botOwner ? "BOT_OWNER" : "GUILD_ADMIN";
    const role = profile;

    const perms = Object.assign({}, ADMIN_PERMISSIONS || {}, {
      canManageUsers: botOwner,
    });

    return jwt.sign(
      {
        t: "oauth",
        sub: String(userId),
        username: sanitizeText(username || "discord", {
          maxLen: 32,
          stripHtml: true,
        }),
        avatarUrl: typeof avatarUrl === "string" ? avatarUrl : null,
        role,
        permissions: perms,
        allowedGuildIds: allowed.slice(0, 200),
        allowedGuilds: Array.isArray(allowedGuilds)
          ? allowedGuilds.slice(0, 200)
          : [],
        selectedGuildId: gid,
        botGuildInventory: Array.isArray(botGuildInventory)
          ? botGuildInventory
          : [],
        guildScopeVersion: 2,
        profile,
      },
      JWT_SECRET,
      { expiresIn: "4h" },
    );
  }

  const rlSelect = rateLimit({
    windowMs: 60_000,
    max: 30,
    keyPrefix: "rl:auth:select:",
  });
  app.post(
    "/api/auth/select-guild",
    requireDashboardAuth,
    express.json(),
    rlSelect,
    async (req, res) => {
      try {
        const u = req.dashboardUser;
        const rawGid = req.body && req.body.guildId ? req.body.guildId : "";
        const gid = sanitizeId(rawGid);
        if (!gid)
          return res.status(400).json({ ok: false, error: "MISSING_GUILD_ID" });

        const allowed = Array.isArray(u.allowedGuildIds)
          ? u.allowedGuildIds.map(String)
          : [];
        // If the token has no allow-list, force re-auth (prevents selecting arbitrary guilds due to stale tokens).
        if (!allowed.length) {
          return res.status(401).json({ ok: false, error: "REAUTH_REQUIRED" });
        }

        if (!allowed.includes(String(gid))) {
          return res.status(403).json({ ok: false, error: "NO_GUILD_ACCESS" });
        }

        // Enforce bot presence for the selected guild.
        // We allow listing guilds even if the bot is not installed, but selection for dashboard operations
        // requires the bot to be present.
        try {
          const client = typeof getClient === "function" ? getClient() : null;
          const hasGuild =
            client &&
            client.guilds &&
            client.guilds.cache &&
            client.guilds.cache.has(String(gid));
          if (!hasGuild) {
            return res
              .status(409)
              .json({ ok: false, error: "BOT_NOT_INSTALLED" });
          }
        } catch {}

        const token = await mintScopedToken({
          userId: String(u._id || u.sub || u.id || u.userId || ""),
          username: u.username || "discord",
          avatarUrl: u.avatarUrl || null,
          allowedGuildIds: allowed,
          allowedGuilds: Array.isArray(u.allowedGuilds) ? u.allowedGuilds : [],
          botGuildInventory: Array.isArray(u.botGuildInventory)
            ? u.botGuildInventory
            : [],
          guildId: gid,
        });

        if (!token) {
          return res.status(403).json({ ok: false, error: "NO_GUILD_ACCESS" });
        }

        // Persist server-side cookie so the UI continues to work even if storage is blocked.
        setCookie(res, "dash_token", token, {
          httpOnly: true,
          sameSite: "Lax",
          secure: isSecureRequest(req),
          maxAge: 4 * 60 * 60,
        });
        return res.json({ ok: true, token });
      } catch (err) {
        console.error("[OAuth] select-guild error", err);
        return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
      }
    },
  );

  app.post(
    "/api/auth/global",
    requireDashboardAuth,
    express.json(),
    rlSelect,
    async (req, res) => {
      const user = req.dashboardUser;
      if (!user || !isBotOwnerUser(user._id)) {
        return res.status(403).json({ ok: false, error: "BOT_OWNER_REQUIRED" });
      }

      const token = jwt.sign(
        {
          t: "oauth",
          sub: String(user._id),
          username: sanitizeText(user.username || "discord", {
            maxLen: 32,
            stripHtml: true,
          }),
          avatarUrl: user.avatarUrl || null,
          role: "BOT_OWNER",
          permissions: Object.assign({}, ADMIN_PERMISSIONS || {}, {
            canManageUsers: true,
          }),
          allowedGuildIds: Array.isArray(user.allowedGuildIds)
            ? user.allowedGuildIds
            : [],
          allowedGuilds: Array.isArray(user.allowedGuilds)
            ? user.allowedGuilds
            : [],
          botGuildInventory: Array.isArray(user.botGuildInventory)
            ? user.botGuildInventory
            : [],
          selectedGuildId: null,
          guildScopeVersion: 2,
          profile: "UNSCOPED",
        },
        JWT_SECRET,
        { expiresIn: "4h" },
      );
      setCookie(res, "dash_token", token, {
        httpOnly: true,
        sameSite: "Lax",
        secure: isSecureRequest(req),
        maxAge: 4 * 60 * 60,
      });
      return res.json({ ok: true });
    },
  );

  app.get("/api/auth/me", requireDashboardAuth, async (req, res) => {
    const u = req.dashboardUser;
    if (!u) return res.status(401).json({ ok: false, error: "NO_USER" });
    return res.json({
      ok: true,
      user: {
        id: u._id || null,
        username: u.username || "discord",
        avatarUrl: u.avatarUrl || null,
        role: u.role || "USER",
        permissions: u.permissions || {},
        allowedGuildIds: Array.isArray(u.allowedGuildIds)
          ? u.allowedGuildIds
          : [],
        botGuildInventory: Array.isArray(u.botGuildInventory)
          ? u.botGuildInventory
          : [],
        selectedGuildId: u.selectedGuildId || null,
        guildScopeVersion: u.guildScopeVersion || null,
        profile: u.profile || null,
        oauth: true,
      },
    });
  });

  // Logout: clear auth cookies so the user can recover from stale tokens without manual cookie deletion.
  const rlLogout = rateLimit({
    windowMs: 60_000,
    max: 20,
    keyPrefix: "rl:auth:logout:",
  });
  app.post("/api/auth/logout", rlLogout, (req, res) => {
    try {
      clearCookie(res, "dash_token");
      clearCookie(res, "oauth_state");
    } catch {}
    return res.json({ ok: true });
  });

  // Convenience GET for simple button links (still rate limited).
  app.get("/api/auth/logout", rlLogout, (req, res) => {
    try {
      clearCookie(res, "dash_token");
      clearCookie(res, "oauth_state");
    } catch {}
    return res.redirect("/");
  });
}

module.exports = { registerAuthRoutes };
