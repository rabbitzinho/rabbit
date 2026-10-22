// tests/unit/run-unit.js
// Descobre e corre todos os ficheiros *.test.js nesta pasta.

const fs = require("fs");
const path = require("path");
const harness = require("./_harness");

async function main() {
  const dir = __dirname;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".test.js"))
    .sort();

  console.log("Unit tests (" + files.length + " ficheiro(s)):");

  for (const file of files) {
    console.log("\n" + file);
    try {
      require(path.join(dir, file));
    } catch (err) {
      harness.results.fail += 1;
      harness.results.failures.push({
        name: file,
        message: err && err.message ? err.message : String(err),
      });
      console.error(
        "  \u2717 falha ao carregar " +
          file +
          ": " +
          (err && err.message ? err.message : err),
      );
    }
  }

  const { pass, fail, failures } = await harness.wait();
  console.log("\nResumo: " + pass + " passaram, " + fail + " falharam");

  if (fail > 0) {
    console.error("Falhas:");
    for (const f of failures) console.error("  - " + f.name + ": " + f.message);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Falha ao executar testes unitários:", err);
  process.exitCode = 1;
});
