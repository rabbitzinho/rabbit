// tests/unit/regex.test.js

const { test, eq, ok } = require("./_harness");
const { escapeRegex } = require("../../src/utils/regex");

test("escapeRegex: escapa meta-caracteres de regex", () => {
  eq(escapeRegex("a.b"), "a\\.b");
  eq(escapeRegex("a*b"), "a\\*b");
  eq(escapeRegex("a+b"), "a\\+b");
  eq(escapeRegex("(x)"), "\\(x\\)");
  eq(escapeRegex("[y]"), "\\[y\\]");
  eq(escapeRegex("a|b"), "a\\|b");
});

test("escapeRegex: valores nulos/vazios", () => {
  eq(escapeRegex(null), "");
  eq(escapeRegex(undefined), "");
  eq(escapeRegex(""), "");
});

test("escapeRegex: texto escapado corresponde literalmente", () => {
  const re = new RegExp(escapeRegex("a.b"));
  ok(re.test("a.b"), 'devia corresponder a "a.b"');
  ok(!re.test("axb"), 'não devia corresponder a "axb"');
});
