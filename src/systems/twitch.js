const { EmbedBuilder } = require("discord.js");
const { getFeature } = require("./featuresService");
const { getGuildLang } = require("./i18n");

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_STREAMS_URL = "https://api.twitch.tv/helix/streams";
const FETCH_TIMEOUT_MS = 10_000;
const SCHEDULER_MS = 30_000;
const ERROR_LOG_INTERVAL_MS = 5 * 60_000;

const streamStates = new Map();
const errorLogTimes = new Map();
const streamCache = new Map();
let tokenCache = null;
let scheduler = null;

function normalizeStreamerName(value) {
  const login = String(value || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  return /^[a-z0-9_]{1,25}$/.test(login) ? login : "";
}

function hasNewLiveStream(previous, login, streamId) {
  return (
    !!streamId &&
    !!previous &&
    previous.login === login &&
    previous.streamId !== streamId
  );
}

function createServiceError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

async function requestJson(url, options, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  if (typeof timeout.unref === "function") timeout.unref();
  try {
    const response = await (fetchImpl || fetch)(url, {
      ...options,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function getAppToken(fetchImpl) {
  const clientId = String(process.env.TWITCH_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.TWITCH_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    throw createServiceError(
      "TWITCH_CREDENTIALS_MISSING",
      "Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET",
    );
  }

  if (
    tokenCache &&
    tokenCache.clientId === clientId &&
    tokenCache.expiresAt > Date.now()
  ) {
    return tokenCache.value;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });
  const { response, body: data } = await requestJson(
    TWITCH_TOKEN_URL,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    },
    fetchImpl,
  );

  if (!response.ok || !data || !data.access_token) {
    throw createServiceError(
      "TWITCH_AUTH_FAILED",
      `Twitch OAuth returned HTTP ${response.status}`,
    );
  }

  tokenCache = {
    clientId,
    value: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in) - 60) * 1000,
  };
  return tokenCache.value;
}

async function fetchLiveStream(streamerName, options) {
  const login = normalizeStreamerName(streamerName);
  if (!login)
    throw createServiceError(
      "TWITCH_STREAMER_INVALID",
      "Enter a valid Twitch username",
    );

  const cached = streamCache.get(login);
  if (cached && cached.expiresAt > Date.now()) return cached.stream;

  const fetchImpl = options && options.fetchImpl;
  const clientId = String(process.env.TWITCH_CLIENT_ID || "").trim();
  const token = await getAppToken(fetchImpl);
  const url = new URL(TWITCH_STREAMS_URL);
  url.searchParams.set("user_login", login);

  let result = await requestJson(
    url,
    {
      headers: { "Client-Id": clientId, Authorization: `Bearer ${token}` },
    },
    fetchImpl,
  );

  if (result.response.status === 401) {
    tokenCache = null;
    const refreshed = await getAppToken(fetchImpl);
    result = await requestJson(
      url,
      {
        headers: {
          "Client-Id": clientId,
          Authorization: `Bearer ${refreshed}`,
        },
      },
      fetchImpl,
    );
  }

  if (!result.response.ok || !result.body || !Array.isArray(result.body.data)) {
    throw createServiceError(
      "TWITCH_API_FAILED",
      `Twitch Helix returned HTTP ${result.response.status}`,
    );
  }

  const stream = result.body.data[0] || null;
  streamCache.set(login, {
    stream,
    expiresAt: Date.now() + SCHEDULER_MS - 1000,
  });
  return stream;
}

async function sendLiveNotification(channel, config, stream, lang) {
  const login = normalizeStreamerName(config.streamerName);
  const roleId = String(config.roleId || "").trim();
  const title = lang === "pt" ? `${login} está em direto` : `${login} is live`;
  const roleMention = roleId ? `<@&${roleId}> ` : "";
  const thumbnail = String(stream.thumbnail_url || "")
    .replace("{width}", "1280")
    .replace("{height}", "720");
  const embed = new EmbedBuilder()
    .setColor("#9146ff")
    .setTitle(title)
    .setURL(`https://www.twitch.tv/${login}`)
    .setDescription(
      String(stream.title || "").slice(0, 4000) ||
        (lang === "pt" ? "Novo direto." : "New livestream."),
    )
    .addFields(
      {
        name: lang === "pt" ? "Categoria" : "Category",
        value: String(stream.game_name || "—").slice(0, 100),
        inline: true,
      },
      {
        name: lang === "pt" ? "A ver" : "Viewers",
        value: String(Number(stream.viewer_count) || 0),
        inline: true,
      },
    )
    .setTimestamp(stream.started_at ? new Date(stream.started_at) : new Date());
  if (/^https:\/\//i.test(thumbnail)) embed.setImage(thumbnail);

  await channel.send({
    content: roleMention,
    embeds: [embed],
    allowedMentions: { parse: [], roles: roleId ? [roleId] : [] },
  });
}

async function checkGuild(client, guild) {
  const config = await getFeature(guild.id, "twitch");
  const login = normalizeStreamerName(config && config.streamerName);
  if (!config || config.enabled !== true || !login || !config.channelId) {
    streamStates.delete(guild.id);
    errorLogTimes.delete(guild.id);
    return;
  }

  const stream = await fetchLiveStream(login);
  const streamId = stream && stream.id ? String(stream.id) : null;
  const previous = streamStates.get(guild.id);

  if (!previous || previous.login !== login) {
    streamStates.set(guild.id, { login, streamId });
    return;
  }
  if (!streamId) {
    streamStates.set(guild.id, { login, streamId: null });
    return;
  }
  if (!hasNewLiveStream(previous, login, streamId)) return;

  const channel = await client.channels
    .fetch(config.channelId)
    .catch(() => null);
  if (!channel || typeof channel.send !== "function") {
    throw createServiceError(
      "TWITCH_CHANNEL_UNAVAILABLE",
      "Configured Discord channel is unavailable",
    );
  }
  const lang = await getGuildLang(guild.id).catch(() => "pt");
  await sendLiveNotification(channel, config, stream, lang);
  streamStates.set(guild.id, { login, streamId });
  errorLogTimes.delete(guild.id);
}

async function tick(client) {
  const guilds = client && client.guilds && client.guilds.cache;
  if (!guilds) return;
  for (const guild of guilds.values()) {
    try {
      await checkGuild(client, guild);
    } catch (err) {
      const lastLoggedAt = errorLogTimes.get(guild.id) || 0;
      if (Date.now() - lastLoggedAt >= ERROR_LOG_INTERVAL_MS) {
        console.warn(
          `[Twitch] Failed to check "${guild.name}":`,
          err?.message || err,
        );
        errorLogTimes.set(guild.id, Date.now());
      }
    }
  }
}

function startTwitch(client) {
  if (scheduler) return { client, tick: () => tick(client) };
  const run = () =>
    tick(client).catch((err) =>
      console.error("[Twitch] Scheduler tick failed:", err),
    );
  setTimeout(run, 15_000).unref?.();
  scheduler = setInterval(run, SCHEDULER_MS);
  scheduler.unref?.();
  return { client, tick: () => tick(client) };
}

module.exports = {
  startTwitch,
  normalizeStreamerName,
  hasNewLiveStream,
  fetchLiveStream,
  sendLiveNotification,
  tick,
};
