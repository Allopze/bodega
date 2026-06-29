import { defineConfig } from "vitest/config"
import path from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@": projectRoot,
    },
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
      include:  [
        "lib/**/*.ts",
        // T-07: start measuring Server Action coverage. Thresholds below are
        // the combined floor after including largely-untested actions files.
        // Ratchet these up as action tests are added; long-term target: 70%.
        "app/**/actions.ts",
      ],
      exclude: [
        "lib/auth/types.ts",
        "lib/sst/types.ts",
        "lib/requests/request-config.ts",
        "lib/sst/index.ts",
        "**/*.d.ts",
        "**/node_modules/**",
      ],
      // T-03: regression floor, set just below the current measured
      // combined coverage (lib ~94% + uncovered actions files pull it down).
      // Run `pnpm test:coverage` after adding action tests to measure and tighten.
      thresholds: {
        statements: 60,
        branches:   50,
        functions:  60,
        lines:      60,
      },
    },
  },
})
