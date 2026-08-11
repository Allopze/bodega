import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const repoRoot = process.cwd()

const BILLING_RUNTIME_ENV_KEYS = [
  "CRON_SECRET",
  "DTE_PORTAL_BASE_URL",
  "DTE_PORTAL_RUT_USR",
  "DTE_PORTAL_RUT_EMP",
  "DTE_PORTAL_CLAVE",
  "DTE_PORTAL_CODEMP",
  "DTE_SYNC_IMPORTER_EMAIL",
  "DTE_SYNC_DELAY_MS",
  "DTE_SYNC_ENABLED",
  "BILLING_SALES_SYNC_ENABLED",
  "BILLING_HISTORY_FLOOR",
  "BILLING_MATCH_AMOUNT_TOLERANCE_CLP",
  "BILLING_MATCH_DATE_WINDOW_DAYS",
  "BILLING_COMPANY_TAX_ID",
  "BILLING_CHIPAX_ENABLED",
  "CHIPAX_OPENAPI_URL",
  "CHIPAX_API_BASE_URL",
  "CHIPAX_APP_ID",
  "CHIPAX_SECRET_KEY",
  "CHIPAX_REQUEST_TIMEOUT_MS",
] as const

const DTE_KEYRING_RUNTIME_ENV_KEYS = [
  "DTE_SETTINGS_KEYRING",
  "DTE_SETTINGS_ACTIVE_KEY_ID",
  "DTE_SETTINGS_MODE",
  "SENTRY_DSN",
] as const

function appServiceFromCompose(compose: string): string {
  const appService = compose.match(/\n  app:\n([\s\S]*?)(?=\n  [a-z][a-z-]*:\n|$)/)?.[0]
  if (!appService) throw new Error("No se encontró el servicio app en docker-compose.yml")
  return appService
}

function cronServiceFromCompose(compose: string): string {
  const cronService = compose.match(/\n  cron:\n([\s\S]*?)(?=\n  [a-z][a-z-]*:\n|$)/)?.[0]
  if (!cronService) throw new Error("No se encontró el servicio cron en docker-compose.yml")
  return cronService
}

describe("deploy workflow", () => {
  it("builds and publishes the production Docker stage", () => {
    const workflow = readFileSync(path.join(repoRoot, ".github/workflows/deploy.yml"), "utf8")
    const buildPushStep = workflow.match(/uses: docker\/build-push-action@v6[\s\S]*?(?=\n\s{6}- name:|\n\s{2}# Optional rollout job:|$)/)?.[0]

    expect(buildPushStep).toBeDefined()
    expect(buildPushStep).toContain("target: prod")
  })

  it("syncs the versioned Compose definition before recreating production", () => {
    const workflow = readFileSync(path.join(repoRoot, ".github/workflows/deploy.yml"), "utf8")

    expect(workflow).toContain("uses: appleboy/scp-action@v0.1.7")
    expect(workflow).toContain("source: docker-compose.yml")
    expect(workflow).toContain("overwrite: true")
    expect(workflow).toContain("backups/docker-compose-predeploy-${{ env.RELEASE_SHA }}.yml")
  })

  it("syncs Compose before the local production deploy uses it", () => {
    const deployScript = readFileSync(path.join(repoRoot, "scripts/deploy-prod.sh"), "utf8")

    expect(deployScript).toContain('cp docker-compose.yml "$PROD_DIR/docker-compose.yml"')
    expect(deployScript).toContain("docker-compose-predeploy-")
  })

  it("injects the DTE, billing, and cron runtime configuration into app", () => {
    const compose = readFileSync(path.join(repoRoot, "docker-compose.yml"), "utf8")
    const appService = appServiceFromCompose(compose)

    for (const key of BILLING_RUNTIME_ENV_KEYS) {
      expect(appService).toMatch(new RegExp(`\\n\\s+- ${key}=\\$\\{${key}(?::-[^}]*)?\\}`))
    }
    for (const key of DTE_KEYRING_RUNTIME_ENV_KEYS) {
      expect(appService).toMatch(new RegExp(`\\n\\s+- ${key}=\\$\\{${key}(?::-[^}]*)?\\}`))
    }
  })

  it("keeps encryption material out of cron and uses the bounded Node runner", () => {
    const compose = readFileSync(path.join(repoRoot, "docker-compose.yml"), "utf8")
    const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8")
    const cronService = cronServiceFromCompose(compose)

    expect(cronService).toContain("cron-runner.mjs dte")
    expect(cronService).toContain("cron-runner.mjs sales")
    expect(cronService).toContain("cron-runner.mjs health")
    expect(cronService).toContain('interval: 5m')
    expect(cronService).not.toContain("DTE_SETTINGS_KEYRING=")
    expect(cronService).not.toContain("DTE_PORTAL_CLAVE=")
    expect(dockerfile).toContain("COPY --from=build /app/scripts/cron-runner.mjs")
  })

  it("releases app before cron and verifies both images plus a protected smoke", () => {
    const workflow = readFileSync(path.join(repoRoot, ".github/workflows/deploy.yml"), "utf8")
    const deployScript = readFileSync(path.join(repoRoot, "scripts/deploy-prod.sh"), "utf8")

    expect(workflow).toContain("docker compose pull app cron")
    expect(workflow).toContain("docker compose up -d --no-deps --force-recreate app")
    expect(workflow).toContain("docker compose up -d --no-deps --force-recreate cron")
    expect(workflow).toContain("/api/cron/dte-sync-health")
    expect(workflow).toContain("for APP_CONTAINER in $APP_CONTAINERS")
    expect(workflow).toContain("test \"$#\" -eq 1")
    expect(deployScript).toContain("--force-recreate app")
    expect(deployScript).toContain("--force-recreate cron")
    expect(deployScript).toContain("/api/cron/dte-sync-health")
    expect(deployScript).toContain("for app_container in $app_containers")
    expect(deployScript).toContain("test \"$#\" -eq 1")
  })

  it("rolls back app and cron when any post-replacement verification fails before encrypted cutover", () => {
    const workflow = readFileSync(path.join(repoRoot, ".github/workflows/deploy.yml"), "utf8")
    const deployScript = readFileSync(path.join(repoRoot, "scripts/deploy-prod.sh"), "utf8")

    expect(workflow).toContain("trap rollback_release EXIT")
    expect(workflow).toContain("ROLLBACK_ARMED=1")
    expect(workflow).toContain("PREVIOUS_COMPOSE")
    expect(workflow).toContain("docker compose up -d --no-deps --force-recreate app")
    expect(workflow).toContain("docker compose up -d --no-deps --force-recreate cron")
    expect(deployScript).toContain("trap rollback_release EXIT")
    expect(deployScript).toContain("ROLLBACK_ARMED=1")
    expect(deployScript).toContain("HAS_PREVIOUS_IMAGE")
    expect(deployScript).toContain("compose_backup")
  })

  it("refuses an automatic legacy rollback after encrypted-only cutover or an unknown cutover state", () => {
    const workflow = readFileSync(path.join(repoRoot, ".github/workflows/deploy.yml"), "utf8")
    const deployScript = readFileSync(path.join(repoRoot, "scripts/deploy-prod.sh"), "utf8")

    for (const source of [workflow, deployScript]) {
      expect(source).toContain("dte.encryption_mode")
      expect(source).toContain("CUTOVER_STATE")
      expect(source).toContain('CUTOVER_STATE" = "encrypted_only"')
      expect(source).toContain('CUTOVER_STATE" = "unknown"')
      expect(source).toMatch(/[Aa]utomatic rollback/)
    }
  })
})
