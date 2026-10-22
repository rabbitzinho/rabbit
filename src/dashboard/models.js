// src/dashboard/models.js
//
// Carregamento null-safe dos modelos Mongoose usados pela dashboard.
// Cada require é isolado em try/catch para que a dashboard continue a
// funcionar em modo degradado mesmo que um modelo não exista.
// Extraído de src/dashboard.js.

function loadModel(relPath, label) {
  try {
    return require(relPath);
  } catch {
    console.warn(
      `[Dashboard] ${label} model not loaded (did you create src/database/models/${label}.js?)`,
    );
    return null;
  }
}

function loadDashboardModels() {
  return {
    GuildConfig: loadModel("../database/models/GuildConfig", "GuildConfig"),
    DashboardAudit: loadModel(
      "../database/models/DashboardAudit",
      "DashboardAudit",
    ),
    DashboardLog: loadModel("../database/models/DashboardLog", "DashboardLog"),
    GameNewsModel: loadModel("../database/models/GameNews", "GameNews"),
    GameNewsFeed: loadModel("../database/models/GameNewsFeed", "GameNewsFeed"),
    GiveawayPost: loadModel("../database/models/GiveawayPost", "GiveawayPost"),
    UserModel: loadModel("../database/models/User", "User"),
    UserActivityModel: loadModel(
      "../database/models/UserActivity",
      "UserActivity",
    ),
    PresenceSessionModel: loadModel(
      "../database/models/PresenceSession",
      "PresenceSession",
    ),
    TicketLog: loadModel("../database/models/TicketLog", "TicketLog"),
    Ticket: loadModel("../database/models/Ticket", "Ticket"),
    Infraction: loadModel("../database/models/Infraction", "Infraction"),
    TempVoiceChannel: loadModel(
      "../database/models/TempVoiceChannel",
      "TempVoiceChannel",
    ),
    PremiumPayment: loadModel(
      "../database/models/PremiumPayment",
      "PremiumPayment",
    ),
    PremiumSettings: loadModel(
      "../database/models/PremiumSettings",
      "PremiumSettings",
    ),
  };
}

module.exports = { loadDashboardModels };
