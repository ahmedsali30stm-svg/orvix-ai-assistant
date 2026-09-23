import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["node_modules", "dist", ".jarvis", "*.tsbuildinfo", "apps/desktop/dist"] },
  ...tseslint.configs.recommended,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": "off",
    },
  }
);
