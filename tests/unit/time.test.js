// tests/unit/time.test.js

const { test, eq } = require("./_harness");
const { parseDuration, formatDuration } = require("../../src/utils/time");

test("parseDuration: unidades suportadas (s/m/h/d)", () => {
  eq(parseDuration("10s"), 10 * 1000);
  eq(parseDuration("5m"), 5 * 60 * 1000);
  eq(parseDuration("2h"), 2 * 60 * 60 * 1000);
  eq(parseDuration("7d"), 7 * 24 * 60 * 60 * 1000);
});

test("parseDuration: número simples é interpretado como segundos", () => {
  eq(parseDuration("90"), 90 * 1000);
});

test("parseDuration: aceita espaços e maiúsculas", () => {
  eq(parseDuration("  5M  "), 5 * 60 * 1000);
});

test("parseDuration: entradas inválidas devolvem null", () => {
  eq(parseDuration("0"), null);
  eq(parseDuration("abc"), null);
  eq(parseDuration("10x"), null);
  eq(parseDuration(""), null);
  eq(parseDuration(null), null);
  eq(parseDuration(undefined), null);
  eq(parseDuration(10), null);
});

test("formatDuration: formata para a unidade mais compacta", () => {
  eq(formatDuration(1000), "1s");
  eq(formatDuration(60 * 1000), "1m");
  eq(formatDuration(10 * 60 * 1000), "10m");
  eq(formatDuration(60 * 60 * 1000), "1h");
  eq(formatDuration(24 * 60 * 60 * 1000), "1d");
  eq(formatDuration(90 * 1000), "90s");
});

test("parseDuration(formatDuration(x)) faz round-trip", () => {
  const values = [
    1000,
    30 * 1000,
    10 * 60 * 1000,
    2 * 60 * 60 * 1000,
    3 * 24 * 60 * 60 * 1000,
  ];
  for (const v of values) {
    eq(parseDuration(formatDuration(v)), v);
  }
});
