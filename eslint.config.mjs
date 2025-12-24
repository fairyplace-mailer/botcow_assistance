import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "public/**",
    ],
  },

  // Base recommended rules
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Node/CommonJS config files (avoid `module is not defined` etc.)
  {
    files: [
      "**/*.config.{js,cjs,mjs}",
      "jest.config.js",
      "next.config.{js,cjs,mjs}",
    ],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        module: "readonly",
        require: "readonly",
        process: "readonly",
        __dirname: "readonly",
        exports: "readonly",
      },
    },
    rules: {
      "no-undef": "off",
    },
  },

  // TypeScript policy: keep cost/reliability checks, relax legacy noise
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // Legacy codebase: keep visible but not blocking.
      "@typescript-eslint/no-explicit-any": "warn",

      // Reliability signal without drowning in noise.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  // Next.js rules: keep core-web-vitals, but don't block on non-critical ones
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...nextPlugin.configs["core-web-vitals"].rules,

      // Not a cost/reliability issue for this project; allow it to avoid blocking CI.
      "@next/next/no-sync-scripts": "warn",
    },
  },
];
