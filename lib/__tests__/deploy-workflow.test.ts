import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
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
  "BILLING_CHIPAX_SYNC_ENABLED",
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

function deployFunction(script: string, name: string): string {
  const source = script.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, "m"))?.[0]
  if (!source) throw new Error(`No se encontró ${name} en scripts/deploy-prod.sh`)
  return source
}

function runTimedHarness(command: string) {
  const deployScript = readFileSync(path.join(repoRoot, "scripts/deploy-prod.sh"), "utf8")
  const source = [
    "set -u -o pipefail",
    deployFunction(deployScript, "format_duration"),
    deployFunction(deployScript, "run_timed"),
    command,
  ].join("\n\n")

  return spawnSync("bash", ["-c", source], { encoding: "utf8" })
}

function resolveProdImageHarness(configuredImages: string) {
  const deployScript = readFileSync(path.join(repoRoot, "scripts/deploy-prod.sh"), "utf8")
  const source = [
    "set -u -o pipefail",
    deployFunction(deployScript, "resolve_prod_image"),
    `prod_env_value() {
  case "$1" in
    GITHUB_REPOSITORY) printf '%s\\n' 'allopze/bodega' ;;
    IMAGE_TAG) printf '%s\\n' 'latest' ;;
  esac
}`,
    `run_in_prod() { printf '%s\\n' ${configuredImages
      .split("\n")
      .filter(Boolean)
      .map((image) => `'${image}'`)
      .join(" ")}; }`,
    "resolve_prod_image",
    "status=$?",
    'printf "resolved=%s\\n" "${prod_image:-}"',
    "exit $status",
  ].join("\n\n")

  return spawnSync("bash", ["-c", source], { encoding: "utf8" })
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

  it("syncs Compose to the production host before the deploy uses it", () => {
    const deployScript = readFileSync(path.join(repoRoot, "scripts/deploy-prod.sh"), "utf8")

    // Producción dejó de compartir el daemon Docker con este checkout, así que
    // el compose viaja por SSH en vez de copiarse en el mismo disco.
    expect(deployScript).toContain('prod_sh "cat > $(printf \'%q\' "$PROD_DIR/docker-compose.yml")" < docker-compose.yml')
    expect(deployScript).toContain("docker-compose-predeploy-")
  })

  it("routes every production-touching command through the SSH helpers", () => {
    const deployScript = readFileSync(path.join(repoRoot, "scripts/deploy-prod.sh"), "utf8")

    // El fallo que esto atrapa es silencioso y caro: un comando que quedó sin
    // redirigir se ejecuta contra el Docker de ESTE box y "tiene éxito"
    // mientras producción, que vive en otra máquina, no se entera.
    expect(deployScript).toContain('ssh "${prod_ssh_opts[@]}" "$PROD_SSH"')
    // El lookahead salta los comentarios: la prohibición es sobre código
    // ejecutable, y el propio script menciona la forma vieja al explicarse.
    expect(deployScript).not.toMatch(/^(?!\s*#).*\(cd "\$PROD_DIR" &&/m)
    expect(deployScript).not.toMatch(/^(?!\s*#)\s*(docker tag|curl -sf http:\/\/127\.0\.0\.1:3000)/m)

    // La imagen se construye acá y tiene que viajar; sin esto el despliegue
    // recrearía los contenedores con la imagen anterior.
    expect(deployScript).toContain("ship_image_to_prod")
    expect(deployScript).toContain('docker save "$IMAGE"')
  })

  it("uses BuildKit cache mounts and excludes local artifacts from the build context", () => {
    const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8")
    const dockerignore = readFileSync(path.join(repoRoot, ".dockerignore"), "utf8")

    expect(dockerfile).toMatch(/^# syntax=docker\/dockerfile:1/)
    expect(dockerfile).toContain("type=cache,id=chome-npm,target=/root/.npm,sharing=locked")
    expect(dockerfile).toContain("type=cache,id=chome-next,target=/app/.next/cache,sharing=locked")
    expect(dockerfile).toContain("COPY scripts/backup-pg.sh")
    for (const ignoredPath of ["docs/", ".venv/", ".vitest-reports/", "artifacts/", "storage/", "*.tsbuildinfo"]) {
      expect(dockerignore).toContain(ignoredPath)
    }
  })

  it("uses the persistent BuildKit builder and reports timed deploy steps", () => {
    const deployScript = readFileSync(path.join(repoRoot, "scripts/deploy-prod.sh"), "utf8")

    expect(deployScript).toContain('BUILDER="${BUILDER:-chome-prod}"')
    expect(deployScript).toContain('docker buildx inspect "$BUILDER" --bootstrap')
    expect(deployScript).toContain('docker buildx build --builder "$BUILDER" --target prod --tag "$IMAGE" --load --progress=plain .')
    expect(deployScript).toContain("run_timed")
    expect(deployScript).not.toContain('if "$@"; then')
  })

  it("migrates SST documents to Cloudreve after database migrations", () => {
    const deployScript = readFileSync(path.join(repoRoot, "scripts/deploy-prod.sh"), "utf8")
    const databaseMigration = 'run_timed "Applying migrations" run_in_prod docker compose run --rm migrate'
    const cloudreveMigration = 'run_timed "Migrando documentos SST a Cloudreve" run_in_prod docker compose run --rm migrate-sst-to-cloudreve'

    const databaseMigrationIndex = deployScript.indexOf(databaseMigration)
    const cloudreveMigrationIndex = deployScript.indexOf(cloudreveMigration)

    expect(databaseMigrationIndex).toBeGreaterThanOrEqual(0)
    expect(cloudreveMigrationIndex).toBeGreaterThan(databaseMigrationIndex)
  })

  it("selects the app image even when Compose lists PostgreSQL first", () => {
    const result = resolveProdImageHarness("postgres:16-alpine\nghcr.io/allopze/bodega:latest")

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("resolved=ghcr.io/allopze/bodega:latest")
    expect(result.stdout).not.toContain("resolved=postgres:16-alpine")
  })

  it("fails closed when the expected app image is absent from Compose", () => {
    const result = resolveProdImageHarness("postgres:16-alpine")

    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain("el Compose de prod no configura ghcr.io/allopze/bodega:latest")
  })

  it("gives the Docker production build enough Node heap for TypeScript", () => {
    const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8")
    const buildRun = dockerfile.match(
      /RUN --mount=type=cache,id=chome-next,target=\/app\/\.next\/cache,sharing=locked[\s\S]*?npm run build/,
    )?.[0]

    expect(buildRun).toBeDefined()
    expect(buildRun).toContain("NODE_OPTIONS=--max-old-space-size=8192")
  })

  it("bundles application dependencies for every PDTP deploy one-shot", () => {
    const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8")
    const scripts = [
      ["seed-pdtp-inspection-templates-2026", "seed-pdtp-inspection-templates"],
      ["apply-pdtp-2026-catalog-decisions", "apply-pdtp-catalog-decisions"],
      ["apply-pdtp-2026-program-data", "apply-pdtp-program-data"],
      ["apply-pdtp-2026-mechanisms", "apply-pdtp-mechanisms"],
      ["apply-pdtp-2026-demand-slas", "apply-pdtp-demand-slas"],
    ] as const

    for (const [script, artifact] of scripts) {
      const build = dockerfile.match(new RegExp(
        `RUN ./node_modules/.bin/esbuild scripts/${script}\\.ts[\\s\\S]*?--outfile=/tmp/${artifact}\\.mjs`,
      ))?.[0]

      expect(build, script).toBeDefined()
      expect(build, script).not.toContain("--packages=external")
      expect(build, script).toContain("--external:drizzle-orm")
      expect(build, script).toContain("--external:postgres")
    }
  })

  it("empaqueta y copia los one-shots de tallas y del estado de solicitudes", () => {
    const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8")

    for (const script of ["seed-size-catalog", "reconcile-epp-duplicate-sizes", "backfill-epp-clothing-sizes", "reconcile-request-status"]) {
      const build = dockerfile.match(new RegExp(
        `RUN ./node_modules/.bin/esbuild scripts/${script}\\.ts[\\s\\S]*?--outfile=/tmp/${script}\\.mjs`,
      ))?.[0]

      expect(build, script).toBeDefined()
      expect(build, script).toContain("--external:drizzle-orm")
      expect(build, script).toContain("--external:postgres")
      // Sin el COPY el bundle se queda en la etapa de build y el paso del
      // deploy falla con "module not found" recién en producción.
      expect(dockerfile, script).toContain(`COPY --from=build /tmp/${script}.mjs ./scripts/${script}.mjs`)
    }
  })

  it("exige `--apply` en los one-shots de reconciliación que escriben", () => {
    const compose = readFileSync(path.join(repoRoot, "docker-compose.yml"), "utf8")

    // Los dos scripts no escriben por omisión: uno inventa variantes de
    // catálogo con SKU propio y el otro da de baja variantes. Sin el flag el
    // paso del deploy informa y no hace nada, anunciando un trabajo que no
    // ocurrió — que es exactamente cómo estaba el backfill de ropa.
    for (const service of ["backfill-epp-clothing-sizes", "reconcile-epp-duplicate-sizes", "reconcile-request-status"]) {
      const command = compose.match(new RegExp(`command: \\["node", "scripts/${service}\\.mjs"[^\\]]*\\]`))?.[0]
      expect(command, service).toBeDefined()
      expect(command, service).toContain('"--apply"')
    }
  })

  it("corre el catálogo de tallas y la conciliación antes de completar el rango", () => {
    const deployScript = readFileSync(path.join(repoRoot, "scripts/deploy-prod.sh"), "utf8")

    const at = (service: string) => {
      const index = deployScript.indexOf(`docker compose run --rm ${service}`)
      expect(index, service).toBeGreaterThan(-1)
      return index
    }

    // El orden no es cosmético: de `size_catalog` sale la familia `ropa` que el
    // backfill exige, y conciliar duplicados antes evita que el backfill cuente
    // una talla duplicada como presente y deje el duplicado vivo.
    expect(at("reconcile-request-status")).toBeLessThan(at("seed-size-catalog"))
    expect(at("seed-size-catalog")).toBeLessThan(at("reconcile-epp-duplicate-sizes"))
    expect(at("reconcile-epp-duplicate-sizes")).toBeLessThan(at("backfill-epp-clothing-sizes"))
  })

  it("emits the Sentry-dependent PDTP reconciler as CommonJS", () => {
    const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8")
    const compose = readFileSync(path.join(repoRoot, "docker-compose.yml"), "utf8")
    const build = dockerfile.match(
      /RUN .\/node_modules\/.bin\/esbuild scripts\/reconcile-pdtp-fulfillment-events\.ts[\s\S]*?--outfile=\/tmp\/reconcile-pdtp-fulfillment-events\.cjs/,
    )?.[0]

    expect(build).toBeDefined()
    expect(build).toContain("--format=cjs")
    expect(dockerfile).toContain("/tmp/reconcile-pdtp-fulfillment-events.cjs ./scripts/reconcile-pdtp-fulfillment-events.cjs")
    expect(compose).toContain('command: ["node", "scripts/reconcile-pdtp-fulfillment-events.cjs"]')
  })

  it("emits the Sentry-dependent SST migrator as CommonJS", () => {
    const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8")
    const compose = readFileSync(path.join(repoRoot, "docker-compose.yml"), "utf8")
    const build = dockerfile.match(
      /RUN \.\/node_modules\/\.bin\/esbuild scripts\/migrate-sst-to-cloudreve\.ts[\s\S]*?--outfile=\/tmp\/migrate-sst-to-cloudreve\.cjs/,
    )?.[0]

    expect(build).toBeDefined()
    expect(build).toContain("--format=cjs")
    expect(dockerfile).toContain("/tmp/migrate-sst-to-cloudreve.cjs ./scripts/migrate-sst-to-cloudreve.cjs")
    expect(compose).toContain('command: ["node", "scripts/migrate-sst-to-cloudreve.cjs"]')
  })

  it("emits the ExcelJS-dependent emergency seed as CommonJS", () => {
    const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8")
    const compose = readFileSync(path.join(repoRoot, "docker-compose.yml"), "utf8")
    const build = dockerfile.match(
      /RUN \.\/node_modules\/\.bin\/esbuild scripts\/seed-prevention-emergency-plans\.ts[\s\S]*?--outfile=\/tmp\/seed-emergency-plans\.cjs/,
    )?.[0]

    expect(build).toBeDefined()
    expect(build).toContain("--format=cjs")
    expect(dockerfile).toContain("/tmp/seed-emergency-plans.cjs ./scripts/seed-emergency-plans.cjs")
    expect(compose).toContain('command: ["node", "scripts/seed-emergency-plans.cjs"]')
  })

  it("propagates a nested pg_dump failure and stops the failing function immediately", () => {
    const result = runTimedHarness(`
dump_production_database() {
  false
  echo "DUMP_CONTINUED"
}
run_timed "Dumping production database" dump_production_database
exit $?
`)

    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain("failed after")
    expect(result.stdout).not.toContain("DUMP_CONTINUED")
  })

  it("propagates a nested healthcheck failure without running later checks", () => {
    const result = runTimedHarness(`
check_app_health() {
  false
  echo "HEALTHCHECK_CONTINUED"
}
run_timed "Health check" check_app_health
exit $?
`)

    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain("failed after")
    expect(result.stdout).not.toContain("HEALTHCHECK_CONTINUED")
  })

  it("reports duration and returns zero for a successful timed step", () => {
    const result = runTimedHarness(`
successful_step() {
  echo "STEP_COMPLETED"
}
run_timed "Successful step" successful_step
exit $?
`)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("STEP_COMPLETED")
    expect(result.stdout).toMatch(/completed in 0m\d{2}s/)
  })

  it("runs the same fail-closed migration preflight in the standalone image", () => {
    const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8")
    const migrateRunner = readFileSync(path.join(repoRoot, "scripts/migrate.mjs"), "utf8")
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>
    }

    expect(dockerfile).toContain("migration-preflight.mjs")
    expect(migrateRunner).toContain('from "./migration-preflight.mjs"')
    expect(migrateRunner).toContain("await runMigrationPreflight(sql)")
    expect(packageJson.scripts["db:migrate"]).toContain("db:preflight-migrations")
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
    expect(cronService).toContain("cron-runner.mjs chipax")
    expect(cronService).toContain("cron-runner.mjs health")
    expect(cronService).toContain("cron-runner.mjs fleet-onway-sync")
    expect(cronService).toContain("0 9 * * *")
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
