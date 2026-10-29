import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { INVOICE_RECONCILIATION_VERSION } from "@/lib/services/purchasing-module/invoice-reconciliation"

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
    expect(deployScript).toContain('docker buildx build --builder "$BUILDER" --target prod --tag "$IMAGE" --load --progress=plain')
    // El chequeo de tipos corre como paso propio del deploy, así que la imagen
    // no vuelve a correr `tsc` dentro de `next build` (ver el ARG del Dockerfile).
    expect(deployScript).toContain("run_timed \"Chequeo de tipos (previo a construir la imagen)\" npm run typecheck")
    expect(deployScript).toContain("--build-arg BODEGA_BUILD_SKIP_TYPECHECK=1")
    expect(deployScript).toContain("run_timed")
    expect(deployScript).not.toContain('if "$@"; then')
  })

  it("cuenta la conciliación OC-factura pendiente con la versión vigente de la huella", () => {
    const deployScript = readFileSync(path.join(repoRoot, "scripts/deploy-prod.sh"), "utf8")
    const pending = deployScript.split("\n").find(line => line.startsWith("pending_reconciliation="))

    // El conteo quedó en `v2:%` cuando la huella pasó a v3: las OC ya
    // proyectadas se contaban como pendientes y el backfill corría siempre.
    expect(pending).toContain(`NOT LIKE 'v${INVOICE_RECONCILIATION_VERSION}:%'`)
    // Mismo universo que el backfill, que ignora facturas anuladas.
    expect(pending).toContain("voided_at IS NULL")
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
      ["apply-pdtp-2026-objectives", "apply-pdtp-objectives"],
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

    for (const script of ["seed-size-catalog", "reconcile-epp-duplicate-sizes", "backfill-epp-clothing-sizes", "backfill-epp-size-ranges", "reconcile-request-status"]) {
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

  it("da `require` al bundle del backfill de rangos de talla", () => {
    const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8")
    const build = dockerfile.match(
      /RUN .\/node_modules\/.bin\/esbuild scripts\/backfill-epp-size-ranges\.ts[\s\S]*?--outfile=\/tmp\/backfill-epp-size-ranges\.mjs/,
    )?.[0]

    // Sin el banner el script muere con «Dynamic require of "crypto" is not
    // supported» antes de ejecutar una línea: pasó en el primer dry-run en
    // producción (2026-10-01).
    expect(build).toContain("const require=__cr(import.meta.url)")
  })

  /*
   * Las casillas del programa preventivo se pre-generan en el alta de faena.
   * Cuando las migraciones 0314/0316 crearon esas tablas, las faenas que ya
   * existían quedaron sin ninguna: nada las materializa fuera del alta. La
   * cabecera del propio servicio nombra el modo de falla —"invisible hasta que
   * llega una fiscalización"— y es exactamente lo que pasó. Esta prueba vigila
   * que el paso esté cableado en los caminos que corren en el servidor, que es
   * lo que faltaba; que el servicio sea idempotente ya lo cubre
   * `prevention-program-slots-pglite.test.ts`.
   */
  it("materializa las casillas del programa en todos los caminos de despliegue", () => {
    const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8")
    const compose = readFileSync(path.join(repoRoot, "docker-compose.yml"), "utf8")
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"))
    const script = "ensure-prevention-program-slots"

    const build = dockerfile.match(new RegExp(
      `RUN ./node_modules/.bin/esbuild scripts/${script}\\.ts[\\s\\S]*?--outfile=/tmp/${script}\\.mjs`,
    ))?.[0]
    expect(build).toBeDefined()
    expect(build).toContain("--external:drizzle-orm")
    expect(build).toContain("--external:postgres")
    expect(dockerfile).toContain(`COPY --from=build /tmp/${script}.mjs ./scripts/${script}.mjs`)

    // Camino del servidor: `deploy-prod.sh` corre el servicio `migrate`.
    const migrateCommand = compose.match(/command: \["sh", "-c", "node scripts\/migrate\.mjs[^\]]*\]/)?.[0]
    expect(migrateCommand).toBeDefined()
    expect(migrateCommand).toContain(`node scripts/${script}.mjs`)

    // Camino de GitHub Actions y el local: la cadena de `db:migrate`.
    expect(packageJson.scripts["db:migrate"]).toContain("db:ensure-program-slots")
  })

  /*
   * Mismo incidente que el de arriba, con otra tabla (Task 10, ronda de
   * corrección 1): la migración 0322 agrega `is_mandatory_session` a
   * `prevention_committee_program_activities`, pero `activateProgram` —el
   * único punto que pre-generaba las 12 filas de sesión— no puede volver a
   * correr sobre un programa que ya salió de `draft`. Sin este backfill
   * cableado en el servidor, un comité con programa aprobado antes de este
   * deploy se queda sin sus 12 sesiones para siempre.
   */
  it("empaqueta el backfill de sesiones mandatorias del CPHS para correrlo a mano", () => {
    const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8")
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"))
    const script = "backfill-cphs-mandatory-sessions"

    const build = dockerfile.match(new RegExp(
      `RUN ./node_modules/.bin/esbuild scripts/${script}\\.ts[\\s\\S]*?--outfile=/tmp/${script}\\.mjs`,
    ))?.[0]
    expect(build).toBeDefined()
    expect(build).toContain("--external:drizzle-orm")
    expect(build).toContain("--external:postgres")
    expect(dockerfile).toContain(`COPY --from=build /tmp/${script}.mjs ./scripts/${script}.mjs`)

    expect(packageJson.scripts["db:backfill-cphs-sessions"]).toContain(`scripts/${script}.ts`)
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
    expect(at("seed-size-catalog")).toBeLessThan(at("reconcile-epp-duplicate-sizes"))
    expect(at("reconcile-epp-duplicate-sizes")).toBeLessThan(at("backfill-epp-clothing-sizes"))
  })

  it("emits the PDTP reconciler as CommonJS", () => {
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

  /* PREV-B01-BACKFILL: la corrección de las aprobaciones revocadas antes del
   * fix de B01 escribe sobre cifras ya informadas. El servicio de compose sólo
   * reporta; aplicar exige el override explícito con `--apply --actor`, y el
   * deploy nunca lo corre. */
  it("empaqueta la corrección de B01 como un one-shot que por defecto sólo reporta", () => {
    const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8")
    const compose = readFileSync(path.join(repoRoot, "docker-compose.yml"), "utf8")
    const deployScript = readFileSync(path.join(repoRoot, "scripts/deploy-prod.sh"), "utf8")
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { scripts: Record<string, string> }

    const build = dockerfile.match(
      /RUN .\/node_modules\/.bin\/esbuild scripts\/revert-pdtp-revoked-approvals\.ts[\s\S]*?--outfile=\/tmp\/revert-pdtp-revoked-approvals\.mjs/,
    )?.[0]
    expect(build).toBeDefined()
    expect(build).toContain("--external:drizzle-orm")
    expect(build).toContain("--external:postgres")
    expect(dockerfile).toContain("COPY --from=build /tmp/revert-pdtp-revoked-approvals.mjs ./scripts/revert-pdtp-revoked-approvals.mjs")

    const service = compose.match(/\n {2}revert-pdtp-revoked-approvals:\n[\s\S]*?command: \[[^\]]*\]/)?.[0]
    expect(service).toBeDefined()
    expect(service).toContain('command: ["node", "scripts/revert-pdtp-revoked-approvals.mjs"]')
    expect(service).not.toContain("--apply")
    expect(deployScript).not.toContain("revert-pdtp-revoked-approvals")
    expect(packageJson.scripts["pdtp:revert-revoked-approvals"]).toContain("scripts/revert-pdtp-revoked-approvals.ts")
  })

  /* PRV-01/PRV-03 (auditoría de production readiness 2026-09-28): a diferencia
   * de B01, la devolución a revisión de las aprobaciones sin evidencia
   * verificable sí corre en cada deploy. No toca meses cerrados, es
   * idempotente y no aborta el deploy (PDTP_UNVERIFIED_DEPLOY_MODE). */
  it("aplica en el deploy la devolución de aprobaciones sin evidencia verificable, después de conciliar", () => {
    const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8")
    const compose = readFileSync(path.join(repoRoot, "docker-compose.yml"), "utf8")

    const build = dockerfile.match(
      /RUN .\/node_modules\/.bin\/esbuild scripts\/report-pdtp-unverified-auto-approvals\.ts[\s\S]*?--outfile=\/tmp\/apply-pdtp-unverified-approvals\.mjs/,
    )?.[0]
    expect(build).toBeDefined()
    expect(build).toContain("--external:drizzle-orm")
    expect(build).toContain("--external:postgres")
    expect(dockerfile).toContain("COPY --from=build /tmp/apply-pdtp-unverified-approvals.mjs ./scripts/apply-pdtp-unverified-approvals.mjs")

    const service = compose.match(/\n {2}apply-pdtp-unverified-approvals:\n[\s\S]*?command: \[[^\]]*\]/)?.[0]
    expect(service).toBeDefined()
    expect(service).toContain("PDTP_UNVERIFIED_DEPLOY_MODE=true")
    expect(service).toContain('command: ["node", "scripts/apply-pdtp-unverified-approvals.mjs"]')

  })

  it("emits the SST migrator as CommonJS", () => {
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

  // PREV-C04: un job declarado en el runner que nadie agenda es un job que no
  // corre. Así pasaron meses sin un solo recordatorio de Prevención.
  it("agenda en el crontab cada job que declara el runner", () => {
    const compose = readFileSync(path.join(repoRoot, "docker-compose.yml"), "utf8")
    const runner = readFileSync(path.join(repoRoot, "scripts/cron-runner.mjs"), "utf8")
    const cronService = cronServiceFromCompose(compose)
    const jobs = [...runner.matchAll(/^ {2}"?([a-z0-9-]+)"?: \{\n\s+url:/gm)].map((match) => match[1]!)
    expect(jobs).toContain("pdtp-weekly-reminders")
    // PREV-I13-C: el escaneo de integridad de evidencia PDTP corre a diario.
    expect(jobs).toContain("pdtp-evidence-integrity")

    const unscheduled = jobs.filter((job) => !cronService.includes(`cron-runner.mjs ${job} `))
    expect(unscheduled).toEqual([])
    // W5-GC (T7a, D13): el barrido de huérfanos corre a diario en modo de
    // prueba. El borrado real se enciende en `app`, no en el crontab.
    expect(jobs).toContain("pdtp-evidence-gc")
    expect(cronService).not.toMatch(/PDTP_EVIDENCE_GC_DELETE=\S*\s+node/)
  })

  // W5-GC (T7a, D13): la variable que habilita el borrado real la lee la ruta,
  // que corre en `app`. Si el compose no la inyecta, encenderla en el .env de
  // producción no haría nada y el barrido seguiría en prueba sin avisar.
  it("inyecta en app la variable que enciende el borrado real del GC de evidencia", () => {
    const compose = readFileSync(path.join(repoRoot, "docker-compose.yml"), "utf8")
    const appService = appServiceFromCompose(compose)
    expect(appService).toMatch(/\n\s+- PDTP_EVIDENCE_GC_DELETE=\$\{PDTP_EVIDENCE_GC_DELETE:-\}/)
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

  // 2026-10-21: producción llevaba semanas sin `backup-scheduler` (vive bajo un
  // profile que ningún `up` del deploy levantaba) y sin poder escribir en
  // BACKUP_DIR. El deploy tiene que recrearlo y fallar si no queda operativo.
  it("levanta y verifica el respaldo programado después de desarmar el rollback", () => {
    const deployScript = readFileSync(path.join(repoRoot, "scripts/deploy-prod.sh"), "utf8")

    expect(deployFunction(deployScript, "start_backup_scheduler")).toContain(
      "docker compose --profile backup up -d --no-deps --force-recreate backup-scheduler",
    )
    const check = deployFunction(deployScript, "check_backup_scheduler")
    expect(check).toContain('= "$IMAGE"')
    expect(check).toContain('= "running"')
    expect(check).toContain('test -w "$BACKUP_DIR"')

    // Un scheduler roto no debe revertir una release sana.
    const disarmed = deployScript.indexOf("ROLLBACK_ARMED=0")
    expect(disarmed).toBeGreaterThan(-1)
    expect(deployScript.indexOf('run_timed "Levantando el respaldo programado')).toBeGreaterThan(disarmed)
    expect(deployScript).toMatch(/if ! run_timed "Verificando el respaldo programado" check_backup_scheduler; then[\s\S]*?exit 1\n\s*fi/)
  })

  it("trae gpg y deja /data/backups escribible por nextjs en la imagen", () => {
    const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8")
    const prodStage = dockerfile.slice(dockerfile.indexOf("AS prod"))

    // backup-orchestrator.sh aborta si BACKUP_ENCRYPTION_PASSPHRASE está
    // definida y gpg no existe.
    expect(prodStage).toMatch(/apk add --no-cache[^\n]*\\\n(?:\s+[\w-]+ \\\n)*\s+gnupg\b/)
    expect(prodStage).toMatch(/mkdir -p [^\n]*\/data\/backups/)
    expect(prodStage).toMatch(/chown nextjs:nodejs [^\n]*\/data\/backups/)
    // backup-scheduler corre con HOME=/app: sin este homedir gpg no arranca.
    expect(prodStage).toMatch(/chown nextjs:nodejs [^\n]*\/app\/\.gnupg/)
    expect(prodStage).toContain("chmod 700 /app/.gnupg")
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
