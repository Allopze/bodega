import { defineConfig, devices } from "@playwright/test"

const port = 3100
const databaseUrl = "postgres:///bodega_e2e"

export default defineConfig({
  testDir: "./e2e",
  timeout: 150_000,
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
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
