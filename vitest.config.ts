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
    environment: "node",
    include:     ["**/*.test.ts", "**/*.test.tsx"],
    exclude:     [...pgliteTestFiles, "**/node_modules/**", ".next", ".tmp"],
    setupFiles:  ["./components/__tests__/setup.ts"],
    env: {
      DATABASE_URL: "postgres:///bodega_test",
    },
    // En local Vitest 4 usaría CPU-1 workers (11 en este servidor). Tres
    // conservan paralelismo sin desplazar sshd, Next y Postgres. CI mantiene
    // su política propia; VITEST_MAX_WORKERS permite un override explícito.
    maxWorkers: process.env.CI ? undefined : 3,
    fileParallelism: true,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    server: { deps: { inline: ["next-auth"] } },
    // Sin `thresholds` a propósito: este proyecto no ejecuta las 53 suites
    // PGlite, así que su cifra aislada castiga a `lib/services/**` por lo que
    // cubre el otro proyecto. El umbral se aplica sobre la corrida combinada
    // (`npm run test:coverage:all`), que es la única cifra comparable
    // (H-12, AUDITORIA_BUGS_2026-08-05.md).
    coverage: {
      reporter: ["text", "lcov"],
      include: COVERAGE_INCLUDE,
      exclude: COVERAGE_EXCLUDE,
      excludeAfterRemap: COVERAGE_EXCLUDE_AFTER_REMAP,
    },
  },
})
