// src/database/models/Ticket.js

const { Schema, model } = require("mongoose");

const ticketActivitySchema = new Schema(
  {
    action: { type: String, required: true },
    actorId: { type: String, default: null },
    actorUsername: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    details: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const ticketSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, index: true }, // thread/channel id

    ticketNumber: { type: Number, required: true },

    userId: { type: String, required: true, index: true },
    username: { type: String, default: null },

    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
      index: true,
    },

    subject: { type: String, default: null },
    labels: { type: [String], default: [] },
    activity: { type: [ticketActivitySchema], default: [] },
    assignedToId: { type: String, default: null },
    assignedToName: { type: String, default: null },
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },
    slaHours: { type: Number, enum: [0, 4, 8, 24, 48, 72], default: 0 },
    slaDueAt: { type: Date, default: null },
    metadataUpdatedAt: { type: Date, default: null },
    metadataUpdatedById: { type: String, default: null },
    createdAt: { type: Date, default: Date.now, index: true },
    closedAt: { type: Date, default: null },
    closedById: { type: String, default: null },
    closedByUsername: { type: String, default: null },

    lastMessageAt: { type: Date, default: null },
    lastResponderId: { type: String, default: null },
    lastResponderName: { type: String, default: null },
    lastResponderAt: { type: Date, default: null },
  },
  {
    timestamps: false,
  },
);

ticketSchema.index({ guildId: 1, ticketNumber: 1 }, { unique: true });
ticketSchema.index({ guildId: 1, channelId: 1 }, { unique: true });
ticketSchema.index({ guildId: 1, status: 1, createdAt: -1 });
ticketSchema.index(
  { guildId: 1, userId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "open" } },
);

module.exports = model("Ticket", ticketSchema);
