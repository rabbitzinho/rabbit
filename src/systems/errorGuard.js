// src/systems/errorGuard.js

let initialized = false;

module.exports = () => {
  if (initialized) return;
  initialized = true;

  // Lazy require para evitar ciclos
  const mongoose = require("../database/connect");

  // ==========================
  // Unhandled Promise Rejection
  // ==========================
  process.on("unhandledRejection", (reason, _promise) => {
    console.error("🚨 [UNHANDLED REJECTION]");
    console.error("Reason:", reason);

    if (reason instanceof Error) {
      console.error("Stack:", reason.stack);
    }
  });

  // ==========================
  // Uncaught Exception
  // ==========================
  process.on("uncaughtException", (err) => {
    console.error("🔥 [UNCAUGHT EXCEPTION]");
    console.error(err && err.stack ? err.stack : err);

    // Não fazermos process.exit aqui para o bot não cair logo.
    // Deixamos os sinais (SIGINT / SIGTERM) tratarem do shutdown limpo.
  });

  // ==========================
  // Warnings
  // ==========================
  process.on("warning", (warning) => {
    // Silence noisy discord.js v15 migration warnings...
    try {
      if (
        warning &&
        warning.name === "DeprecationWarning" &&
        typeof warning.message === "string" &&
        warning.message.includes("ready event has been renamed to clientReady")
      ) {
        return;
      }
    } catch {}
    console.warn("⚠️ [NODE WARNING]");
    console.warn(`${warning.name}: ${warning.message}`);

    if (warning.stack) {
      console.warn(warning.stack);
    }
  });

  // ==========================
  // Process signals (graceful)
  // ==========================
  const shutdown = async (signal) => {
    console.log(`🛑 Received ${signal}. Shutting down gracefully...`);

    try {
      if (mongoose && typeof mongoose.closeMongo === "function") {
        await mongoose.closeMongo();
      }
    } catch (err) {
      console.error("Error while closing MongoDB during shutdown:", err);
    }

    // Pequeno delay para drenar logs / requests pendentes
    setTimeout(() => {
      process.exit(0);
    }, 1000).unref?.();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("🛡️ ErrorGuard initialized");
};
