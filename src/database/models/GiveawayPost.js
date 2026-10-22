// src/database/models/GiveawayPost.js
//
// Stores which giveaways have already been published per guild,
// so we never repost the same giveaway.

const { Schema, model } = require("mongoose");

const giveawayPostSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    giveawayId: { type: Number, required: true },
    platform: { type: String, default: null },
    type: { type: String, default: null },

    // For debug/auditing
    title: { type: String, default: null },
    url: { type: String, default: null },
    postedAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

giveawayPostSchema.index({ guildId: 1, giveawayId: 1 }, { unique: true });

module.exports = model("GiveawayPost", giveawayPostSchema);
