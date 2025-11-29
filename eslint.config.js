// eslint.config.js — минимальный рабочий конфиг для ESLint 9+
import next from "eslint-config-next";

export default [
  {
    ignores: ["node_modules", ".next", "dist"],
  },
  ...next(),
];