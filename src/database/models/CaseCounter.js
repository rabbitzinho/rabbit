// src/database/models/CaseCounter.js

const { Schema, model } = require("mongoose");

// Stores the next caseId for each guild.
// Used to generate sequential Case IDs (per guild).
const caseCounterSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    nextCaseId: { type: Number, required: true, default: 1, min: 1 },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

module.exports = model("CaseCounter", caseCounterSchema);
