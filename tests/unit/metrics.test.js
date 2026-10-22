// tests/unit/metrics.test.js

const { test, eq, ok } = require("./_harness");
const metrics = require("../../src/systems/metrics");

function fakeReq(method, path, routePath) {
  const req = { method, path, url: path, baseUrl: "" };
  if (routePath) req.route = { path: routePath };
  return req;
}

test("normalizeRoutePath: substitui snowflakes por :id", () => {
  eq(
    metrics.normalizeRoutePath("/api/guilds/123456789012345678/config"),
    "/api/guilds/:id/config",
  );
  eq(metrics.normalizeRoutePath("/api/logs"), "/api/logs");
});

test("normalizeRoutePath: remove query string e normaliza vazio", () => {
  eq(metrics.normalizeRoutePath("/api/logs?limit=50"), "/api/logs");
  eq(metrics.normalizeRoutePath(""), "/");
});

test("recordHttpRequest: agrega contagem, erros e latência", () => {
  metrics.resetMetrics();

  metrics.recordHttpRequest(fakeReq("GET", "/api/overview"), 200, 10);
  metrics.recordHttpRequest(fakeReq("GET", "/api/overview"), 200, 20);
  metrics.recordHttpRequest(fakeReq("GET", "/api/overview"), 500, 30);

  const snapshot = metrics.getMetrics();
  const route = snapshot.routes.find((r) => r.route === "/api/overview");

  ok(route, "a rota deve existir no snapshot");
  eq(route.count, 3);
  eq(route.errors, 1);
  eq(route.avgMs, 20);
  eq(route.maxMs, 30);
  eq(route.lastStatusCode, 500);
  eq(snapshot.totals.requests, 3);
  eq(snapshot.totals.errors, 1);
});

test("recordHttpRequest: agrupa guildIds diferentes na mesma rota", () => {
  metrics.resetMetrics();

  metrics.recordHttpRequest(
    fakeReq("GET", "/api/guilds/111111111111111111/config"),
    200,
    5,
  );
  metrics.recordHttpRequest(
    fakeReq("GET", "/api/guilds/222222222222222222/config"),
    200,
    5,
  );

  const snapshot = metrics.getMetrics();
  eq(snapshot.totals.routes, 1);
  eq(snapshot.routes[0].route, "/api/guilds/:id/config");
  eq(snapshot.routes[0].count, 2);
});

test("recordHttpRequest: usa o route path do Express quando disponível", () => {
  metrics.resetMetrics();

  metrics.recordHttpRequest(
    fakeReq(
      "POST",
      "/api/guilds/333333333333333333/test-log-channels",
      "/api/guilds/:guildId/test-log-channels",
    ),
    200,
    8,
  );

  const snapshot = metrics.getMetrics();
  eq(snapshot.routes[0].route, "/api/guilds/:guildId/test-log-channels");
  eq(snapshot.routes[0].method, "POST");
});

test("recordHttpRequest: ignora durações inválidas", () => {
  metrics.resetMetrics();

  metrics.recordHttpRequest(fakeReq("GET", "/api/health"), 200, NaN);
  metrics.recordHttpRequest(fakeReq("GET", "/api/health"), 200, -5);

  const snapshot = metrics.getMetrics();
  eq(snapshot.routes[0].avgMs, 0);
  eq(snapshot.routes[0].maxMs, 0);
});

test("resetMetrics: limpa o registo", () => {
  metrics.recordHttpRequest(fakeReq("GET", "/api/overview"), 200, 1);
  metrics.resetMetrics();

  const snapshot = metrics.getMetrics();
  eq(snapshot.totals.requests, 0);
  eq(snapshot.totals.routes, 0);
});

test("prometheusLabels: escapa aspas e barras invertidas", () => {
  eq(metrics.prometheusLabels({ route: 'a"b' }), '{route="a\\"b"}');
  eq(metrics.prometheusLabels({ route: "a\\b" }), '{route="a\\\\b"}');
});

test("prometheusLabels: sem etiquetas devolve string vazia", () => {
  eq(metrics.prometheusLabels({ route: null }), "");
});

test("formatPrometheus: expõe contadores e latências em texto válido", () => {
  metrics.resetMetrics();
  metrics.recordHttpRequest(fakeReq("GET", "/api/overview"), 200, 10);
  metrics.recordHttpRequest(fakeReq("GET", "/api/overview"), 500, 30);

  const text = metrics.formatPrometheus({
    counters: { totalCommandsExecuted: 7, totalInfractionsCreated: 2 },
  });

  ok(text.includes("rabbit_uptime_seconds "), "deve expor uptime");
  ok(
    text.includes(
      'rabbit_http_requests_total{method="GET",route="/api/overview"} 2',
    ),
    "deve expor o total de pedidos",
  );
  ok(
    text.includes(
      'rabbit_http_errors_total{method="GET",route="/api/overview"} 1',
    ),
    "deve expor os erros",
  );
  ok(
    text.includes(
      'rabbit_http_request_duration_ms{method="GET",route="/api/overview",quantile="avg"} 20',
    ),
    "deve expor a média",
  );
  ok(
    text.includes(
      'rabbit_http_request_duration_ms{method="GET",route="/api/overview",quantile="p95"} 30',
    ),
    "deve expor o p95",
  );
  ok(
    text.includes(
      'rabbit_http_request_duration_ms{method="GET",route="/api/overview",quantile="max"} 30',
    ),
    "deve expor o máximo",
  );
  ok(
    text.includes("rabbit_commands_executed_total 7"),
    "deve expor os comandos executados",
  );
  ok(
    text.includes("rabbit_antispam_actions_total 0"),
    "contadores em falta devem cair para 0",
  );
  eq(text.charAt(text.length - 1), "\n");
});
