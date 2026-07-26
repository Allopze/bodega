import { defineConfig, devices } from "@playwright/test"

const port = 3100
// En CI el workflow expone DATABASE_URL con credenciales del contenedor postgres.
// En local caemos a la conexión por socket (peer auth) contra bodega_e2e.
const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres:///bodega_e2e"
if (databaseUrl.startsWith("postgres:///")) {
  // postgres-js uses TCP for a hostless URL unless PGHOST is explicit; psql
  // and the E2E server use the local socket in this development setup.
  process.env.PGHOST ??= "/var/run/postgresql"
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 150_000,
  fullyParallel: false,
  // 1 retry in CI absorbs transient runner flakiness (resource contention,
  // not app bugs — a real bug fails consistently across retries too);
  // local runs stay at 0 so a real failure is never hidden while iterating.
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `E2E_DATABASE_URL=${databaseUrl} E2E_ALLOW_DESTRUCTIVE_RESET=true E2E_PORT=${port} bash e2e/start-server.sh`,
    url: `http://localhost:${port}/login`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
