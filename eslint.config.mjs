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
// Fase 3  : cambiar "warn" → "error" para forzar fronteras definitivamente
//
// Reglas actuales (se irán añadiendo a medida que la migración avanza):
//   1. core/ no puede importar de modules/
//   2. [Fase 3] modules/X no puede importar internos de modules/Y
//      (solo puede importar @/modules/Y ← el barrel público index.ts)

const BOUNDARY_SEVERITY = "warn"; // → "error" en Fase 3

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
  // ── Regla 2 (preparada para Fase 3): módulos solo hablan entre sí por barrel ─
  // Se activará en Fase 3 con la lista de módulos concreta.
  // Por ahora queda como bloque comentado para documentar la intención:
  //
  // {
  //   files: ["modules/**/*.{ts,tsx}"],
  //   rules: {
  //     "no-restricted-imports": [BOUNDARY_SEVERITY, {
  //       patterns: [
  //         // Importar internos de otro módulo está prohibido.
  //         // Ejemplo: modules/requests/services/foo.ts NO PUEDE importar modules/purchasing/services/bar.ts
  //         // Solo puede importar el barrel: @/modules/purchasing (que apunta a modules/purchasing/index.ts)
  //         { group: ["@/modules/admin/*"],        message: "[boundary] import @/modules/admin instead" },
  //         { group: ["@/modules/requests/*"],     message: "[boundary] import @/modules/requests instead" },
  //         // ... un pattern por módulo
  //       ],
  //     }],
  //   },
  // },
]);

export default eslintConfig;
