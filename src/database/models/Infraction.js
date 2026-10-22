// src/database/models/Infraction.js

const { Schema, model } = require("mongoose");

const infractionSchema = new Schema(
  {
    // Sequential case ID per guild (allocated via CaseCounter). Optional for legacy docs.
    caseId: { type: Number, index: true },

    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    moderatorId: { type: String, required: true },

    type: {
      type: String,
      enum: ["WARN", "MUTE", "KICK", "BAN", "UNBAN"],
      required: true,
    },

    reason: { type: String, default: "No reason provided" },

    duration: { type: Number, default: null },

    // Who/what originated the infraction (slash, prefix, dashboard, automod, antispam, etc.)
    source: { type: String, default: "unknown", index: true },

    // Stored tags/usernames at time of action for better dashboard search and historical accuracy.
    userTag: { type: String, default: null },
    executorTag: { type: String, default: null },
  },
  { timestamps: true },
);

// índice TTL: tudo o que tiver createdAt > 180 dias é removido automaticamente pelo Mongo.
// O valor tem de coincidir com config.maintenance.pruneInfractionsOlderThanDays (180).
infractionSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 180 * 24 * 60 * 60 }, // 180 dias
);

// Helpful query indexes
infractionSchema.index({ guildId: 1, createdAt: -1 });
infractionSchema.index({ guildId: 1, userId: 1, createdAt: -1 });
infractionSchema.index({ guildId: 1, type: 1, createdAt: -1 });
// Case IDs should be unique per guild when present.
// Note: sparse does NOT exclude null values (it only excludes missing fields).
// Use a partial index so legacy docs with caseId missing/null don't break index builds.
infractionSchema.index(
  { guildId: 1, caseId: 1 },
  { unique: true, partialFilterExpression: { caseId: { $type: "number" } } },
);

// Text search for dashboard (reason + stored tags). Keep weights small; this is an operator tool.
infractionSchema.index(
  {
    reason: "text",
    userTag: "text",
    executorTag: "text",
    userId: "text",
    moderatorId: "text",
  },
  {
    weights: {
      reason: 5,
      userTag: 3,
      executorTag: 3,
      userId: 2,
      moderatorId: 2,
    },
  },
);

module.exports = model("Infraction", infractionSchema);
