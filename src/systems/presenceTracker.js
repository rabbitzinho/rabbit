// src/systems/presenceTracker.js
//
// Tracks user presence sessions (online/idle/dnd) into Mongo.
// Used by the dashboard "Top Online" panel.

let started = false;

function nowDate() {
  return new Date();
}

function statusOf(presence) {
  const s =
    presence && typeof presence.status === "string"
      ? presence.status
      : "offline";
  return s || "offline";
}

async function closeOpenSessions(
  PresenceSession,
  guildId,
  userId,
  endAt,
  lastStatus,
) {
  try {
    await PresenceSession.updateMany(
      { guildId, userId, endAt: null },
      { $set: { endAt, lastStatus: lastStatus || "offline" } },
    ).exec();
  } catch {
    // ignore
  }
}

async function openSession(PresenceSession, guildId, user, status) {
  const endAt = nowDate();
  await closeOpenSessions(PresenceSession, guildId, user.id, endAt, status);

  try {
    await PresenceSession.create({
      guildId,
      userId: user.id,
      isBot: Boolean(user.bot),
      startAt: endAt,
      lastStatus: status || "online",
    });
  } catch (e) {
    // If a session already exists (race), just ignore.
    if (e && e.code === 11000) return;
    throw e;
  }
}

async function updateLastStatus(PresenceSession, guildId, userId, status) {
  try {
    await PresenceSession.updateMany(
      { guildId, userId, endAt: null },
      { $set: { lastStatus: status } },
    ).exec();
  } catch {
    // ignore
  }
}

async function bootstrapGuild(client, guild, PresenceSession) {
  try {
    // Best-effort: fetch members with presences (may fail on large guilds).
    const members = await guild.members
      .fetch({ withPresences: true })
      .catch(() => null);
    if (!members) return;

    const ts = nowDate();
    const ops = [];

    members.forEach((m) => {
      try {
        if (!m || !m.user || m.user.bot) return;
        const st = statusOf(m.presence);
        if (st === "offline") return;
        ops.push({ guildId: guild.id, user: m.user, status: st });
      } catch {}
    });

    // Open sessions for those currently online.
    for (const it of ops) {
      try {
        // Close any existing open sessions then open a fresh one (restart-safe).
        await closeOpenSessions(
          PresenceSession,
          it.guildId,
          it.user.id,
          ts,
          it.status,
        );
        await PresenceSession.create({
          guildId: it.guildId,
          userId: it.user.id,
          isBot: Boolean(it.user.bot),
          startAt: ts,
          lastStatus: it.status,
        }).catch((e) => {
          if (e && e.code === 11000) return;
          throw e;
        });
      } catch {}
    }
  } catch {
    // ignore bootstrap errors
  }
}

function startPresenceTracker(client, opts = {}) {
  if (started) return;
  started = true;

  let PresenceSession = null;
  try {
    PresenceSession = require("../database/models/PresenceSession");
  } catch (e) {
    console.warn(
      "[Presence] PresenceSession model not available:",
      e?.message || e,
    );
    return;
  }

  const bootstrap = opts.bootstrapOnReady !== false;

  // Track updates
  client.on("presenceUpdate", async (oldPresence, newPresence) => {
    try {
      const presence = newPresence || oldPresence;
      const guildId = presence?.guild?.id;
      const user = presence?.user;
      if (!guildId || !user || user.bot) return;

      const oldStatus = statusOf(oldPresence);
      const newStatus = statusOf(newPresence);

      if (oldStatus === "offline" && newStatus !== "offline") {
        await openSession(PresenceSession, guildId, user, newStatus);
        return;
      }

      if (oldStatus !== "offline" && newStatus === "offline") {
        await closeOpenSessions(
          PresenceSession,
          guildId,
          user.id,
          nowDate(),
          "offline",
        );
        return;
      }

      if (newStatus !== "offline") {
        await updateLastStatus(PresenceSession, guildId, user.id, newStatus);
      }
    } catch {
      // ignore
    }
  });

  // Best-effort bootstrap on ready (helps after restarts)
  if (bootstrap) {
    client.once("clientReady", async () => {
      try {
        for (const guild of client.guilds.cache.values()) {
          await bootstrapGuild(client, guild, PresenceSession);
        }
      } catch {
        // ignore
      }
    });
  }

  console.log("[Presence] Presence tracker started");
}

module.exports = { startPresenceTracker };
