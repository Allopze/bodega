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
      DATABASE_URL: "postgres:///bodega",
      PGHOST:       "/var/run/postgresql",
    },
    coverage: {
      reporter: ["text", "lcov"],
      include:  ["lib/**/*.ts"],
    },
  },
})
