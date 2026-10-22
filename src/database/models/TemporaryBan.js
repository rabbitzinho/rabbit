const { Schema, model } = require("mongoose");

const temporaryBanSchema = new Schema(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    userTag: { type: String, default: null },
    token: { type: String, required: true },
    moderatorId: { type: String, required: true },
    reason: { type: String, default: "No reason provided" },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

temporaryBanSchema.index({ guildId: 1, userId: 1 }, { unique: true });
temporaryBanSchema.index({ expiresAt: 1 });

module.exports = model("TemporaryBan", temporaryBanSchema);
