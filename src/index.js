// src/index.js
//
// Main entry point: connects to Mongo, starts Discord client and dashboard,
// and orchestrates all "ready" logic in a single place.

require("dotenv").config();
require("./systems/errorGuard")();

const status = require("./systems/status");
const config = require("./config/defaultConfig");

const mongoose = require("./database/connect");
const client = require("./bot");

// Attach core event handlers
require("./events/messageCreate")(client);
require("./events/guildMemberAdd")(client);
require("./events/guildMemberRemove")(client);
require("./events/guildCreate")(client);
require("./events/guildDelete")(client);
require("./events/interactionCreate")(client);
require("./events/messageReactionAdd")(client);
require("./events/messageReactionRemove")(client);
require("./events/messageUpdate")(client);
require("./events/messageDelete")(client);
require("./events/voiceStateUpdate.tempVoice")(client);
require("./events/voiceStateUpdate.serverStats")(client);
require("./events/channelLifecycle.serverStats")(client);

// Dashboard (Express)
const dashboard = require("./dashboard");

// Allow dashboard to access the Discord client (for guild list, log tests, etc.)
if (typeof dashboard.setClient === "function") {
  dashboard.setClient(client);
}

// Slash command registration
const registerSlashCommands = require("./slash/register");

// Maintenance & background systems
const { startMaintenance } = require("./systems/maintenance");
const startGameNews = require("./systems/gamenews");
const startGiveaways = require("./systems/giveaways");
const { startMemes } = require("./systems/memes");
const { startTwitch } = require("./systems/twitch");
const { startServerStats } = require("./systems/serverStats");
const { startPresenceTracker } = require("./systems/presenceTracker");
const { startVerificationSweep } = require("./systems/verification");
const { startTemporaryBanScheduler } = require("./systems/temporaryBans");

// Ensure critical MongoDB indexes (autoIndex is disabled in production).
async function ensureMongoIndexes() {
  try {
    if (!mongoose || !mongoose.connection) return;
    if (mongoose.connection.readyState !== 1) return;

    // Require models lazily to avoid circular deps
    const models = [];
    const safeRequire = (p) => {
      try {
        return require(p);
      } catch {
        return null;
      }
    };

    const Ticket = safeRequire("./database/models/Ticket");
    const TicketCounter = safeRequire("./database/models/TicketCounter");
    const TicketLog = safeRequire("./database/models/TicketLog");
    const Infraction = safeRequire("./database/models/Infraction");
    const DashboardLog = safeRequire("./database/models/DashboardLog");
    const DashboardAudit = safeRequire("./database/models/DashboardAudit");
    const User = safeRequire("./database/models/User");
    const UserActivity = safeRequire("./database/models/UserActivity");
    const PresenceSession = safeRequire("./database/models/PresenceSession");
    const TemporaryBan = safeRequire("./database/models/TemporaryBan");
    const GameNewsFeed = safeRequire("./database/models/GameNewsFeed");
    const GameNews = safeRequire("./database/models/GameNews");
    const GiveawayPost = safeRequire("./database/models/GiveawayPost");
    const Level = safeRequire("./database/models/Level");
    const StarboardEntry = safeRequire("./database/models/StarboardEntry");
    const Poll = safeRequire("./database/models/Poll");
    const MemberStat = safeRequire("./database/models/MemberStat");
    const PremiumPayment = safeRequire("./database/models/PremiumPayment");
    const PremiumSettings = safeRequire("./database/models/PremiumSettings");

    [
      Ticket,
      TicketCounter,
      TicketLog,
      Infraction,
      DashboardLog,
      DashboardAudit,
      User,
      UserActivity,
      PresenceSession,
      TemporaryBan,
      GameNewsFeed,
      GameNews,
      GiveawayPost,
      Level,
      StarboardEntry,
      Poll,
      MemberStat,
      PremiumPayment,
      PremiumSettings,
    ]
      .filter(Boolean)
      .forEach((m) => models.push(m));

    // Clean legacy infractions with caseId:null so partial index behaves predictably.
    try {
      if (Infraction) {
        await Infraction.updateMany(
          { caseId: null },
          { $unset: { caseId: 1 } },
        );

        // Drop legacy unique index (without partialFilterExpression) that breaks when caseId is missing/null
        try {
          const idx = await Infraction.collection.indexes();
          const legacy = (idx || []).find(
            (i) =>
              i &&
              i.name === "guildId_1_caseId_1" &&
              !i.partialFilterExpression,
          );
          if (legacy) {
            await Infraction.collection.dropIndex("guildId_1_caseId_1");
          }
        } catch {}
      }
    } catch {}

    // PresenceSession: migrate open sessions to endAt:null and drop legacy partial index, then ensure indexes.
    try {
      if (PresenceSession) {
        await PresenceSession.updateMany(
          { endAt: { $exists: false } },
          { $set: { endAt: null } },
        ).catch(() => null);

        // Drop legacy unique index name (created by older schema) if present; it may block new partial index.
        try {
          const idx = await PresenceSession.collection.indexes();
          const legacy = (idx || []).find(
            (i) => i && i.name === "guildId_1_userId_1",
          );
          if (legacy) {
            await PresenceSession.collection.dropIndex("guildId_1_userId_1");
          }
        } catch {}
      }
    } catch {}

    for (const m of models) {
      try {
        if (typeof m.ensureIndexes === "function") {
          await m.ensureIndexes();
        }
      } catch (e) {
        console.warn(
          `[Mongo] Failed to ensure indexes for ${m?.modelName || "unknown"}:`,
          e?.message || e,
        );
      }
    }

    console.log("🧱 MongoDB indexes ensured.");
  } catch (err) {
    console.warn("[Mongo] ensureMongoIndexes error:", err?.message || err);
  }
}

// -----------------------------
// Mongo status wiring
// -----------------------------
if (mongoose && mongoose.connection) {
  const conn = mongoose.connection;

  // Initial state (in case we're already connected)
  status.setMongoConnected(conn.readyState === 1);
  if (conn.readyState === 1) {
    status.setMongoConnected(true);
    ensureMongoIndexes().catch(() => null);
  }

  conn.on("connected", () => {
    status.setMongoConnected(true);
    // Best-effort index creation after connect
    ensureMongoIndexes().catch(() => null);
  });

  conn.on("disconnected", () => {
    status.setMongoConnected(false);
  });

  conn.on("error", () => {
    status.setMongoConnected(false);
  });
}

// -----------------------------
// Orchestrated Discord "ready"
// -----------------------------

let startupDone = false;

async function handleClientReady() {
  if (startupDone) return;
  startupDone = true;

  try {
    status.setDiscordReady(true);
    console.log(
      `✅ Discord client logged in as ${client.user?.tag || client.user?.id || "unknown user"}`,
    );

    // Start presence tracker (Top Online)
    try {
      startPresenceTracker(client, config?.presenceTracker || {});
    } catch (err) {
      console.error("[Startup] Failed to start presence tracker:", err);
    }

    // Start verification sweep (expulsa membros não verificados)
    try {
      startVerificationSweep(client);
      console.log("🛡️ Verification sweep started.");
    } catch (err) {
      console.error("[Startup] Failed to start verification sweep:", err);
    }

    // Register slash commands (if enabled)
    try {
      await registerSlashCommands(client);
    } catch (err) {
      console.error("[Startup] Failed to register slash commands:", err);
    }

    // Start maintenance scheduler (infractions / dashboard logs cleanup)
    try {
      startMaintenance(config);
    } catch (err) {
      console.error("[Startup] Failed to start maintenance scheduler:", err);
    }

    try {
      startTemporaryBanScheduler(client);
      console.log("⏱️ Temporary ban scheduler started.");
    } catch (err) {
      console.error("[Startup] Failed to start temporary ban scheduler:", err);
    }

    // Start Game News system (delegates "enabled" check to the module itself)
    try {
      await startGameNews(client, config);
      console.log("📰 Game News system started.");
      status.setGameNewsRunning(true);
    } catch (err) {
      console.error("[Startup] Failed to start Game News system:", err);
      status.setGameNewsRunning(false);
    }

    // Start server statistics channels (membros / entradas / saídas no topo)
    try {
      const stats = startServerStats(client);
      startServerStats._instance = stats;
      console.log("📊 Server stats system started.");
    } catch (err) {
      console.error("[Startup] Failed to start server stats system:", err);
    }

    // Start GamerPower Free-To-Keep (Giveaways) system (posts when new items appear)
    try {
      const inst = await startGiveaways(client);
      // Expose instance for dashboard actions (eg. "check now")
      startGiveaways._instance = inst;
      console.log("🎁 Free-To-Keep system started.");
      if (status && typeof status.setGiveawaysRunning === "function") {
        status.setGiveawaysRunning(true);
      }
    } catch (err) {
      console.error("[Startup] Failed to start Free-To-Keep system:", err);
      if (status && typeof status.setGiveawaysRunning === "function") {
        status.setGiveawaysRunning(false);
      }
    }

    try {
      startMemes(client);
      console.log("😂 Memes system started.");
    } catch (err) {
      console.error("[Startup] Failed to start Memes system:", err);
    }

    try {
      startTwitch(client);
      console.log("🔴 Twitch notifications started.");
    } catch (err) {
      console.error("[Startup] Failed to start Twitch notifications:", err);
    }

    // Basic presence as a fallback; can be refined later
    try {
      if (client.user) {
        await client.user.setPresence({
          activities: [{ name: "moderating your server", type: 0 }],
          status: "online",
        });
      }
    } catch (err) {
      console.error("[Startup] Failed to set presence:", err);
    }
  } catch (err) {
    console.error("[Startup] Unhandled error during ready orchestration:", err);
  }
}

// Discord client ready
// Use the new event name to avoid deprecation warnings (works on discord.js v14+ and v15).
client.once("clientReady", handleClientReady);

// Keep presence consistent on shard resume
client.on("shardResume", async () => {
  try {
    if (client.user) {
      await client.user.setPresence({
        activities: [{ name: "moderating your server", type: 0 }],
        status: "online",
      });
    }
  } catch (err) {
    console.error("[Startup] Failed to refresh presence on shardResume:", err);
  }
});

// -----------------------------
// Dashboard HTTP server
// -----------------------------

const portFromConfig = config.dashboard?.port;
const PORT = Number(process.env.PORT || portFromConfig || 8000);

dashboard.server.listen(PORT, () => {
  console.log(`🚀 Dashboard running on port ${PORT}`);
});

// -----------------------------
// Login
// -----------------------------

const token = process.env.TOKEN || process.env.DISCORD_TOKEN;
if (!token) {
  console.error(
    "❌ Missing Discord bot token. Set TOKEN or DISCORD_TOKEN in environment.",
  );
  process.exit(1);
}

client
  .login(token)
  .then(() => {
    console.log("✅ Discord login successful.");
  })
  .catch((err) => {
    console.error("❌ Failed to login to Discord:", err);
    process.exit(1);
  });
