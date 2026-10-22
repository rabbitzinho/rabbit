const { Schema, model } = require("mongoose");

const premiumSettingsSchema = new Schema(
  {
    _id: { type: String, default: "global" },
    amount: { type: String, required: true },
    currency: { type: String, default: "EUR" },
    durationDays: { type: Number, required: true },
    paymentLink: { type: String, default: null },
    updatedBy: { type: String, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

module.exports = model("PremiumSettings", premiumSettingsSchema);
