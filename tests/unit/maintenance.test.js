// tests/unit/maintenance.test.js
// Testa os helpers puros do scheduler de manutenção (configuração, cálculo do
// cutoff e filtro de limpeza). Não toca na base de dados.

const { test, ok, eq, deepEq } = require("./_harness");
const {
  resolveMaintenanceConfig,
  computeCutoff,
  buildPruneFilter,
} = require("../../src/systems/maintenance");

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

// -----------------------------
// resolveMaintenanceConfig
// -----------------------------
test("resolveMaintenanceConfig aplica os defaults quando não há config", () => {
  const cfg = resolveMaintenanceConfig({});
  eq(cfg.enabled, true);
  eq(cfg.infractionDays, 180);
  eq(cfg.dashboardLogDays, 60);
  eq(cfg.intervalMs, DEFAULT_INTERVAL_MS);
});

test("resolveMaintenanceConfig tolera config em falta ou inválida", () => {
  eq(resolveMaintenanceConfig(undefined).infractionDays, 180);
  eq(resolveMaintenanceConfig(null).dashboardLogDays, 60);
  eq(
    resolveMaintenanceConfig({ maintenance: null }).intervalMs,
    DEFAULT_INTERVAL_MS,
  );
});

test("resolveMaintenanceConfig respeita overrides válidos", () => {
  const cfg = resolveMaintenanceConfig({
    maintenance: {
      enabled: false,
      pruneInfractionsOlderThanDays: 30,
      pruneDashboardLogsOlderThanDays: 7,
      intervalMs: 10 * 60 * 1000,
    },
  });
  eq(cfg.enabled, false);
  eq(cfg.infractionDays, 30);
  eq(cfg.dashboardLogDays, 7);
  eq(cfg.intervalMs, 10 * 60 * 1000);
});

test("resolveMaintenanceConfig só considera enabled=false como desligado", () => {
  eq(resolveMaintenanceConfig({ maintenance: { enabled: 0 } }).enabled, true);
  eq(
    resolveMaintenanceConfig({ maintenance: { enabled: false } }).enabled,
    false,
  );
});

test("resolveMaintenanceConfig impõe o intervalo mínimo de 5 minutos", () => {
  eq(
    resolveMaintenanceConfig({ maintenance: { intervalMs: 1000 } }).intervalMs,
    DEFAULT_INTERVAL_MS,
  );
  eq(
    resolveMaintenanceConfig({ maintenance: { intervalMs: 0 } }).intervalMs,
    DEFAULT_INTERVAL_MS,
  );
  eq(
    resolveMaintenanceConfig({ maintenance: { intervalMs: "abc" } }).intervalMs,
    DEFAULT_INTERVAL_MS,
  );
  eq(
    resolveMaintenanceConfig({ maintenance: { intervalMs: 5 * 60 * 1000 } })
      .intervalMs,
    5 * 60 * 1000,
  );
});

// -----------------------------
// computeCutoff
// -----------------------------
test("computeCutoff devolve null para janelas não positivas", () => {
  eq(computeCutoff(0, Date.now()), null);
  eq(computeCutoff(-5, Date.now()), null);
  eq(computeCutoff(undefined, Date.now()), null);
  eq(computeCutoff("abc", Date.now()), null);
  eq(computeCutoff(NaN, Date.now()), null);
});

test('computeCutoff calcula a data-limite a partir de "agora"', () => {
  const now = 1_700_000_000_000;
  eq(computeCutoff(1, now).getTime(), now - DAY_MS);
  eq(computeCutoff(180, now).getTime(), now - 180 * DAY_MS);
});

test('computeCutoff usa Date.now() quando "now" não é numérico', () => {
  const before = Date.now();
  const cutoff = computeCutoff(1, "agora");
  ok(cutoff instanceof Date, "deveria devolver uma Date");
  ok(
    cutoff.getTime() >= before - DAY_MS - 1000,
    "cutoff inesperadamente antigo",
  );
  ok(
    cutoff.getTime() <= Date.now() - DAY_MS + 1000,
    "cutoff inesperadamente recente",
  );
});

// -----------------------------
// buildPruneFilter
// -----------------------------
test("buildPruneFilter constrói o filtro $lt por createdAt", () => {
  const cutoff = new Date("2024-01-01T00:00:00.000Z");
  deepEq(buildPruneFilter(cutoff), { createdAt: { $lt: cutoff } });
});
