// src/database/models/UserActivity.js

const { Schema, model } = require("mongoose");

const userActivitySchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    // Start of the day (00:00:00 UTC) for aggregation.
    day: { type: Date, required: true, index: true },

    messages: { type: Number, default: 0 },
  },
  { timestamps: true },
);

userActivitySchema.index({ guildId: 1, userId: 1, day: 1 }, { unique: true });
userActivitySchema.index({ guildId: 1, day: -1 });

module.exports = model("UserActivity", userActivitySchema);
