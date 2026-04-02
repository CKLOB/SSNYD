const js = require("@eslint/js");
const n = require("eslint-plugin-n");
const prettierConfig = require("eslint-config-prettier");
const globals = require("globals");

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    plugins: { n },
    rules: {
      ...n.configs["flat/recommended"].rules,
      "n/no-missing-require": "error",
      "n/no-process-exit": "warn",
      "n/no-unpublished-require": "error",
    },
  },
  prettierConfig,
  {
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-useless-assignment": "warn",
    },
  },
  {
    files: ["eslint.config.js"],
    rules: {
      "n/no-unpublished-require": "off",
    },
  },
];
