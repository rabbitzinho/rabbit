// tests/unit/trust.test.js

const { test, eq, ok } = require("./_harness");
const {
  getTrustConfig,
  normalizeTrustOverrides,
  getEffectiveMaxWarnings,
  getEffectiveMaxMessages,
  getEffectiveMuteDuration,
  getAdaptiveAutomodAdjustment,
  getAdaptiveMaxWarnings,
} = require("../../src/utils/trust");

const CFG = {
  enabled: true,
  base: 50,
  lowThreshold: 25,
  highThreshold: 75,
  lowTrustMessagesPenalty: 1,
  highTrustMessagesBonus: 0,
  lowTrustWarningsPenalty: 1,
  lowTrustMuteMultiplier: 1.5,
  highTrustMuteMultiplier: 0.8,
};

test("getTrustConfig: devolve valores coerentes", () => {
  const cfg = getTrustConfig();
  ok(typeof cfg.base === "number", "base deve ser número");
  ok(
    cfg.lowThreshold < cfg.highThreshold,
    "lowThreshold deve ser menor que highThreshold",
  );
});

test("normalizeTrustOverrides accepts guild-scoped values and partial presets", () => {
  const overrides = normalizeTrustOverrides({
    base: 45,
    lowThreshold: 20,
    highThreshold: 80,
  });
  eq(overrides.base, 45);
  eq(overrides.lowThreshold, 20);
  eq(overrides.highThreshold, 80);
});

test("normalizeTrustOverrides rejects values outside policy and invalid relationships", () => {
  eq(normalizeTrustOverrides({ base: 150 }), null);
  eq(normalizeTrustOverrides({ min: 80, max: 40 }), null);
  eq(normalizeTrustOverrides({ lowThreshold: 80, highThreshold: 20 }), null);
});

test("getEffectiveMaxMessages: penaliza trust baixo", () => {
  eq(getEffectiveMaxMessages(5, CFG, 10), 4);
});

test("getEffectiveMaxMessages: mantém base em trust médio", () => {
  eq(getEffectiveMaxMessages(5, CFG, 50), 5);
});

test("getEffectiveMaxMessages: aplica bónus em trust alto", () => {
  const cfgHigh = Object.assign({}, CFG, { highTrustMessagesBonus: 2 });
  eq(getEffectiveMaxMessages(5, cfgHigh, 90), 7);
});

test("getEffectiveMaxMessages: respeita piso mínimo de 1", () => {
  const cfg = Object.assign({}, CFG, { lowTrustMessagesPenalty: 99 });
  eq(getEffectiveMaxMessages(5, cfg, 10), 1);
});

test("getEffectiveMaxMessages: desativado devolve a base", () => {
  eq(getEffectiveMaxMessages(5, { enabled: false }, 10), 5);
});

test("getEffectiveMaxWarnings: penaliza trust baixo", () => {
  eq(getEffectiveMaxWarnings(3, CFG, 10), 2);
  eq(getEffectiveMaxWarnings(3, CFG, 90), 3);
});

test("getEffectiveMuteDuration: multiplicadores por nível de trust", () => {
  eq(getEffectiveMuteDuration(600000, CFG, 10), 900000); // 1.5x
  eq(getEffectiveMuteDuration(600000, CFG, 50), 600000);
  eq(getEffectiveMuteDuration(600000, CFG, 90), 480000); // 0.8x
});

test("getEffectiveMuteDuration: respeita limites mínimos/máximos", () => {
  // 1000 * 0.8 = 800ms -> abaixo do mínimo (30s)
  eq(getEffectiveMuteDuration(1000, CFG, 90), 30000);

  // Acima do máximo (28 dias)
  const maxMs = 28 * 24 * 60 * 60 * 1000;
  eq(getEffectiveMuteDuration(maxMs, CFG, 10), maxMs);
});

// --- Automoderação adaptativa (Trust médio do servidor) ---

const ADAPTIVE_CFG = Object.assign({}, CFG, {
  adaptive: {
    enabled: true,
    strictDelta: -1,
    lenientDelta: 1,
    minSampleSize: 5,
  },
});

test("getTrustConfig: expõe a configuração adaptativa (desligada por defeito)", () => {
  const cfg = getTrustConfig();
  ok(cfg.adaptive && typeof cfg.adaptive === "object", "adaptive deve existir");
  eq(cfg.adaptive.enabled, false);
});

test("getAdaptiveAutomodAdjustment: desativado não ajusta", () => {
  const cfg = Object.assign({}, CFG, { adaptive: { enabled: false } });
  const r = getAdaptiveAutomodAdjustment(cfg, { avgTrust: 10, sampleSize: 50 });
  eq(r.applied, false);
  eq(r.level, "off");
  eq(r.delta, 0);
});

test("getAdaptiveAutomodAdjustment: média baixa torna a automoderação mais rígida", () => {
  const r = getAdaptiveAutomodAdjustment(ADAPTIVE_CFG, {
    avgTrust: 20,
    sampleSize: 10,
  });
  eq(r.applied, true);
  eq(r.level, "strict");
  eq(r.delta, -1);
});

test("getAdaptiveAutomodAdjustment: média alta torna a automoderação mais tolerante", () => {
  const r = getAdaptiveAutomodAdjustment(ADAPTIVE_CFG, {
    avgTrust: 90,
    sampleSize: 10,
  });
  eq(r.applied, true);
  eq(r.level, "lenient");
  eq(r.delta, 1);
});

test("getAdaptiveAutomodAdjustment: média neutra não ajusta", () => {
  const r = getAdaptiveAutomodAdjustment(ADAPTIVE_CFG, {
    avgTrust: 50,
    sampleSize: 10,
  });
  eq(r.applied, false);
  eq(r.level, "neutral");
  eq(r.delta, 0);
});

test("getAdaptiveAutomodAdjustment: amostra insuficiente não ajusta", () => {
  const r = getAdaptiveAutomodAdjustment(ADAPTIVE_CFG, {
    avgTrust: 5,
    sampleSize: 2,
  });
  eq(r.applied, false);
  eq(r.level, "insufficient");
});

test("getAdaptiveAutomodAdjustment: amostra vazia (sem utilizadores) não ajusta", () => {
  const r = getAdaptiveAutomodAdjustment(ADAPTIVE_CFG, {
    avgTrust: null,
    sampleSize: 0,
  });
  eq(r.applied, false);
  eq(r.delta, 0);
});

test("getAdaptiveMaxWarnings: aplica o delta e respeita o piso de 1", () => {
  eq(
    getAdaptiveMaxWarnings(3, ADAPTIVE_CFG, { avgTrust: 20, sampleSize: 10 })
      .maxWarnings,
    2,
  );
  eq(
    getAdaptiveMaxWarnings(3, ADAPTIVE_CFG, { avgTrust: 90, sampleSize: 10 })
      .maxWarnings,
    4,
  );
  eq(
    getAdaptiveMaxWarnings(1, ADAPTIVE_CFG, { avgTrust: 20, sampleSize: 10 })
      .maxWarnings,
    1,
  );
});

test("getAdaptiveMaxWarnings: sem ajuste devolve o valor base intacto", () => {
  const cfg = Object.assign({}, CFG, { adaptive: { enabled: false } });
  eq(
    getAdaptiveMaxWarnings(3, cfg, { avgTrust: 10, sampleSize: 50 })
      .maxWarnings,
    3,
  );
});
