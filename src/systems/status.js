// src/systems/status.js

const status = {
  discordReady: false,
  mongoConnected: false,
  gameNewsRunning: false,
  giveawaysRunning: false,

  startedAt: Date.now(),
  lastDiscordReadyAt: null,
  lastMongoConnectedAt: null,
  lastGameNewsStartedAt: null,
  lastGiveawaysStartedAt: null,

  // Métricas simples de utilização
  totalCommandsExecuted: 0,
  totalInfractionsCreated: 0,
  autoModActions: 0,
  antiSpamActions: 0,
};

function getStatus() {
  const now = Date.now();

  return {
    ok: status.discordReady && status.mongoConnected,

    discordReady: status.discordReady,
    mongoConnected: status.mongoConnected,
    gameNewsRunning: status.gameNewsRunning,
    giveawaysRunning: status.giveawaysRunning,

    uptimeSeconds: Math.floor((now - status.startedAt) / 1000),

    startedAt: new Date(status.startedAt).toISOString(),
    lastDiscordReadyAt: status.lastDiscordReadyAt,
    lastMongoConnectedAt: status.lastMongoConnectedAt,
    lastGameNewsStartedAt: status.lastGameNewsStartedAt,
    lastGiveawaysStartedAt: status.lastGiveawaysStartedAt,

    // Contadores de utilização (consumidos por /health e pelo self-test)
    totalCommandsExecuted: status.totalCommandsExecuted,
    totalInfractionsCreated: status.totalInfractionsCreated,
    autoModActions: status.autoModActions,
    antiSpamActions: status.antiSpamActions,
  };
}

function setDiscordReady(value = true) {
  status.discordReady = Boolean(value);
  if (value) status.lastDiscordReadyAt = new Date().toISOString();
}

function setMongoConnected(value = true) {
  status.mongoConnected = Boolean(value);
  if (value) status.lastMongoConnectedAt = new Date().toISOString();
}

function setGameNewsRunning(value = true) {
  status.gameNewsRunning = Boolean(value);
  if (value) status.lastGameNewsStartedAt = new Date().toISOString();
}

function incrementCommands() {
  status.totalCommandsExecuted += 1;
}

function incrementInfractions() {
  status.totalInfractionsCreated += 1;
}

function incrementAutoModActions() {
  status.autoModActions += 1;
}

function incrementAntiSpamActions() {
  status.antiSpamActions += 1;
}

function setGiveawaysRunning(value = true) {
  status.giveawaysRunning = Boolean(value);
  if (value) status.lastGiveawaysStartedAt = new Date().toISOString();
}

module.exports = {
  getStatus,
  setDiscordReady,
  setMongoConnected,
  setGameNewsRunning,
  setGiveawaysRunning,
  incrementCommands,
  incrementInfractions,
  incrementAutoModActions,
  incrementAntiSpamActions,
};
