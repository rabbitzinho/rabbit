// src/dashboard/static.js
//
// Serviço de ficheiros do dashboard: shell HTML (com cache-busting de assets),
// assets de `public/` e o fallback SPA para rotas não-API.

const fs = require("fs");

// Cria o emissor do shell HTML. O ficheiro é lido uma única vez e guardado em
// cache já com `__ASSET_VERSION__` substituído.
function createIndexHtmlSender({ indexPath, assetVersion }) {
  let cached = null;

  return function sendIndexHtml(res) {
    try {
      if (cached === null) {
        const raw = fs.readFileSync(indexPath, "utf8");
        cached = raw.split("__ASSET_VERSION__").join(assetVersion);
      }
      res.type("html");
      res.setHeader("Cache-Control", "no-store");
      return res.send(cached);
    } catch (err) {
      console.error(
        `[Dashboard] Failed to serve the SPA shell (${indexPath}): ${err && err.message ? err.message : err}` +
          " — a pasta public/ tem de fazer parte da imagem (Dockerfile: COPY . .).",
      );
      return res.status(500).send("Dashboard unavailable");
    }
  };
}

// Serve o shell em `/` e `/index.html` e os assets de `public/`.
// Devolve o `sendIndexHtml` para o fallback SPA reutilizar.
function registerStaticRoutes({
  app,
  express,
  publicDir,
  indexPath,
  assetVersion,
}) {
  const sendIndexHtml = createIndexHtmlSender({ indexPath, assetVersion });

  // Serve UI explicitly at / to avoid any edge cases with platform routers/static defaults
  app.get("/", (req, res) => sendIndexHtml(res));

  // Some platforms/frontends may hit /index.html directly
  app.get("/index.html", (req, res) => sendIndexHtml(res));

  app.use(
    express.static(publicDir, {
      etag: true,
      // IMPORTANT: During active development / rapid deploys, aggressive maxAge caching breaks updates
      // (browsers keep stale JS and you end up with phantom syntax errors).
      maxAge: 0,
      setHeaders(res, filePath) {
        if (!filePath) return;

        // Never cache the HTML shell
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-store");
          return;
        }

        // Never cache dashboard JS/CSS to avoid stale client bugs after deploy
        // Normalize Windows path separators just in case.
        const fp = String(filePath).replace(/\\/g, "/");
        if (/\/js\/.*\.js$/.test(fp) || /\/css\/.*\.css$/.test(fp)) {
          res.setHeader("Cache-Control", "no-store");
          return;
        }

        // Default: allow revalidation
        res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );

  return { sendIndexHtml };
}

// Fallback SPA: serve o shell para rotas desconhecidas não-API.
// Deve ser registado DEPOIS de todas as rotas API/health para nunca intercetar JSON.
function registerSpaFallback({ app, sendIndexHtml }) {
  // Express v5 (path-to-regexp v6) does NOT accept a bare "*" route pattern, so we use a regex.
  app.get(/^\/(?!api\/).*/, (req, res, next) => {
    try {
      const p = req.path || "";
      // If it's a real asset path, let static handle it.
      if (p.includes(".")) return next();
      return sendIndexHtml(res);
    } catch {
      return next();
    }
  });
}

module.exports = {
  createIndexHtmlSender,
  registerStaticRoutes,
  registerSpaFallback,
};
