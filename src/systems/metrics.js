// src/systems/metrics.js
//
// Registo em memória de métricas de runtime da dashboard (ver docs/ROADMAP.md §6).
// Mantém contadores e latência por rota sem depender de ferramentas externas.
// É exposto de forma protegida em GET /api/internal/metrics.

const MAX_ROUTES = 300;
const MAX_SAMPLES = 200;

// key -> { method, route, count, errors, totalMs, maxMs, lastMs, lastStatusCode, samples[] }
const httpRoutes = new Map();

function round(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// Substitui identificadores variáveis (snowflakes do Discord, ObjectIds, tokens)
// por ":id" para que todas as chamadas caiam na mesma rota lógica.
function normalizeRoutePath(rawPath) {
  const raw = String(rawPath || "").split("?")[0];
  if (!raw) return "/";

  const parts = raw.split("/").map((segment) => {
    if (!segment) return segment;
    if (/^\d{5,}$/.test(segment)) return ":id";
    if (/^[a-f0-9]{16,}$/i.test(segment)) return ":id";
    return segment;
  });

  return parts.join("/");
}

function resolveRouteKey(req) {
  const method = String((req && req.method) || "GET").toUpperCase();
  const matched = req && req.route && req.route.path;

  let path;
  if (typeof matched === "string") {
    path = `${(req && req.baseUrl) || ""}${matched}`;
  } else {
    path = (req && (req.path || req.url)) || "/";
  }

  return `${method} ${normalizeRoutePath(path)}`;
}

function evictLeastUsed() {
  let oldestKey = null;
  let oldestCount = Infinity;
  for (const [key, entry] of httpRoutes) {
    if (entry.count < oldestCount) {
      oldestCount = entry.count;
      oldestKey = key;
    }
  }
  if (oldestKey) httpRoutes.delete(oldestKey);
}

function recordHttpRequest(req, statusCode, durationMs) {
  const key = resolveRouteKey(req);
  let entry = httpRoutes.get(key);

  if (!entry) {
    if (httpRoutes.size >= MAX_ROUTES) evictLeastUsed();
    const separator = key.indexOf(" ");
    entry = {
      method: key.slice(0, separator),
      route: key.slice(separator + 1),
      count: 0,
      errors: 0,
      totalMs: 0,
      maxMs: 0,
      lastMs: 0,
      lastStatusCode: 0,
      samples: [],
    };
    httpRoutes.set(key, entry);
  }

  const ms = Number(durationMs);
  const safeMs = Number.isFinite(ms) && ms >= 0 ? ms : 0;
  const code = Number(statusCode) || 0;

  entry.count += 1;
  entry.totalMs += safeMs;
  entry.maxMs = Math.max(entry.maxMs, safeMs);
  entry.lastMs = safeMs;
  entry.lastStatusCode = code;
  if (code >= 500) entry.errors += 1;

  entry.samples.push(safeMs);
  if (entry.samples.length > MAX_SAMPLES) entry.samples.shift();

  return entry;
}

function percentile(samples, p) {
  if (!samples.length) return 0;
  const sorted = samples.slice().sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function getMetrics() {
  const routes = [];
  let requests = 0;
  let errors = 0;

  for (const entry of httpRoutes.values()) {
    requests += entry.count;
    errors += entry.errors;

    routes.push({
      method: entry.method,
      route: entry.route,
      count: entry.count,
      errors: entry.errors,
      avgMs: round(entry.count ? entry.totalMs / entry.count : 0),
      p95Ms: round(percentile(entry.samples, 95)),
      maxMs: round(entry.maxMs),
      lastMs: round(entry.lastMs),
      lastStatusCode: entry.lastStatusCode,
    });
  }

  routes.sort((a, b) => b.count - a.count || a.route.localeCompare(b.route));

  return {
    generatedAt: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    totals: { requests, errors, routes: routes.length },
    routes,
  };
}

function resetMetrics() {
  httpRoutes.clear();
}

// ----------------------------- Prometheus ----------------------------------
// Formato de texto (version 0.0.4) para scraping por Prometheus/Grafana.

function prometheusLabels(labels) {
  const entries = Object.entries(labels).filter(
    ([, value]) => value !== undefined && value !== null,
  );
  if (!entries.length) return "";

  const rendered = entries.map(([key, value]) => {
    const escaped = String(value)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n");
    return `${key}="${escaped}"`;
  });

  return `{${rendered.join(",")}}`;
}

function formatPrometheus(extra = {}) {
  const snapshot = getMetrics();
  const lines = [];

  lines.push("# HELP rabbit_uptime_seconds Tempo de atividade do processo.");
  lines.push("# TYPE rabbit_uptime_seconds gauge");
  lines.push(`rabbit_uptime_seconds ${snapshot.uptimeSeconds}`);

  lines.push(
    "# HELP rabbit_http_requests_total Pedidos HTTP processados por rota.",
  );
  lines.push("# TYPE rabbit_http_requests_total counter");
  for (const route of snapshot.routes) {
    lines.push(
      `rabbit_http_requests_total${prometheusLabels({ method: route.method, route: route.route })} ${route.count}`,
    );
  }

  lines.push("# HELP rabbit_http_errors_total Respostas 5xx por rota.");
  lines.push("# TYPE rabbit_http_errors_total counter");
  for (const route of snapshot.routes) {
    lines.push(
      `rabbit_http_errors_total${prometheusLabels({ method: route.method, route: route.route })} ${route.errors}`,
    );
  }

  lines.push(
    "# HELP rabbit_http_request_duration_ms Latência por rota em milissegundos.",
  );
  lines.push("# TYPE rabbit_http_request_duration_ms gauge");
  for (const route of snapshot.routes) {
    lines.push(
      `rabbit_http_request_duration_ms${prometheusLabels({ method: route.method, route: route.route, quantile: "avg" })} ${route.avgMs}`,
    );
    lines.push(
      `rabbit_http_request_duration_ms${prometheusLabels({ method: route.method, route: route.route, quantile: "p95" })} ${route.p95Ms}`,
    );
    lines.push(
      `rabbit_http_request_duration_ms${prometheusLabels({ method: route.method, route: route.route, quantile: "max" })} ${route.maxMs}`,
    );
  }

  const counters = (extra && extra.counters) || {};
  const counterMetrics = [
    [
      "rabbit_commands_executed_total",
      "Comandos slash executados.",
      counters.totalCommandsExecuted,
    ],
    [
      "rabbit_infractions_created_total",
      "Infrações registadas.",
      counters.totalInfractionsCreated,
    ],
    [
      "rabbit_automod_actions_total",
      "Ações de auto-moderação.",
      counters.autoModActions,
    ],
    [
      "rabbit_antispam_actions_total",
      "Ações de anti-spam.",
      counters.antiSpamActions,
    ],
  ];

  for (const [name, help, value] of counterMetrics) {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} counter`);
    lines.push(`${name} ${Number.isFinite(Number(value)) ? Number(value) : 0}`);
  }

  return lines.join("\n") + "\n";
}

module.exports = {
  recordHttpRequest,
  getMetrics,
  resetMetrics,
  normalizeRoutePath,
  formatPrometheus,
  prometheusLabels,
};
