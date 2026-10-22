// src/dashboard/sanitize.js
//
// Utilitários de sanitização/hardening da dashboard.
// Extraído de src/dashboard.js (funções puras, testáveis isoladamente).

/**
 * Sanitiza texto genérico: trunca, remove caracteres de controlo e (opcionalmente)
 * remove tags HTML para reduzir payloads XSS em dados persistidos.
 */
function sanitizeText(value, { maxLen = 1000, stripHtml = true } = {}) {
  if (value === null || value === undefined) return "";
  let str = String(value).trim();

  // remove control chars
  str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // strip basic HTML tags to reduce XSS payloads in stored data
  if (stripHtml) {
    str = str.replace(/<[^>]*>/g, "");
  }

  if (str.length > maxLen) str = str.slice(0, maxLen);

  return str.trim();
}

/**
 * Normaliza um identificador (Snowflake) para apenas dígitos, com limite de 20 chars.
 */
function sanitizeId(value) {
  // IDs can arrive wrapped in Discord mention syntax; keep the raw digits.
  const s = sanitizeText(value, { maxLen: 64, stripHtml: false });
  const digitsOnly = s.replace(/\D/g, "");
  return digitsOnly.slice(0, 20);
}

/**
 * Garante que o payload de auditoria é serializável e não excede 5000 chars.
 */
function safeAuditPayload(payload) {
  if (!payload) return null;
  try {
    const raw = JSON.stringify(payload);
    if (raw.length <= 5000) return payload;
    return { _trimmed: true, preview: raw.slice(0, 5000) };
  } catch {
    return { _unserializable: true };
  }
}

module.exports = { sanitizeText, sanitizeId, safeAuditPayload };
