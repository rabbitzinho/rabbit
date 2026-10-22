const TemporaryBan = require("../database/models/TemporaryBan");
const infractionsService = require("./infractionsService");
const logger = require("./logger");

const DEFAULT_INTERVAL_MS = 30_000;
const BATCH_SIZE = 50;

async function scheduleTemporaryBan({
  guildId,
  userId,
  userTag,
  token,
  moderatorId,
  reason,
  expiresAt,
  model = TemporaryBan,
}) {
  return model.findOneAndUpdate(
    { guildId: String(guildId), userId: String(userId) },
    {
      $set: {
        userTag: userTag || null,
        token: String(token),
        moderatorId: String(moderatorId),
        reason: reason || "No reason provided",
        expiresAt: new Date(expiresAt),
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
}

async function cancelTemporaryBan({ guildId, userId, model = TemporaryBan }) {
  return model.deleteOne({
    guildId: String(guildId),
    userId: String(userId),
  });
}

function isUnknownBanError(error) {
  return Number(error?.code || error?.rawError?.code) === 10026;
}

async function processDueTemporaryBans(
  client,
  {
    model = TemporaryBan,
    now = Date.now(),
    createInfraction = infractionsService.create,
    writeLog = logger,
  } = {},
) {
  const dueBans = await model
    .find({ expiresAt: { $lte: new Date(now) } })
    .sort({ expiresAt: 1 })
    .limit(BATCH_SIZE)
    .lean();
  let expired = 0;

  for (const ban of dueBans || []) {
    const guild = client?.guilds?.cache?.get(String(ban.guildId));
    if (!guild) continue;

    let existingBan;
    try {
      existingBan = await guild.bans.fetch(String(ban.userId));
    } catch (error) {
      if (isUnknownBanError(error)) {
        await model.deleteOne({
          guildId: String(ban.guildId),
          userId: String(ban.userId),
        });
        expired++;
      } else {
        console.error("[TemporaryBans] Failed to expire ban:", error);
      }
      continue;
    }

    if (!existingBan?.reason) {
      console.warn(
        `[TemporaryBans] Cannot verify the scheduled ban reason for ${ban.userId}; retaining schedule.`,
      );
      continue;
    }
    if (
      !ban.token ||
      !String(existingBan.reason).includes(`[rabbit-tempban:${ban.token}]`)
    ) {
      await model.deleteOne({
        guildId: String(ban.guildId),
        userId: String(ban.userId),
      });
      expired++;
      continue;
    }

    try {
      await guild.bans.remove(String(ban.userId), "Temporary ban expired");
    } catch (error) {
      if (isUnknownBanError(error)) {
        await model.deleteOne({
          guildId: String(ban.guildId),
          userId: String(ban.userId),
        });
        expired++;
      } else {
        console.error("[TemporaryBans] Failed to expire ban:", error);
      }
      continue;
    }

    const result = await model.deleteOne({
      guildId: String(ban.guildId),
      userId: String(ban.userId),
    });
    if (!result?.deletedCount) continue;
    expired++;

    const user = {
      id: String(ban.userId),
      tag: ban.userTag || String(ban.userId),
      username: ban.userTag || String(ban.userId),
    };
    await createInfraction({
      guild,
      user,
      moderator: client.user,
      type: "UNBAN",
      reason: "Temporary ban expired",
      source: "tempban-expiry",
    }).catch(() => null);
    await writeLog(
      client,
      "Temporary Ban Expired",
      user,
      client.user,
      `Temporary ban expired for <@${ban.userId}>.`,
      guild,
    ).catch(() => null);
  }

  return expired;
}

function startTemporaryBanScheduler(
  client,
  {
    intervalMs = DEFAULT_INTERVAL_MS,
    processDue = processDueTemporaryBans,
  } = {},
) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await processDue(client);
    } catch (error) {
      console.error("[TemporaryBans] Scheduler failed:", error);
    } finally {
      running = false;
    }
  };

  run().catch(() => null);
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = {
  scheduleTemporaryBan,
  cancelTemporaryBan,
  processDueTemporaryBans,
  startTemporaryBanScheduler,
  isUnknownBanError,
  DEFAULT_INTERVAL_MS,
  BATCH_SIZE,
};
