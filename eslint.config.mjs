import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      // Type assertions hide bugs; narrow with zod or type guards instead. `as const` stays allowed.
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "Read configuration through serverEnv() / clientEnv in src/env, never process.env directly.",
        },
      ],
    },
  },
  {
    // Files that legitimately read process.env or print to the console.
    files: ["src/env/**", "src/instrumentation.ts", "*.config.ts", "*.config.mts", "e2e/**", "scripts/**"],
    rules: { "no-restricted-syntax": "off", "no-console": "off" },
  },
  {
    files: ["src/server/logger.ts", "src/server/providers/*/console.ts"],
    rules: { "no-console": "off" },
  },
  {
    // shadcn/ui primitives are generated; keep them close to upstream.
    files: ["src/components/ui/**"],
    rules: { "@typescript-eslint/consistent-type-assertions": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "drizzle/**",
    ".outbox/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
