import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "dist-desktop/**", "artifacts/**", "coverage/**", "node_modules/**"] },
  ...tseslint.configs.recommended,
  { files: ["desktop/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  { files: ["desktop/renderer/**/*.{js,jsx}"], languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } }, globals: { window: "readonly", document: "readonly" } } },
);
