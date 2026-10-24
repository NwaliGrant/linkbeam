import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const NO_BUILT_SQL = [
  {
    selector: "CallExpression[callee.property.name=/^(prepare|exec)$/] > TemplateLiteral[expressions.length>0]",
    message: "Do not build SQL with template literals. Use a fixed string and .bind() for values.",
  },
  {
    selector: "CallExpression[callee.property.name=/^(prepare|exec)$/] > BinaryExpression",
    message: "Do not build SQL by joining strings. Use a fixed string and .bind() for values.",
  },
];

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/.astro/**", "**/.wrangler/**", "**/coverage/**", "**/*.astro"],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "error",
    },
  },
  {
    // Command-line tools print their results on purpose.
    files: ["scripts/**/*.mjs"],
    rules: { "no-console": "off" },
  },
  {
    files: ["apps/api/src/**/*.ts"],
    rules: { "no-restricted-syntax": ["error", ...NO_BUILT_SQL] },
  },
);
