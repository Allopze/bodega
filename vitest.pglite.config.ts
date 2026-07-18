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
    // Coverage se mide desde vitest.config.ts (full suite)
    coverage: {
      enabled: false,
    },
  },
})
