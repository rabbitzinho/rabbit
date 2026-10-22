// src/services/gameNewsService.js
//
// Acesso de leitura aos feeds de GameNews + construção dos DTOs públicos.
// O mapeamento documento->DTO estava repetido em quatro pontos de
// `dashboard/routes/gamenews.js`; passou a viver aqui para garantir que a
// dashboard, o editor de feeds e (futuramente) o comando slash veem o mesmo
// formato.

/**
 * Converte um documento `GameNewsFeed` (lean ou Mongoose) no DTO público usado
 * pela dashboard. Tolerante a documentos parciais/nulos.
 * @param {object} doc
 * @returns {object}
 */
function toFeedDto(doc) {
  const d = doc || {};
  return {
    id: d._id != null ? String(d._id) : null,
    guildId: d.guildId || null,
    name: d.name || "Feed",
    feedUrl: d.feedUrl || d.feed,
    channelId: d.channelId,
    logChannelId: d.logChannelId || null,
    extraChannelIds: Array.isArray(d.extraChannelIds) ? d.extraChannelIds : [],
    enabled: d.enabled !== false,
    intervalMs: typeof d.intervalMs === "number" ? d.intervalMs : null,
    maxPerCycle: typeof d.maxPerCycle === "number" ? d.maxPerCycle : null,
    excludeKeywords: Array.isArray(d.excludeKeywords) ? d.excludeKeywords : [],
  };
}

/**
 * DTO dos feeds estáticos vindos de `config.gameNews.sources` (fallback quando
 * não existe modelo `GameNewsFeed` na deployment).
 * @param {Array} sources
 * @param {{ withId?: boolean }} [options]
 * @returns {Array}
 */
function listStaticFeeds(sources, options = {}) {
  const { withId = true } = options;
  const list = Array.isArray(sources) ? sources : [];

  return list.map((s, idx) => {
    const out = {
      guildId: null,
      name: s?.name,
      feedUrl: s?.feed,
      channelId: s?.channelId,
      logChannelId: null,
      extraChannelIds: [],
      enabled: true,
      intervalMs: null,
      maxPerCycle: null,
    };
    if (withId) out.id = String(idx);
    return out;
  });
}

/**
 * Lê os feeds de um guild (ou todos) e devolve os DTOs prontos a serializar.
 * Devolve `null` quando o modelo não existe, para o chamador decidir o fallback.
 * @param {{ GameNewsFeed: any, guildId?: string }} params
 * @returns {Promise<Array|null>}
 */
async function listFeeds({ GameNewsFeed, guildId }) {
  if (!GameNewsFeed) return null;

  const q = guildId ? { guildId } : {};
  const docs = await GameNewsFeed.find(q).sort({ createdAt: 1 }).lean();
  return docs.map(toFeedDto);
}

module.exports = {
  toFeedDto,
  listStaticFeeds,
  listFeeds,
};
