import { defineConfig } from "vitest/config"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { pgliteTestFiles } from "./tests/pglite-files"

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
    exclude:     [...pgliteTestFiles, "node_modules", ".next", ".tmp"],
    setupFiles:  ["./components/__tests__/setup.ts"],
    env: {
      DATABASE_URL: "postgres:///bodega_test",
    },
    fileParallelism: true,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    server: { deps: { inline: ["next-auth"] } },
    coverage: {
      reporter: ["text", "lcov"],
      include:  [
        "lib/**/*.ts",
      ],
      exclude: [
        "lib/auth/types.ts",
        "lib/sst/types.ts",
        "lib/requests/request-config.ts",
        "lib/sst/index.ts",
        "**/*.d.ts",
        "**/node_modules/**",
      ],
      thresholds: {
        statements: 40,
        branches:   30,
        functions:  40,
        lines:      40,
      },
    },
  },
})
