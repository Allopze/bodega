import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include:     ["**/*.test.ts", "**/*.test.tsx"],
    exclude:     ["node_modules", ".next", ".tmp"],
    setupFiles:  ["./components/__tests__/setup.ts"],
    env: {
      // BD desechable: ningún test debe tocar la base de dev/prod ('bodega').
      // Hoy todos usan pglite o mockean @/db; esto evita el footgun si alguno
      // olvida hacerlo (ver lib/__tests__/db-safety.test.ts).
      DATABASE_URL: "postgres:///bodega_test",
      PGHOST:       "/var/run/postgresql",
    },
    // Determinista: los archivos que migran pglite saturan CPU en paralelo y
    // producían timeouts intermitentes. Secuencial + timeouts holgados.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    coverage: {
      reporter: ["text", "lcov"],
      include:  ["lib/**/*.ts"],
      // T-03: regression floor, set just below the current measured
      // coverage. CI fails if coverage drops meaningfully. Ratchet these up as
      // test coverage grows; the long-term target in AUDITORIA_INTEGRAL_CHOME.md is 70%.
      // Actual coverage: 94.43% stmts / 83.8% branches / 95.29% funcs / 96.01% lines
      thresholds: {
        statements: 94,
        branches:   83,
        functions:  95,
        lines:      96,
      },
    },
  },
})
