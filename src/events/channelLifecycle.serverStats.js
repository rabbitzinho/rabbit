// src/events/channelLifecycle.serverStats.js

const { scheduleRealtimeSync } = require("../systems/serverStats");

module.exports = (client) => {
  function scheduleForChannel(channel) {
    if (!channel || !channel.guild) return;
    scheduleRealtimeSync(client, channel.guild);
  }

  client.on("channelCreate", (channel) => {
    try {
      scheduleForChannel(channel);
    } catch (err) {
      console.error("[ServerStats] channelCreate error:", err);
    }
  });

  client.on("channelUpdate", (oldChannel, newChannel) => {
    try {
      scheduleForChannel(newChannel || oldChannel);
    } catch (err) {
      console.error("[ServerStats] channelUpdate error:", err);
    }
  });

  client.on("channelDelete", (channel) => {
    try {
      scheduleForChannel(channel);
    } catch (err) {
      console.error("[ServerStats] channelDelete error:", err);
    }
  });
};
