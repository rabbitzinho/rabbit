// src/events/voiceStateUpdate.serverStats.js

const { enforceVoiceEntry } = require("../systems/serverStats");

module.exports = (client) => {
  client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
      await enforceVoiceEntry(oldState, newState);
    } catch (err) {
      console.error("[ServerStats] voiceStateUpdate error:", err);
    }
  });
};
