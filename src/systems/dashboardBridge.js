// src/systems/dashboardBridge.js

/**
 * Pequena ponte para evitar dependência circular entre logger.js e dashboard.js.
 * O dashboard regista a função de envio, e os sistemas (logger, gamenews, etc.)
 * chamam apenas emit(type, payload).
 */

let sendToDashboardFn = null;

/**
 * Regista a função que envia os eventos para o dashboard.
 * Normalmente chamada a partir de src/dashboard.js.
 */
function setSender(fn) {
  if (typeof fn === "function") {
    sendToDashboardFn = fn;
  } else {
    sendToDashboardFn = null;
  }
}

/**
 * Emite um evento para o dashboard, se houver função registada.
 */
function emit(event, payload) {
  if (typeof sendToDashboardFn !== "function") return;

  try {
    sendToDashboardFn(event, payload);
  } catch (err) {
    console.error("[DashboardBridge] Failed to emit to dashboard:", err);
  }
}

module.exports = { setSender, emit };
