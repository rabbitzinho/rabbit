// src/database/models/StarboardEntry.js
//
// Mapeia uma mensagem original para a sua entrada no canal starboard.

const { Schema, model } = require("mongoose");

const starboardEntrySchema = new Schema(
  {
    guildId: { type: String, required: true },
    sourceMessageId: { type: String, required: true },

    channelId: { type: String, default: null },
    starboardMessageId: { type: String, default: null },
    authorId: { type: String, default: null },

    count: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

starboardEntrySchema.index(
  { guildId: 1, sourceMessageId: 1 },
  { unique: true },
);

module.exports = model("StarboardEntry", starboardEntrySchema);
