// src/database/models/Poll.js
//
// Enquete (poll) criada via slash command, com votos por utilizador.

const { Schema, model } = require("mongoose");

const pollSchema = new Schema(
  {
    guildId: { type: String, required: true },
    channelId: { type: String, required: true },
    messageId: { type: String, default: null },
    authorId: { type: String, default: null },

    question: { type: String, default: "" },
    options: { type: [String], default: [] },
    counts: { type: [Number], default: [] },

    // userId -> índice da opção escolhida
    votes: { type: Map, of: Number, default: {} },

    closed: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

pollSchema.index({ guildId: 1, messageId: 1 });

module.exports = model("Poll", pollSchema);
