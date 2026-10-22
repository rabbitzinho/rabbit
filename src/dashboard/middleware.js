// src/dashboard/middleware.js
//
// Middlewares comuns de observabilidade da dashboard.
// Extraído de src/dashboard.js.

const crypto = require("crypto");

/**
 * Anexa um request id leve para diagnósticos, correlacionando erros do frontend
 * com os logs do servidor.
 */
function requestIdMiddleware() {
  return (req, res, next) => {
    try {
      const rid =
        (crypto.randomUUID && crypto.randomUUID()) ||
        crypto.randomBytes(12).toString("hex");
      req.requestId = rid;
      res.setHeader("x-request-id", rid);
    } catch {
      // no-op
    }
    next();
  };
}

/**
 * Métricas de latência por rota (expostas de forma protegida em GET /api/internal/metrics).
 * O listener corre depois de a resposta terminar, por isso nunca afeta o pedido.
 */
function createMetricsMiddleware({ metrics }) {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
      try {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        metrics.recordHttpRequest(req, res.statusCode, durationMs);
      } catch {
        // métricas nunca devem quebrar um pedido
      }
    });
    next();
  };
}

module.exports = { requestIdMiddleware, createMetricsMiddleware };
