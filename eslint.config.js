import js from "@eslint/js";
import n from "eslint-plugin-n";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

export default [
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
      "n/no-missing-import": "error",
      "n/no-process-exit": "warn",
      "n/no-unpublished-import": "error",
      "n/no-unsupported-features/node-builtins": ["error", { ignores: ["fetch"] }],
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
      "n/no-unpublished-import": "off",
    },
  },
];
