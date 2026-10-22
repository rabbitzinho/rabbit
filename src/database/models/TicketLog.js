// src/database/models/TicketLog.js

const { Schema, model } = require("mongoose");

const ticketLogSchema = new Schema(
  {
    ticketNumber: { type: Number, required: true },

    // Link to the persistent Ticket document (added in perf8)
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", default: null },

    guildId: { type: String, required: true },

    // Thread/channel id for the ticket (so dashboard can reply even with only TicketLog)
    channelId: { type: String, default: null },

    userId: { type: String, required: true },
    username: { type: String, default: null },

    createdAt: { type: Date, default: Date.now },

    closedAt: { type: Date, default: null },
    closedById: { type: String, default: null },
    closedByUsername: { type: String, default: null },
  },
  {
    timestamps: false,
  },
);

ticketLogSchema.index({ guildId: 1, ticketNumber: 1 });
ticketLogSchema.index({ guildId: 1, createdAt: -1 });

module.exports = model("TicketLog", ticketLogSchema);
