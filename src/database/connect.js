// src/database/connect.js

const mongoose = require("mongoose");
const status = require("../systems/status");

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;

// Evitar múltiplas ligações / tentativas em paralelo
let isConnecting = false;
let retryAttempts = 0;
const MAX_RETRY_DELAY_MS = 30_000;

async function connectMongo() {
  if (!uri) {
    console.error(
      "❌ Missing MongoDB URI. Set MONGO_URI (recommended) or MONGODB_URI in environment.",
    );
    status.setMongoConnected(false);
    return;
  }

  // 1 = connected, 2 = connecting
  if (mongoose.connection.readyState === 1) {
    status.setMongoConnected(true);
    return;
  }

  if (isConnecting) {
    return;
  }

  isConnecting = true;

  try {
    await mongoose.connect(uri, {
      autoIndex: false,
      maxPoolSize: 10,
    });

    retryAttempts = 0;
    status.setMongoConnected(true);
    console.log("🟢 MongoDB connected");
  } catch (err) {
    status.setMongoConnected(false);
    console.error("🔴 MongoDB connection error:", err);

    retryAttempts += 1;
    const delay = Math.min(1000 * 2 ** (retryAttempts - 1), MAX_RETRY_DELAY_MS);
    console.log(
      `⏳ Retry MongoDB connection in ${Math.round(delay / 1000)}s (attempt ${retryAttempts})`,
    );

    setTimeout(() => {
      isConnecting = false;
      connectMongo().catch(() => null);
    }, delay).unref?.();
  } finally {
    isConnecting = false;
  }
}

async function closeMongo() {
  try {
    if (mongoose.connection.readyState === 0) return;
    await mongoose.connection.close(false);
    status.setMongoConnected(false);
    console.log("🟡 MongoDB connection closed");
  } catch (err) {
    console.error("🔴 Error closing MongoDB connection:", err);
  }
}

mongoose.connection.on("connected", () => {
  console.log("🟢 MongoDB connected (event)");
  status.setMongoConnected(true);
});

mongoose.connection.on("disconnected", () => {
  console.warn("🟡 MongoDB disconnected. Will attempt reconnect...");
  status.setMongoConnected(false);

  setTimeout(() => {
    connectMongo().catch(() => null);
  }, 5000).unref?.();
});

mongoose.connection.on("reconnected", () => {
  console.log("🟢 MongoDB reconnected");
  status.setMongoConnected(true);
});

mongoose.connection.on("error", (err) => {
  console.error("🔴 MongoDB error:", err);
  status.setMongoConnected(false);
});

// Iniciar ligação
connectMongo().catch(() => null);

module.exports = mongoose;
// Expor helpers explícitos para shutdown / health
module.exports.connectMongo = connectMongo;
module.exports.closeMongo = closeMongo;
