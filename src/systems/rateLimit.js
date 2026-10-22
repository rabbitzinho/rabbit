// src/systems/rateLimit.js

// Pequeno rate limit em memória, por IP
// NOTA: se usares muitos processos / múltiplas instâncias, idealmente usavas Redis.
// Para 1 instância (Koyeb, etc) isto chega bem.

const buckets = new Map();

// Prevent unbounded memory growth (e.g. many unique IPs / keys).
// We keep a simple TTL-based GC; for multi-instance deployments you'd move this to Redis.
const GC_INTERVAL_MS = 60_000;
const STALE_AFTER_MS = 30 * 60_000;

let _gcStarted = false;
function startGcOnce() {
  if (_gcStarted) return;
  _gcStarted = true;

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
      const last =
        bucket && typeof bucket.lastSeen === "number"
          ? bucket.lastSeen
          : bucket?.start;
      if (!last) continue;
      if (now - last > STALE_AFTER_MS) buckets.delete(key);
    }
  }, GC_INTERVAL_MS);

  // Don't keep the process alive just because of the GC timer.
  if (typeof timer.unref === "function") timer.unref();
}

/**
 * options:
 *  - windowMs: janela de tempo em ms (ex: 60_000 = 1 min)
 *  - max: número máximo de requests nessa janela
 */
function rateLimit(options = {}) {
  startGcOnce();
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 120;
  const keyPrefix = options.keyPrefix ?? "rl:";

  return (req, res, next) => {
    const now = Date.now();

    // Use Express's req.ip. When "trust proxy" is enabled (recommended on Koyeb),
    // Express safely derives the client IP from X-Forwarded-For.
    // Avoid manually parsing XFF, which can be spoofed when trust proxy is off.
    let ip =
      typeof req.ip === "string" && req.ip
        ? req.ip
        : req.socket?.remoteAddress ||
          req.connection?.remoteAddress ||
          "unknown";
    if (ip.startsWith("::ffff:")) ip = ip.slice(7);

    // IMPORTANT: Include a prefix so each endpoint can have its own bucket.
    // Otherwise different endpoints share the same counter and trigger false 429s.
    const bucketKey = `${keyPrefix}${ip}`;

    let bucket = buckets.get(bucketKey);

    if (!bucket) {
      bucket = { count: 1, start: now, lastSeen: now };
      buckets.set(bucketKey, bucket);
      return next();
    }

    bucket.lastSeen = now;

    // se a janela expirou, recomeça
    if (now - bucket.start > windowMs) {
      bucket.count = 1;
      bucket.start = now;
      return next();
    }

    // ainda dentro da janela
    if (bucket.count >= max) {
      return res.status(429).json({
        ok: false,
        error: "Too many requests",
        retryAfterMs: windowMs - (now - bucket.start),
      });
    }

    bucket.count++;
    next();
  };
}

module.exports = rateLimit;
