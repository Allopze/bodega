import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Allow underscore-prefixed unused vars (stub params in not-yet-implemented service layer).
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      // useEffect → setState is valid when synchronising local form state with a changed
      // edit-target prop (resetOnId pattern), and for resetting pagination when search changes.
      // These are intentional React patterns; downgrade from error to warn.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
