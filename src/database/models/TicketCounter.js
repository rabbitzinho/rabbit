// src/database/models/TicketCounter.js
const { Schema, model } = require("mongoose");

// Stores the next ticketNumber for each guild.
// Used to generate sequential Ticket numbers atomically (per guild).
const ticketCounterSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    nextTicketNumber: { type: Number, required: true, default: 1, min: 1 },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

module.exports = model("TicketCounter", ticketCounterSchema);
