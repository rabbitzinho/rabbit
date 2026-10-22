// src/dashboard/logStore.js
//
// Cache em memória + persistência dos logs da dashboard.
// Extraído de src/dashboard.js para reduzir o entrypoint e isolar o acesso ao
// modelo DashboardLog (injetado via `getModel`).

/**
 * @param {object} deps
 * @param {object} deps.config   - configuração (usa config.dashboard.maxLogs/maxDbLogs)
 * @param {() => object|null} deps.getModel - devolve o modelo DashboardLog (ou null)
 */
function createLogStore({ config, getModel }) {
  const DEFAULT_MAX_MEMORY_LOGS = config.dashboard?.maxLogs ?? 200; // initial, runtime may override
  let cache = [];

  function currentModel() {
    return typeof getModel === "function" ? getModel() : null;
  }

  async function saveToMongo(data) {
    const DashboardLog = currentModel();
    if (!DashboardLog) return null;

    try {
      const doc = await DashboardLog.create({
        title: data.title || "Log",
        user: data.user || null,
        executor: data.executor || null,
        description: data.description || "",
        guild: data.guild || null,
        time: data.time || new Date().toISOString(),
      });

      const maxDb = config.dashboard?.maxDbLogs ?? 1000;
      if (Number.isFinite(maxDb) && maxDb > 0) {
        const count = await DashboardLog.estimatedDocumentCount();
        if (count > maxDb) {
          const toDelete = count - maxDb;
          const oldest = await DashboardLog.find({})
            .sort({ createdAt: 1 })
            .limit(toDelete)
            .select("_id")
            .lean();

          if (oldest.length) {
            await DashboardLog.deleteMany({
              _id: { $in: oldest.map((o) => o._id) },
            });
          }
        }
      }

      return doc;
    } catch (err) {
      console.error(
        "[Dashboard] Failed saving log to Mongo:",
        err?.message || err,
      );
      return null;
    }
  }

  async function loadInitial() {
    const DashboardLog = currentModel();
    if (!DashboardLog) return;

    try {
      const limit = Math.min(Math.max(DEFAULT_MAX_MEMORY_LOGS, 10), 500);
      const items = await DashboardLog.find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      cache = items.reverse().map((x) => ({
        title: x.title,
        user: x.user,
        executor: x.executor,
        description: x.description,
        guild: x.guild,
        time:
          x.time ||
          (x.createdAt
            ? new Date(x.createdAt).toISOString()
            : new Date().toISOString()),
      }));

      console.log(`[Dashboard] Loaded ${cache.length} logs into memory cache`);
    } catch (err) {
      console.error("[Dashboard] Failed loading initial cache:", err);
    }
  }

  /** Adiciona um log ao cache (com cap) e persiste em Mongo em background. */
  function push(payload) {
    cache.push(payload);
    const maxMem = config.dashboard?.maxLogs ?? DEFAULT_MAX_MEMORY_LOGS;
    if (cache.length > maxMem) cache.shift();

    saveToMongo(payload).catch(() => null);
  }

  return {
    get: () => cache,
    set: (next) => {
      cache = next;
    },
    push,
    saveToMongo,
    loadInitial,
  };
}

module.exports = { createLogStore };
