// src/database/models/DashboardAudit.js

const { Schema, model } = require("mongoose");

const dashboardAuditSchema = new Schema(
  {
    at: { type: Date, default: Date.now },

    route: { type: String, required: true },
    method: { type: String, required: true },

    actor: { type: String, default: null },
    action: { type: String, default: null },

    guildId: { type: String, default: null },
    targetUserId: { type: String, default: null },

    ip: { type: String, default: null },
    userAgent: { type: String, default: null },

    payload: {
      type: Object,
      default: null,
    },
  },
  {
    versionKey: false,
  },
);

dashboardAuditSchema.index({ at: -1 });
dashboardAuditSchema.index({ route: 1, at: -1 });
dashboardAuditSchema.index({ guildId: 1, at: -1 });

module.exports = model("DashboardAudit", dashboardAuditSchema);
