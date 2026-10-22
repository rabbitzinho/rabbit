// src/services/discordFetchCache.js
//
// TTL cache + in-flight deduplication for Discord REST fetches.
// Keeps the bot responsive under load and reduces REST / rate-limit pressure.

/** @typedef {{ value: any, expiresAt: number }} CacheEntry */

const DEFAULTS = {
  channelTtlMs: 60_000,
  memberTtlMs: 30_000,
  guildTtlMs: 60_000,
};

/** @type {Map<string, CacheEntry>} */
const cache = new Map();

/** @type {Map<string, Promise<any>>} */
const inflight = new Map();
// Prevent unbounded memory growth: expired entries are only removed on read,
// so we run a small periodic sweep and enforce a hard cap.
const MAX_ENTRIES = 5000;
const GC_INTERVAL_MS = 60_000;
let _gcStarted = false;

function sweepExpired() {
  const t = now();
  for (const [k, entry] of cache.entries()) {
    if (!entry || typeof entry.expiresAt !== "number" || entry.expiresAt <= t) {
      cache.delete(k);
    }
  }

  // Hard cap: drop oldest entries (Map keeps insertion order).
  if (cache.size > MAX_ENTRIES) {
    const overflow = cache.size - MAX_ENTRIES;
    let i = 0;
    for (const k of cache.keys()) {
      cache.delete(k);
      i++;
      if (i >= overflow) break;
    }
  }
}

function startGcOnce() {
  if (_gcStarted) return;
  _gcStarted = true;
  const timer = setInterval(sweepExpired, GC_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
}

function now() {
  return Date.now();
}

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value, ttlMs) {
  startGcOnce();
  cache.set(key, { value, expiresAt: now() + Math.max(0, ttlMs || 0) });
  if (cache.size > MAX_ENTRIES) sweepExpired();
}

async function cached(key, ttlMs, fetcher) {
  startGcOnce();
  const hit = getCache(key);
  if (hit) return hit;

  const running = inflight.get(key);
  if (running) return running;

  const p = (async () => {
    try {
      const v = await fetcher();
      if (v) setCache(key, v, ttlMs);
      return v || null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

function invalidatePrefix(prefix) {
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

async function fetchGuild(client, guildId, opts = {}) {
  const ttlMs = Number(opts.ttlMs ?? DEFAULTS.guildTtlMs);
  const key = `guild:${guildId}`;
  return cached(key, ttlMs, async () => {
    const g = client.guilds.cache.get(guildId) || null;
    if (g) return g;
    // guilds.fetch exists but requires privileged; keep safe.
    return null;
  });
}

async function fetchChannel(client, channelId, opts = {}) {
  const ttlMs = Number(opts.ttlMs ?? DEFAULTS.channelTtlMs);
  const key = `channel:${channelId}`;
  return cached(key, ttlMs, async () => {
    const c = client.channels.cache.get(channelId) || null;
    if (c) return c;
    return client.channels.fetch(channelId).catch(() => null);
  });
}

async function fetchMember(guild, userId, opts = {}) {
  const ttlMs = Number(opts.ttlMs ?? DEFAULTS.memberTtlMs);
  const key = `member:${guild.id}:${userId}`;
  return cached(key, ttlMs, async () => {
    const m = guild.members.cache.get(userId) || null;
    if (m) return m;
    return guild.members.fetch(userId).catch(() => null);
  });
}

module.exports = {
  fetchGuild,
  fetchChannel,
  fetchMember,
  invalidatePrefix,
  DEFAULTS,
};
