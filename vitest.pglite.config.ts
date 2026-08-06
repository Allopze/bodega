import { defineConfig } from "vitest/config"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { pgliteTestFiles } from "./tests/pglite-files"
import { COVERAGE_EXCLUDE, COVERAGE_EXCLUDE_AFTER_REMAP, COVERAGE_INCLUDE } from "./vitest.coverage.shared"

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@": projectRoot,
      "next/server": path.join(projectRoot, "node_modules/next/server.js"),
    },
  },
  test: {
    name: "pglite",
    environment: "node",
    include: pgliteTestFiles,
    exclude: ["node_modules", ".next", ".tmp"],
    setupFiles: ["./components/__tests__/setup.ts"],
    env: {
      DATABASE_URL: "postgres:///bodega_test",
      PGHOST:       "/var/run/postgresql",
    },
    server: { deps: { inline: ["next-auth"] } },
    // Secuencial: PGlite satura CPU en paralelo
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Cobertura apagada por defecto (instrumentar cuesta y `npm run
    // test:pglite` es el gate de CI, no una medición). Se enciende con
    // `--coverage` desde `test:coverage:all`, que combina este proyecto con el
    // otro: medir sólo uno deja servicios enteros en 0 % pese a estar probados
    // (H-12, AUDITORIA_BUGS_2026-08-05.md). Mismo include/exclude que el otro
    // proyecto para que los reportes sean combinables.
    coverage: {
      enabled: false,
      reporter: ["text", "lcov"],
      include: COVERAGE_INCLUDE,
      exclude: COVERAGE_EXCLUDE,
      excludeAfterRemap: COVERAGE_EXCLUDE_AFTER_REMAP,
    },
  },
})
