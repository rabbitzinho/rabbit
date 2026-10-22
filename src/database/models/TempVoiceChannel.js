// src/database/models/TempVoiceChannel.js

const { Schema, model } = require("mongoose");

const tempVoiceChannelSchema = new Schema(
  {
    guildId: { type: String, required: true },
    channelId: { type: String, required: true },
    ownerId: { type: String, required: true },
    baseChannelId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
    versionKey: false,
  },
);

tempVoiceChannelSchema.index({ guildId: 1, channelId: 1 }, { unique: true });

module.exports = model("TempVoiceChannel", tempVoiceChannelSchema);
