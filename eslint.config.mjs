import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ── Módulo boundary rules ─────────────────────────────────────────────────────
// Reglas de frontera del sistema modular (monolito modular).
//
// Diagrama de dependencias permitidas:
//   db/ ←── core/ ←── modules/ ←── app/
//                 ↖── components/ ↗
//   (las flechas apuntan en la dirección de "puede importar de")
//
// Fase 0-2: warn (visibilidad durante migración)
// Fase 3  : "error" — fronteras activas, el build falla si se viola una frontera
//
// Reglas activas:
//   1. core/ no puede importar de modules/
//   2. modules/X no puede importar internos de modules/Y
//      (solo puede importar @/modules/Y ← el barrel público index.ts)

const BOUNDARY_SEVERITY = "error"; // Fase 3: fronteras activas

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
      // edit-target prop (resetOnId pattern), for resetting pagination when search changes,
      // and for handling useActionState responses. These are intentional React patterns.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // ── Regla 1: core/ no puede importar de modules/ ─────────────────────────
  {
    files: ["core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [BOUNDARY_SEVERITY, {
        patterns: [
          {
            group: ["@/modules/*", "@/modules"],
            message: "[boundary] core/ must not import from modules/ — dependency flows one way: modules → core",
          },
          {
            group: ["../modules/*", "../../modules/*", "./modules/*"],
            message: "[boundary] core/ must not import from modules/ — use relative paths only within core/",
          },
        ],
      }],
    },
  },
  // ── Regla 2: módulos solo hablan entre sí por barrel público ────────────────
  // Un módulo PUEDE importar otro módulo SOLO vía su barrel (index.ts).
  // PROHIBIDO importar internals: modules/purchasing/services/foo.ts desde modules/requests/...
  //
  // Estos patrones se aplican SOLO dentro de modules/**:
  // (los index.ts de cada módulo están exentos — ellos DEBEN importar internos)
  {
    files: ["modules/**/*.{ts,tsx}"],
    ignores: [
      "modules/*/index.ts",           // barrels públicos
      "modules/registry.ts",          // join-point
      "modules/permissions.ts",       // derivación de permisos
    ],
    rules: {
      "no-restricted-imports": [BOUNDARY_SEVERITY, {
        patterns: [
          { group: ["@/modules/admin/actions/*", "@/modules/admin/services/*", "@/modules/admin/components/*", "@/modules/admin/schema", "@/modules/admin/validation", "@/modules/admin/manifest"], message: "[boundary] import @/modules/admin instead of its internals" },
          { group: ["@/modules/requests/actions/*", "@/modules/requests/services/*", "@/modules/requests/components/*", "@/modules/requests/schema", "@/modules/requests/validation", "@/modules/requests/manifest"], message: "[boundary] import @/modules/requests instead of its internals" },
          { group: ["@/modules/approvals/actions/*", "@/modules/approvals/services/*", "@/modules/approvals/components/*", "@/modules/approvals/schema", "@/modules/approvals/validation", "@/modules/approvals/manifest"], message: "[boundary] import @/modules/approvals instead of its internals" },
          { group: ["@/modules/purchasing/actions/*", "@/modules/purchasing/services/*", "@/modules/purchasing/components/*", "@/modules/purchasing/schema", "@/modules/purchasing/validation", "@/modules/purchasing/manifest"], message: "[boundary] import @/modules/purchasing instead of its internals" },
          { group: ["@/modules/receiving/actions/*", "@/modules/receiving/services/*", "@/modules/receiving/components/*", "@/modules/receiving/schema", "@/modules/receiving/validation", "@/modules/receiving/manifest"], message: "[boundary] import @/modules/receiving instead of its internals" },
          { group: ["@/modules/warehouse/actions/*", "@/modules/warehouse/services/*", "@/modules/warehouse/components/*", "@/modules/warehouse/schema", "@/modules/warehouse/validation", "@/modules/warehouse/manifest"], message: "[boundary] import @/modules/warehouse instead of its internals" },
          { group: ["@/modules/deliveries/actions/*", "@/modules/deliveries/services/*", "@/modules/deliveries/components/*", "@/modules/deliveries/schema", "@/modules/deliveries/validation", "@/modules/deliveries/manifest"], message: "[boundary] import @/modules/deliveries instead of its internals" },
          { group: ["@/modules/traceability/actions/*", "@/modules/traceability/services/*", "@/modules/traceability/components/*", "@/modules/traceability/schema", "@/modules/traceability/validation", "@/modules/traceability/manifest"], message: "[boundary] import @/modules/traceability instead of its internals" },
          { group: ["@/modules/reports/actions/*", "@/modules/reports/services/*", "@/modules/reports/components/*", "@/modules/reports/schema", "@/modules/reports/validation", "@/modules/reports/manifest"], message: "[boundary] import @/modules/reports instead of its internals" },
        ],
      }],
    },
  },
]);

export default eslintConfig;
