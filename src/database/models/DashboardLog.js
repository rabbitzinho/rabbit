// src/database/models/DashboardLog.js

const { Schema, model } = require("mongoose");

const dashboardLogSchema = new Schema(
  {
    title: { type: String, required: true },

    user: {
      id: { type: String, default: null },
      tag: { type: String, default: null },
    },

    executor: {
      id: { type: String, default: null },
      tag: { type: String, default: null },
    },

    description: { type: String, default: "" },

    guild: {
      id: { type: String, default: null },
      name: { type: String, default: null },
    },

    time: { type: String, default: () => new Date().toISOString() },
  },
  { timestamps: true },
);

dashboardLogSchema.index({ "guild.id": 1, createdAt: -1 });

module.exports = model("DashboardLog", dashboardLogSchema);
