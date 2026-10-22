// tests/integration/_helpers.js
// Helpers para testes de integração das rotas da dashboard.
// Usa apenas Node nativo (node:test) + express, sem dependências novas.

const express = require("express");

// Sobe uma app Express efémera com as rotas registadas e devolve
// { server, baseUrl } prontos a usar com fetch().
async function startApp(registerFn, ctx) {
  const app = express();
  app.use(express.json());
  registerFn(Object.assign({ app }, ctx || {}));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });

  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function stopApp(server) {
  return new Promise((resolve) => server.close(resolve));
}

// Middlewares pass-through (a autenticação é testada noutro sítio).
const passthrough = (req, res, next) => next();

// Extrai o primeiro bloco de dígitos (IDs/mencões do Discord).
function sanitizeId(value) {
  const s = value != null ? String(value) : "";
  const m = s.match(/\d{10,32}/);
  return m ? m[0] : "";
}

function sanitizeText(value, opts) {
  const maxLen = (opts && opts.maxLen) || 512;
  let s = value != null ? String(value) : "";
  if (opts && opts.stripHtml) s = s.replace(/<[^>]*>/g, "");
  s = s.trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

// Modelo GameNewsFeed em memória suficiente para as rotas testadas.
function createFakeFeedModel(initial) {
  let seq = 0;

  function nextId() {
    seq += 1;
    return "id" + String(seq).padStart(20, "0");
  }

  function withId(doc) {
    return Object.assign({}, doc, { _id: doc._id || nextId() });
  }

  let docs = (Array.isArray(initial) ? initial : []).map(withId);

  function matches(doc, query) {
    if (!query || typeof query !== "object") return true;
    if (query.guildId != null && doc.guildId !== query.guildId) return false;
    return true;
  }

  return {
    _all: () => docs,
    find(query) {
      const filtered = docs.filter((d) => matches(d, query));
      const chain = {
        sort() {
          return chain;
        },
        lean() {
          return Promise.resolve(filtered.map((d) => Object.assign({}, d)));
        },
      };
      return chain;
    },
    async deleteMany(query) {
      const before = docs.length;
      docs = docs.filter((d) => !matches(d, query));
      return { deletedCount: before - docs.length };
    },
    async insertMany(items) {
      const created = (Array.isArray(items) ? items : []).map((it) =>
        withId(it),
      );
      docs = docs.concat(created);
      return created;
    },
  };
}

// Modelo GameNews (estado dos feeds) em memória, read-only para os testes.
function createFakeNewsModel(docs) {
  const all = Array.isArray(docs) ? docs : [];
  return {
    find() {
      return {
        lean() {
          return Promise.resolve(all.map((d) => Object.assign({}, d)));
        },
      };
    },
  };
}

module.exports = {
  startApp,
  stopApp,
  passthrough,
  sanitizeId,
  sanitizeText,
  createFakeFeedModel,
  createFakeNewsModel,
};
