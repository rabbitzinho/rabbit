// src/systems/reactionRoles.js
//
// Correspondência de emojis para a funcionalidade "cargos por reação".
// Aceita emojis Unicode, emojis personalizados ("<:nome:id>"/"<a:nome:id>") e
// nomes escritos no formato ":nome:".

/**
 * Extrai nome e id de um emoji personalizado no formato "<:nome:id>".
 * @param {string} value
 * @returns {{name: string, id: string}|null}
 */
function customEmojiParts(value) {
  const m = String(value == null ? "" : value).match(/^<a?:([^:>]+):(\d+)>$/);
  if (!m) return null;
  return { name: m[1], id: m[2] };
}

/**
 * Verifica se o emoji configurado corresponde à reação efetuada.
 * @param {string} configured valor guardado na dashboard
 * @param {{name?: string, id?: string, identifier?: string}} reactionEmoji
 * @returns {boolean}
 */
function emojiMatches(configured, reactionEmoji) {
  if (!configured || !reactionEmoji) return false;
  const raw = String(configured).trim();
  if (!raw) return false;

  const rName = reactionEmoji.name || null;
  const rId = reactionEmoji.id || null;
  const rIdentifier =
    reactionEmoji.identifier || (rName && rId ? `${rName}:${rId}` : null);

  const candidates = [raw];
  if (raw.length > 2 && raw.startsWith(":") && raw.endsWith(":")) {
    candidates.push(raw.slice(1, -1));
  }
  const custom = customEmojiParts(raw);
  if (custom) {
    candidates.push(custom.name, custom.id, `${custom.name}:${custom.id}`);
  }

  for (const c of candidates) {
    if (!c) continue;
    if (rName && c === rName) return true;
    if (rId && c === rId) return true;
    if (rIdentifier && c === rIdentifier) return true;
  }
  return false;
}

/**
 * Converte atalhos ":nome:" no formato "<:nome:id>" usando os emojis
 * personalizados do servidor. Emojis Unicode e "<:nome:id>" ficam inalterados.
 * @param {Array<{emoji?: string, roleId?: string}>} entries
 * @param {import('discord.js').Guild|null} guild
 * @returns {Array<{emoji?: string, roleId?: string}>}
 */
function resolveShortcodes(entries, guild) {
  const list = Array.isArray(entries) ? entries : [];
  const cache =
    guild && guild.emojis && guild.emojis.cache ? guild.emojis.cache : null;
  if (!cache) return list;

  return list.map((entry) => {
    const raw = String((entry && entry.emoji) || "").trim();
    const m = raw.match(/^:([^:]+):$/);
    if (!m) return entry;

    const found = cache.find((e) => e.name === m[1]);
    if (!found) return entry;

    const emoji = found.animated
      ? `<a:${found.name}:${found.id}>`
      : `<:${found.name}:${found.id}>`;
    return { ...entry, emoji };
  });
}

/**
 * Converte o valor configurado num formato aceite por `message.react()`.
 * Devolve null quando não é possível reagir (ex.: ":nome:" sem id).
 * @param {string} configured
 * @returns {string|null}
 */
function toReactable(configured) {
  const raw = String(configured == null ? "" : configured).trim();
  if (!raw) return null;

  const custom = customEmojiParts(raw);
  if (custom) {
    const prefix = /^<a:/i.test(raw) ? "a:" : ":";
    return `<${prefix}${custom.name}:${custom.id}>`;
  }

  // ":nome:" não pode ser resolvido sem o id do emoji.
  if (raw.length > 2 && raw.startsWith(":") && raw.endsWith(":")) return null;

  return raw;
}

module.exports = {
  emojiMatches,
  toReactable,
  customEmojiParts,
  resolveShortcodes,
};
