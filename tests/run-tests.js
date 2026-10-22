/*
  Minimal CI tests (no external services required).
  هدف: apanhar regressões óbvias (i18n incompleto, ficheiros em falta, erros de require).
*/

const path = require("path");
const fs = require("fs");

function fail(msg) {
  console.error("TEST FAIL:", msg);
  process.exitCode = 1;
}

function ok(msg) {
  console.log("TEST OK:", msg);
}

// 1) Ensure core entrypoints exist
const mustExist = [
  "src/index.js",
  "src/dashboard.js",
  "public/index.html",
  "public/css/tokens.css",
  "public/js/dashboard.js",
  "public/locales/pt.js",
  "public/locales/en.js",
];

for (const p of mustExist) {
  const abs = path.join(process.cwd(), p);
  if (!fs.existsSync(abs)) fail(`Missing file: ${p}`);
}
if (!process.exitCode) ok("Core files present");

// 2) i18n parity: PT and EN should share the same keys
function loadLocale(rel) {
  const abs = path.join(process.cwd(), rel);
  // locales are plain JS that set window.__ = {...} in browser;
  // in Node, we parse with a tiny sandbox.
  const code = fs.readFileSync(abs, "utf8");
  const sandbox = { window: {} };
  const fn = new Function("window", code + "\nreturn window;");
  const win = fn(sandbox.window);
  const dict =
    win && (win.__LOCALE__ || win.locale || win.__ || win.TRANSLATIONS);
  // Fallback: the project uses `window.OZARK_LOCALES = {...}` in some builds.
  if (dict && typeof dict === "object") return dict;

  // Generic extraction: find first object literal assignment "window.X = {...}" and eval just the RHS.
  const m = code.match(/=\s*(\{[\s\S]*\});?/);
  if (!m) return null;
  try {
    return eval("(" + m[1] + ")");
  } catch {
    return null;
  }
}

const pt = loadLocale("public/locales/pt.js");
const en = loadLocale("public/locales/en.js");
if (!pt || !en) {
  fail("Could not load locale dictionaries (pt/en).");
} else {
  const ptKeys = Object.keys(pt).sort();
  const enKeys = Object.keys(en).sort();

  const missingInEn = ptKeys.filter((k) => !enKeys.includes(k));
  const missingInPt = enKeys.filter((k) => !ptKeys.includes(k));

  if (missingInEn.length)
    fail(
      `Missing EN keys: ${missingInEn.slice(0, 20).join(", ")}${missingInEn.length > 20 ? "…" : ""}`,
    );
  if (missingInPt.length)
    fail(
      `Missing PT keys: ${missingInPt.slice(0, 20).join(", ")}${missingInPt.length > 20 ? "…" : ""}`,
    );

  if (!process.exitCode) ok("i18n keys parity (pt/en)");
}

// 3) Run the project i18n audit script if present
try {
  const audit = require(path.join(process.cwd(), "scripts", "i18n-audit.js"));
  // if it exports a function, call it; otherwise it already ran.
  if (typeof audit === "function") audit();
  ok("i18n audit script executed");
} catch (e) {
  // Not fatal, but report
  console.warn(
    "TEST WARN: Could not run scripts/i18n-audit.js in-process. Reason:",
    e.message,
  );
}

// 4) Syntax check critical modules without executing them (no dependency loading)
const { spawnSync } = require("child_process");

const syntaxChecks = [
  "src/index.js",
  "src/dashboard.js",
  "src/systems/ticketThreads.js",
  "src/systems/gamenews.js",
  "src/systems/antiSpam.js",
  "src/systems/metrics.js",
  "src/systems/logger.js",
  "src/systems/maintenance.js",
  "src/systems/warningsService.js",
  "src/services/guildService.js",
  "src/dashboard/authMiddleware.js",
  "src/dashboard/logStore.js",
  "src/dashboard/sanitize.js",
  "src/dashboard/schemas.js",
  "src/dashboard/models.js",
  "src/dashboard/audit.js",
  "src/dashboard/middleware.js",
  "src/dashboard/static.js",
  "src/dashboard/routes/index.js",
  "src/database/models/User.js",
  "src/database/models/GameNews.js",
  "src/database/models/GameNewsFeed.js",
  "src/dashboard/routes/core.js",
  "src/dashboard/routes/user.js",
  "src/dashboard/routes/gamenews.js",
  "src/dashboard/routes/trust.js",
  "src/dashboard/routes/_errors.js",
  "src/dashboard/routes/tickets.js",
  "src/dashboard/routes/guilds.js",
  "src/dashboard/routes/admin.js",
  "src/dashboard/routes/tempVoice.js",
  "src/dashboard/routes/auth.js",
  "src/dashboard/routes/users.js",
  "src/services/moderationService.js",
  "src/services/gameNewsService.js",
  "public/js/dashboard.js",
  "public/js/dashboard.users.js",
  "public/js/dashboard.gamenews.js",
  "public/locales/pt.js",
  "public/locales/en.js",
];

for (const rel of syntaxChecks) {
  const abs = path.join(process.cwd(), rel);
  const r = spawnSync(process.execPath, ["--check", abs], { stdio: "pipe" });
  if (r.status !== 0) {
    fail(
      `Syntax check failed for ${rel}: ${(r.stderr || "").toString().trim()}`,
    );
  } else {
    ok(`Syntax OK: ${rel}`);
  }
}

if (!process.exitCode) {
  ok("All tests passed");
}
