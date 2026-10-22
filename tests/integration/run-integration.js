// tests/integration/run-integration.js
// Corre todos os testes de integração com o runner nativo do Node (node:test).

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".test.js"))
  .sort()
  .map((f) => path.join(dir, f));

if (!files.length) {
  console.log("Sem testes de integração.");
  process.exit(0);
}

const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
});
process.exit(result.status || 0);
