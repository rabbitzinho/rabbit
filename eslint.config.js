// Configuração ESLint (flat config — ESLint v9+)
// Objetivo: adoção progressiva sem bloquear o CI. A maioria das regras está em
// 'warn' para não falhar builds enquanto o código legado for sendo limpo.

const globals = require("globals");

const sharedRules = {
  // Erros reais, mas que o parser/engine já apanham — seguros como erro.
  "no-dupe-keys": "error",
  "no-unreachable": "error",

  // Regras de limpeza: avisos (não falham o CI).
  "no-unused-vars": [
    "warn",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
  ],
  "no-undef": "warn",
  "no-redeclare": "warn",
  "no-empty": ["warn", { allowEmptyCatch: true }],
  "no-useless-escape": "warn",
  "no-fallthrough": "warn",
  "no-constant-condition": ["warn", { checkLoops: false }],
  // `== null` is intentionally used for nullish checks (null + undefined).
  eqeqeq: ["warn", "always", { null: "ignore" }],
  "no-console": "off",
  "no-var": "off",
  "prefer-const": "off",
};

module.exports = [
  {
    ignores: ["node_modules/**", "coverage/**", "dist/**", "public/vendor/**"],
  },

  // Backend + scripts + testes (CommonJS / Node)
  {
    files: ["src/**/*.js", "scripts/**/*.js", "tests/**/*.js", "*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: sharedRules,
  },

  // Frontend do dashboard (browser)
  {
    files: ["public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser },
    },
    rules: sharedRules,
  },
];
