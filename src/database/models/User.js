// src/database/models/User.js

const { Schema, model } = require("mongoose");

const userSchema = new Schema(
  {
    userId: {
      type: String,
      required: true,
    },

    guildId: {
      type: String,
      required: true,
    },

    warnings: {
      type: Number,
      default: 0,
      min: 0,
    },

    trust: {
      type: Number,
      default: 30,
      min: 0,
      max: 100,
    },

    lastInfractionAt: {
      type: Date,
      default: null,
    },

    lastTrustUpdateAt: {
      type: Date,
      default: null,
    },

    // Rolling log of Trust changes (most recent last, bounded in warningsService).
    // [{ at: Date, delta: Number, trust: Number, reason: String }]
    trustHistory: {
      type: [
        {
          _id: false,
          at: { type: Date, default: null },
          delta: { type: Number, default: 0 },
          trust: { type: Number, default: null },
          reason: { type: String, default: null },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

userSchema.index({ userId: 1, guildId: 1 }, { unique: true });

module.exports = model("User", userSchema);
