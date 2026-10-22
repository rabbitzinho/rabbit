// src/dashboard/routes/_errors.js
//
// Resposta de erro uniforme para as rotas da dashboard.
// Evita repetir o mesmo bloco try/catch/500 em dezenas de endpoints.

const GENERIC_MESSAGE = "Internal Server Error";

// Regista o erro no servidor e devolve uma resposta 500 genérica.
// A mensagem interna nunca é enviada ao cliente.
function sendServerError(res, scope, err) {
  if (err) {
    console.error(`[Dashboard] ${scope} error:`, err);
  }

  if (res.headersSent) return undefined;

  return res.status(500).json({ ok: false, error: GENERIC_MESSAGE });
}

module.exports = { sendServerError, GENERIC_MESSAGE };
