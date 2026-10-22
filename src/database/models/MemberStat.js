// src/database/models/MemberStat.js
//
// Agregado diário de entradas/saídas por servidor.
// Guarda um único documento por (guildId, dia) em vez de um por membro, o que
// mantém as estatísticas dos últimos 7 dias baratas de calcular e de manter.

const { Schema, model } = require("mongoose");

const memberStatSchema = new Schema(
  {
    guildId: { type: String, required: true },

    // Dia em UTC no formato YYYY-MM-DD.
    date: { type: String, required: true },

    joins: { type: Number, default: 0 },
    leaves: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false },
);

memberStatSchema.index({ guildId: 1, date: 1 }, { unique: true });

module.exports = model("MemberStat", memberStatSchema);
