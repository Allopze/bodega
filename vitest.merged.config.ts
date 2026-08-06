import { defineConfig } from "vitest/config"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { COVERAGE_THRESHOLDS } from "./vitest.coverage.shared"

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

/**
 * Config de la corrida de cobertura **combinada**.
 *
 * No ejecuta tests: consume los blobs que dejaron los dos proyectos
 * (`--mergeReports`) y emite una sola cifra sobre `lib/**` + Server Actions.
 * Es la única medición comparable del repositorio, y por eso es la única que
 * aplica umbrales (H-12, AUDITORIA_BUGS_2026-08-05.md).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": projectRoot,
      "next/server": path.join(projectRoot, "node_modules/next/server.js"),
    },
  },
  test: {
    environment: "node",
    // Sólo `thresholds`: verificado que `--mergeReports` ignora el
    // `include`/`exclude` de esta config (quedan grabados en cada blob al
    // recolectar) pero sí aplica los umbrales. Declararlos acá sería
    // engañoso — el alcance de la medición vive en las configs de origen,
    // compartido vía `vitest.coverage.shared.ts`.
    coverage: {
      reporter: ["text", "lcov"],
      thresholds: COVERAGE_THRESHOLDS,
    },
  },
})
