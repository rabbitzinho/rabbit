// tests/unit/logger.test.js
// Testa os helpers puros do logger de moderação (formato consistente de títulos
// e anotação do Trust com label de risco). Sem dependências externas.

const { test, ok, eq } = require("./_harness");
const logger = require("../../src/systems/logger");
const config = require("../../src/config/defaultConfig");
const { t } = require("../../src/systems/i18n");

const {
  normalizeActor,
  resolveGuild,
  decorateTitle,
  decorateDescriptionWithTrustLabel,
} = logger._internals;

// -----------------------------
// normalizeActor
// -----------------------------
test("normalizeActor rejeita atores sem id", () => {
  eq(normalizeActor(null), null);
  eq(normalizeActor(undefined), null);
  eq(normalizeActor({}), null);
  eq(normalizeActor({ user: {} }), null);
});

test("normalizeActor aceita um objeto de utilizador direto", () => {
  const actor = normalizeActor({ id: "1", username: "alice" });
  eq(actor.id, "1");
  eq(actor.tag, "alice#0000");
});

test("normalizeActor desembrulha { user } e preserva a tag", () => {
  const actor = normalizeActor({
    user: { id: "2", username: "bob", tag: "bob#1234" },
  });
  eq(actor.id, "2");
  eq(actor.tag, "bob#1234");
});

test("normalizeActor usa a username quando não há tag", () => {
  const actor = normalizeActor({ user: { id: "3", username: "carol" } });
  eq(actor.tag, "carol#0000");
});

// -----------------------------
// resolveGuild
// -----------------------------
test("resolveGuild prefere a guild explícita e faz fallback para user/executor", () => {
  const g = { id: "g1" };
  eq(resolveGuild(g, null, null), g);
  eq(resolveGuild(null, { guild: { id: "g2" } }, null).id, "g2");
  eq(resolveGuild(null, null, { guild: { id: "g3" } }).id, "g3");
  eq(resolveGuild(null, null, null), null);
});

// -----------------------------
// decorateTitle
// -----------------------------
test("decorateTitle aplica emoji de warn/mute", () => {
  eq(decorateTitle("User warn"), "⚠️ User warn");
  eq(decorateTitle("Mute applied"), "🔇 Mute applied");
  eq(decorateTitle("Timeout"), "🔇 Timeout");
});

test("decorateTitle sinaliza ações automáticas", () => {
  eq(decorateTitle("Auto warn"), "🤖⚠️ Auto warn");
  eq(decorateTitle("Automute"), "🤖🔇 Automute");
});

test("decorateTitle preserva títulos sem ação conhecida e trata vazios", () => {
  eq(decorateTitle("Kick"), "Kick");
  eq(decorateTitle(""), "Log");
  eq(decorateTitle(null), "Log");
});

// -----------------------------
// decorateDescriptionWithTrustLabel
// -----------------------------
test("decorateDescriptionWithTrustLabel não altera descrições vazias", () => {
  eq(decorateDescriptionWithTrustLabel(null), null);
  eq(decorateDescriptionWithTrustLabel(""), "");
});

test("decorateDescriptionWithTrustLabel não altera texto sem Trust", () => {
  eq(decorateDescriptionWithTrustLabel("Sem trust aqui"), "Sem trust aqui");
});

test("decorateDescriptionWithTrustLabel não duplica um label já existente", () => {
  const already = "Trust: **5/100** (High risk)";
  eq(decorateDescriptionWithTrustLabel(already), already);

  const alreadyPt = "Trust: **5/100** (Risco elevado)";
  eq(decorateDescriptionWithTrustLabel(alreadyPt), alreadyPt);
});

const trustCfg = config.trust || {};

if (trustCfg.enabled === false) {
  test("decorateDescriptionWithTrustLabel respeita trust.enabled=false", () => {
    const input = "Trust: **5/100**";
    eq(decorateDescriptionWithTrustLabel(input), input);
  });
} else {
  const low = trustCfg.lowThreshold ?? 10;
  const high = trustCfg.highThreshold ?? 60;
  const max = trustCfg.max ?? 100;
  const mid = Math.floor((low + high) / 2);

  test("decorateDescriptionWithTrustLabel marca risco elevado no limiar baixo", () => {
    eq(
      decorateDescriptionWithTrustLabel(`Trust: **${low}/${max}**`),
      `Trust: **${low}/${max}** (${t("log.trustRisk.high")})`,
    );
  });

  test("decorateDescriptionWithTrustLabel marca risco baixo no limiar alto", () => {
    eq(
      decorateDescriptionWithTrustLabel(`Trust: **${high}/${max}**`),
      `Trust: **${high}/${max}** (${t("log.trustRisk.low")})`,
    );
    eq(
      decorateDescriptionWithTrustLabel(`Trust: **${max}/${max}**`),
      `Trust: **${max}/${max}** (${t("log.trustRisk.low")})`,
    );
  });

  test("decorateDescriptionWithTrustLabel marca risco médio entre limiares", () => {
    ok(mid > low && mid < high, "valor intermédio inválido: " + mid);
    eq(
      decorateDescriptionWithTrustLabel(`Trust: **${mid}/${max}**`),
      `Trust: **${mid}/${max}** (${t("log.trustRisk.medium")})`,
    );
  });

  test('decorateDescriptionWithTrustLabel suporta "Trust after mute"', () => {
    eq(
      decorateDescriptionWithTrustLabel(`Trust after mute: **${high}/${max}**`),
      `Trust after mute: **${high}/${max}** (${t("log.trustRisk.low")})`,
    );
  });

  test("decorateDescriptionWithTrustLabel assume o máximo por omissão", () => {
    eq(
      decorateDescriptionWithTrustLabel(`Trust: **${high}**`),
      `Trust: **${high}/${max}** (${t("log.trustRisk.low")})`,
    );
  });

  test("decorateDescriptionWithTrustLabel é idempotente", () => {
    const once = decorateDescriptionWithTrustLabel(`Trust: **${low}/${max}**`);
    eq(decorateDescriptionWithTrustLabel(once), once);
  });
}
