/**
 * Base preset for every TypeScript and JavaScript file in the repo.
 *
 * TS files get typescript-eslint `strictTypeChecked`, with type information from the TypeScript project service:
 * each file is checked against the nearest tsconfig.json, so every linted TS file must be in a tsconfig `include`.
 * JS files are tooling (configs, smoke scripts): they keep the syntactic rules and skip the type-aware ones.
 */
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";

export const TS_FILES = ["**/*.{ts,tsx,mts,cts}"];
export const JS_FILES = ["**/*.{js,mjs,cjs}"];
export const ALL_FILES = [...TS_FILES, ...JS_FILES];

/**
 * @param {{ tsconfigRootDir: string }} options `tsconfigRootDir` is the repo root (the root config's `import.meta.dirname`).
 * @returns {import("eslint").Linter.Config[]}
 */
export function base({ tsconfigRootDir }) {
  return [
    { ...js.configs.recommended, name: "finlytics/base/eslint-recommended", files: ALL_FILES },
    ...tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: config.files ?? ALL_FILES })),
    {
      name: "finlytics/base/type-information",
      files: ALL_FILES,
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
    },
    {
      name: "finlytics/base/rules",
      files: ALL_FILES,
      rules: {
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/consistent-type-imports": [
          "error",
          { prefer: "type-imports", fixStyle: "separate-type-imports" },
        ],
      },
    },
    { ...tseslint.configs.disableTypeChecked, name: "finlytics/base/js-without-type-information", files: JS_FILES },
    {
      name: "finlytics/base/commonjs",
      files: ["**/*.cjs"],
      languageOptions: { sourceType: "commonjs" },
      rules: { "@typescript-eslint/no-require-imports": "off" },
    },
  ];
}

/** Switches off every rule that conflicts with Prettier. Must be the last entry of the root config. */
export const prettier = { ...eslintConfigPrettier, name: "finlytics/prettier" };
