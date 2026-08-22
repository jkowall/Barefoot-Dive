import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "android/", "ios/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.es2023 },
      parserOptions: { project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname }
    },
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules, "@typescript-eslint/explicit-function-return-type": "off" }
  },
  {
    files: ["vite.config.ts", "capacitor.config.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.es2023 } }
  }
);
