const { Schema, model } = require("mongoose");

const premiumPaymentSchema = new Schema(
  {
    paypalOrderId: { type: String, required: true, unique: true },
    approvalUrl: { type: String, default: null },
    paypalCaptureId: { type: String, default: null },
    guildId: { type: String, required: true, index: true },
    // Buyer metadata; legacy discordUserId/discordUsername fields remain readable.
    discordUserId: { type: String, default: null },
    discordUsername: { type: String, default: null },
    purchaserDiscordUserId: { type: String, default: null, index: true },
    purchaserDiscordUsername: { type: String, default: null },
    paypalPayerId: { type: String, default: null },
    paypalPayerEmail: { type: String, default: null },
    amount: { type: String, required: true },
    currency: { type: String, required: true },
    durationDays: { type: Number, required: true },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "COMPLETED", "CANCELLED", "FAILED"],
      default: "PENDING",
      index: true,
    },
    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

module.exports = model("PremiumPayment", premiumPaymentSchema);
