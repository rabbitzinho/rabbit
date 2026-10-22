// src/database/models/Level.js
//
// XP / nível de um utilizador dentro de uma guild (feature "Níveis").

const { Schema, model } = require("mongoose");

const levelSchema = new Schema(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },

    xp: { type: Number, default: 0 },
    level: { type: Number, default: 0 },
    messages: { type: Number, default: 0 },

    // Última vez que recebeu XP (usado para o cooldown anti-farm).
    lastXpAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

levelSchema.index({ guildId: 1, userId: 1 }, { unique: true });
levelSchema.index({ guildId: 1, xp: -1 });

module.exports = model("Level", levelSchema);
