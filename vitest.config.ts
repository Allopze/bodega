import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include:     ["**/*.test.ts", "**/*.test.tsx"],
    exclude:     ["node_modules", ".next"],
    coverage: {
      reporter: ["text", "lcov"],
      include:  ["lib/**/*.ts"],
    },
  },
})
