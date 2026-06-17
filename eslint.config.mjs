import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ── Architecture freeze rules ──────────────────────────────────────────────
// The live business logic is in lib/ and app/. The old modular migration
// (core/, modules/*/services, etc.) was pruned. modules/ now only keeps
// registry/manifest for navigation and permissions.
//
// These rules prevent importing stale code from the frozen module scaffolding.
// See AGENTS.md and modules/README.md for context.

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "app_cumplimiento/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // ── Freeze: prevent importing stale module scaffolding ─────────────────────
  // app/, lib/, components/ are the source of truth. The old copies in
  // modules/*/{services,actions,schema,validation} and core/ were pruned.
  // This rule prevents reintroducing stale logic by mistake.
  {
    files: ["app/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["@/modules/*/services/*", "@/modules/*/actions/*", "@/modules/*/schema", "@/modules/*/validation"],
            message: "[freeze] No importes las copias stale de modules/*. Fuente de verdad: lib/ + app/ (ver modules/README.md).",
          },
          {
            group: ["@/core/*", "@/core"],
            message: "[freeze] core/ fue removido; usa las primitivas equivalentes en lib/.",
          },
        ],
      }],
    },
  },
]);

export default eslintConfig;
