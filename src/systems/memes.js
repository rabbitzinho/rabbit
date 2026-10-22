const { EmbedBuilder } = require("discord.js");
const { getFeature } = require("./featuresService");

const MEME_API_URL = "https://meme-api.com/gimme/wholesomememes";
const FETCH_TIMEOUT_MS = 10_000;
const SCHEDULER_MS = 30_000;
const MIN_INTERVAL_MINUTES = 15;
const MAX_INTERVAL_MINUTES = 1440;

const nextRuns = new Map();
const recentPosts = new Map();
const sendingGuilds = new Set();
let scheduler = null;

function normalizeMeme(data) {
  if (
    !data ||
    typeof data !== "object" ||
    data.nsfw !== false ||
    data.spoiler === true
  )
    return null;

  let imageUrl;
  let postUrl;
  try {
    imageUrl = new URL(String(data.url || ""));
    postUrl = new URL(String(data.postLink || ""));
  } catch {
    return null;
  }

  const allowedImageHosts = new Set(["i.redd.it", "preview.redd.it"]);
  const allowedPostHosts = new Set(["redd.it", "reddit.com", "www.reddit.com"]);
  if (
    imageUrl.protocol !== "https:" ||
    !allowedImageHosts.has(imageUrl.hostname)
  )
    return null;
  if (postUrl.protocol !== "https:" || !allowedPostHosts.has(postUrl.hostname))
    return null;
  if (!/\.(png|jpe?g|gif|webp)$/i.test(imageUrl.pathname)) return null;

  const title = String(data.title || "")
    .replace(/@/g, "")
    .trim()
    .slice(0, 250);
  if (!title) return null;
  const author =
    String(data.author || "reddit")
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 40) || "reddit";

  return {
    id: postUrl.href,
    title,
    imageUrl: imageUrl.href,
    postUrl: postUrl.href,
    author,
  };
}

async function fetchMeme(fetchImpl) {
  const request = fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  if (typeof timeout.unref === "function") timeout.unref();

  try {
    const response = await request(MEME_API_URL, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(`Meme API returned HTTP ${response.status}`);
    const meme = normalizeMeme(await response.json());
    if (!meme)
      throw new Error(
        "Meme API returned content that failed safety validation",
      );
    return meme;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendMemePayload(channel, meme) {
  const embed = new EmbedBuilder()
    .setColor("#2f9e75")
    .setTitle(meme.title)
    .setURL(meme.postUrl)
    .setImage(meme.imageUrl)
    .setFooter({ text: `r/wholesomememes • u/${meme.author}` });
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  return meme;
}

async function sendMeme(channel, fetchImpl) {
  return sendMemePayload(channel, await fetchMeme(fetchImpl));
}

async function checkGuild(client, guild) {
  const config = await getFeature(guild.id, "memes");
  if (!config || config.enabled !== true || !config.channelId) {
    nextRuns.delete(guild.id);
    return;
  }

  const intervalMinutes = Math.max(
    MIN_INTERVAL_MINUTES,
    Math.min(MAX_INTERVAL_MINUTES, Number(config.intervalMinutes) || 60),
  );
  const intervalMs = intervalMinutes * 60_000;
  const state = nextRuns.get(guild.id);
  const now = Date.now();
  if (!state || state.intervalMs !== intervalMs) {
    nextRuns.set(guild.id, { intervalMs, nextAt: now + intervalMs });
    return;
  }
  if (state.nextAt > now || sendingGuilds.has(guild.id)) return;

  state.nextAt = now + intervalMs;
  sendingGuilds.add(guild.id);
  try {
    const channel = await client.channels
      .fetch(config.channelId)
      .catch(() => null);
    if (!channel || typeof channel.send !== "function")
      throw new Error(
        "Configured channel is unavailable or cannot send messages",
      );
    const meme = await fetchMeme();
    if (recentPosts.get(guild.id) === meme.id) return;
    await sendMemePayload(channel, meme);
    recentPosts.set(guild.id, meme.id);
  } catch (err) {
    console.warn(
      `[Memes] Failed to send a meme for "${guild.name}":`,
      err?.message || err,
    );
  } finally {
    sendingGuilds.delete(guild.id);
  }
}

async function tick(client) {
  const guilds = client && client.guilds && client.guilds.cache;
  if (!guilds) return;
  for (const guild of guilds.values()) {
    try {
      await checkGuild(client, guild);
    } catch (err) {
      console.warn(
        `[Memes] Scheduler failed for "${guild.name}":`,
        err?.message || err,
      );
    }
  }
}

function startMemes(client) {
  if (scheduler) return { client, tick: () => tick(client) };
  const run = () =>
    tick(client).catch((err) =>
      console.error("[Memes] Scheduler tick failed:", err),
    );
  setTimeout(run, 15_000).unref?.();
  scheduler = setInterval(run, SCHEDULER_MS);
  scheduler.unref?.();
  return { client, tick: () => tick(client) };
}

module.exports = { startMemes, normalizeMeme, fetchMeme, sendMeme, tick };
