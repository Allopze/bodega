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
    name: "non-pglite",
    environment: "node",
    include:     ["**/*.test.ts", "**/*.test.tsx"],
    // Los worktrees de sesión (`.claude/worktrees/**`) son copias completas
    // del repo, con su propio `node_modules`. Sin excluirlos, vitest corre
    // cada test dos o tres veces y los de React fallan con
    // «Cannot read properties of null (reading 'useState')», porque se carga
    // una segunda copia de React desde el `node_modules` del worktree.
    exclude:     [...pgliteTestFiles, "**/node_modules/**", ".next", ".tmp", ".claude/worktrees/**"],
    setupFiles:  ["./components/__tests__/setup.ts"],
    env: {
      DATABASE_URL: "postgres:///bodega_test",
      PGHOST:       "/var/run/postgresql",
    },
    server: { deps: { inline: ["next-auth"] } },
    // Paralelizado, pero acotado: el default de Vitest 4 sería CPU-1 workers
    // (11 en este servidor), suficiente para dejar sshd sin tiempo de CPU.
    maxWorkers: process.env.CI ? undefined : 3,
    fileParallelism: true,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    coverage: {
      reporter: ["text", "lcov"],
      include:  [
        "lib/**/*.ts",
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
      thresholds: {
        statements: 60,
        branches:   50,
        functions:  60,
        lines:      60,
      },
    },
  },
})
