/**
 * Siembra el índice de cumplimiento del PDTP para que el medidor de Inicio se
 * vea casi completo en un entorno de **desarrollo**.
 *
 * No es un seed de producto: escribe ejecuciones aprobadas de demostración en
 * `pdtp_executions` para las celdas planificadas del año. Después deja una
 * brecha deliberada y uniforme (~4 % por defecto) para que el anual quede en
 * ~95-96 % y no en 100 %: eso es lo que se pidió ("casi completo").
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/seed-pdtp-compliance-dev.ts --apply
 *
 * Reglas:
 * - Sólo escribe en una base local cuyo nombre parezca de desarrollo
 *   (`*_dev`, `*_test`). Si `DATABASE_URL` apunta a otra cosa, aborta antes de
 *   leer o escribir.
 * - Las filas nacen con `source_metadata_json.demoSeed = "pdtp-compliance-dev"`
 *   y se borran/reescriben en cada corrida: el script es idempotente y no toca
 *   ejecuciones reales. Si una celda ya tiene una ejecución real, el INSERT usa
 *   `ON CONFLICT DO NOTHING` y la respeta.
 * - Las coberturas se siembran con el padrón real de la faena (dotación,
 *   extintores, GES, trabajadores nuevos), no con un número inventado.
 */
import { loadEnvConfig } from "@next/env"

const DEMO_SEED_KEY = "pdtp-compliance-dev"

type Options = {
  apply: boolean
  year?: number
  worksite?: string
  throughMonth: number
  /** Brecha deliberada para que el índice quede "casi completo", no en 100 %. */
  gapPercent: number
}

function parseOptions(argv: string[]): Options {
  const options: Options = { apply: false, throughMonth: 12, gapPercent: 4 }
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!
    if (token === "--apply") {
      options.apply = true
      continue
    }
    if (token.startsWith("--year=")) {
      options.year = Number(token.slice("--year=".length))
      continue
    }
    if (token.startsWith("--worksite=")) {
      options.worksite = token.slice("--worksite=".length)
      continue
    }
    if (token.startsWith("--through-month=")) {
      options.throughMonth = Number(token.slice("--through-month=".length))
      continue
    }
    if (token.startsWith("--leave-gap-percent=")) {
      options.gapPercent = Number(token.slice("--leave-gap-percent=".length))
      continue
    }
    if (token === "--report-only") {
      options.apply = false
      continue
    }
    throw new Error(`Argumento no reconocido: ${token}`)
  }
  if (!Number.isInteger(options.throughMonth) || options.throughMonth < 1 || options.throughMonth > 12) {
    throw new Error("--through-month debe ser un entero entre 1 y 12.")
  }
  if (!Number.isFinite(options.gapPercent) || options.gapPercent < 0 || options.gapPercent > 50) {
    throw new Error("--leave-gap-percent debe estar entre 0 y 50.")
  }
  return options
}

/**
 * Guarda de seguridad. La petición fue explícita: esto se corre en dev, nunca
 * en producción. Un `DATABASE_URL` remoto o una base llamada `bodega` no pasan,
 * aunque alguien exporte la variable a mano en la misma terminal.
 */
function assertDevDatabase(rawUrl: string): URL {
  // `NODE_ENV` no sirve como guarda acá: la imagen standalone de la app corre
  // con `production` incluso en el entorno de desarrollo. La base sí distingue.
  const url = new URL(rawUrl)
  const database = url.pathname.replace(/^\//, "")
  const host = url.hostname || "(socket local)"
  const local = !url.hostname || ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  if (!local) {
    throw new Error(`Destino no local: ${host}/${database}. Este seed sólo escribe en una base de desarrollo local.`)
  }
  if (!/dev|test/i.test(database)) {
    throw new Error(`La base "${database}" no parece de desarrollo (se esperaba un nombre con "dev" o "test").`)
  }
  return url
}

function formatTarget(url: URL) {
  return `${url.hostname || "socket local"}:${url.port || "5432"}/${url.pathname.replace(/^\//, "")}`
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Un instante razonable dentro del mes sembrado, para `executed_at`/`approved_at`. */
function demoInstant(year: number, month: number, day?: number) {
  const safeDay = Math.min(day ?? Math.min(15, daysInMonth(year, month)), daysInMonth(year, month))
  return `${year}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}T15:00:00.000Z`
}

/** Hash estable para repartir la brecha sin azar entre corridas. */
function stableHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

async function main() {
  if (!process.env.DATABASE_URL) loadEnvConfig(process.cwd())

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("DATABASE_URL es obligatorio.")
  const target = assertDevDatabase(databaseUrl)

  const options = parseOptions(process.argv.slice(2))

  const [{ db }, schema, drizzle, period, retirement, subjectRegistry, compliance, utils] = await Promise.all([
    import("../db"),
    import("../db/schema"),
    import("drizzle-orm"),
    import("../lib/services/pdtp/period"),
    import("../lib/services/pdtp/retirement"),
    import("../lib/services/pdtp/subject-registry"),
    import("../lib/services/pdtp/compliance"),
    import("../lib/utils"),
  ])

  const year = options.year ?? utils.chileDateParts().year
  const now = new Date().toISOString()

  const programs = await db.select().from(schema.pdtpPrograms)
    .where(drizzle.eq(schema.pdtpPrograms.year, year))
    .orderBy(drizzle.desc(schema.pdtpPrograms.version))
  const program = programs.find((entry) => entry.status === "active") ?? programs[0]
  if (!program) throw new Error(`No hay programa PDTP para ${year}.`)

  const worksiteRows = await db.select({ id: schema.worksites.id, name: schema.worksites.name })
    .from(schema.worksites)
    .where(drizzle.eq(schema.worksites.isActive, true))
    .orderBy(schema.worksites.name)
  const selectedWorksites = options.worksite
    ? worksiteRows.filter((worksite) => worksite.id === options.worksite)
    : worksiteRows
  if (selectedWorksites.length === 0) throw new Error("No hay faenas activas para sembrar.")

  const activityRows = await db.select({
    id: schema.pdtpActivities.id,
    n: schema.pdtpActivities.n,
    activity: schema.pdtpActivities.activity,
    indicatorMode: schema.pdtpActivities.indicatorMode,
    subjectSource: schema.pdtpActivities.subjectSource,
    subjectCapabilityCodes: schema.pdtpActivities.subjectCapabilityCodes,
    status: schema.pdtpActivities.status,
    retiredEffectiveFrom: schema.pdtpActivities.retiredEffectiveFrom,
  }).from(schema.pdtpActivities)
    .where(drizzle.eq(schema.pdtpActivities.programId, program.id))
    .orderBy(schema.pdtpActivities.n)
  const activityById = new Map(activityRows.map((activity) => [activity.id, activity]))

  const scheduleRows = activityRows.length > 0
    ? await db.select().from(schema.pdtpActivitySchedule).where(drizzle.and(
        drizzle.eq(schema.pdtpActivitySchedule.year, year),
        drizzle.inArray(schema.pdtpActivitySchedule.activityId, activityRows.map((activity) => activity.id)),
      ))
    : []

  const worksiteIds = selectedWorksites.map((worksite) => worksite.id)
  const memberships = await db.select({
    worksiteId: schema.pdtpProgramWorksites.worksiteId,
    addedAt: schema.pdtpProgramWorksites.addedAt,
  }).from(schema.pdtpProgramWorksites)
    .where(drizzle.eq(schema.pdtpProgramWorksites.programId, program.id))
  const addedAtByWorksite = new Map(memberships.map((entry) => [entry.worksiteId, entry.addedAt]))

  const paramRows = activityRows.length > 0
    ? await db.select({
        activityId: schema.pdtpActivityWorksiteParams.activityId,
        worksiteId: schema.pdtpActivityWorksiteParams.worksiteId,
        expectedSubjectCount: schema.pdtpActivityWorksiteParams.expectedSubjectCount,
        targetCoveragePercent: schema.pdtpActivityWorksiteParams.targetCoveragePercent,
      }).from(schema.pdtpActivityWorksiteParams).where(drizzle.and(
        drizzle.inArray(schema.pdtpActivityWorksiteParams.activityId, activityRows.map((activity) => activity.id)),
        drizzle.inArray(schema.pdtpActivityWorksiteParams.worksiteId, worksiteIds),
      ))
    : []
  const paramsByCell = new Map(paramRows.map((row) => [`${row.activityId}:${row.worksiteId}`, row]))

  const exclusions = activityRows.length > 0
    ? await db.select({
        activityId: schema.pdtpActivityWorksiteExclusions.activityId,
        worksiteId: schema.pdtpActivityWorksiteExclusions.worksiteId,
      }).from(schema.pdtpActivityWorksiteExclusions).where(drizzle.and(
        drizzle.inArray(schema.pdtpActivityWorksiteExclusions.activityId, activityRows.map((activity) => activity.id)),
        drizzle.inArray(schema.pdtpActivityWorksiteExclusions.worksiteId, worksiteIds),
      ))
    : []
  const excluded = new Set(exclusions.map((row) => `${row.activityId}:${row.worksiteId}`))

  const representativeUserId = (await db.select({ id: schema.users.id }).from(schema.users)
    .where(drizzle.eq(schema.users.isActive, true)).limit(1))[0]?.id ?? null

  type DemoRow = typeof schema.pdtpExecutions.$inferInsert
  const rowsByCell = new Map<string, DemoRow>()
  const stockTargetCache = new Map<string, number | null>()

  const stockTargetFor = async (activity: (typeof activityRows)[number], worksiteId: string) => {
    const cacheKey = `${activity.id}:${worksiteId}`
    if (stockTargetCache.has(cacheKey)) return stockTargetCache.get(cacheKey) ?? null
    const count = await subjectRegistry.resolvePdtpSubjectCount(
      activity.subjectSource,
      worksiteId,
      { year, month: 1 },
      { capabilityCodes: activity.subjectCapabilityCodes },
    )
    stockTargetCache.set(cacheKey, count)
    return count
  }

  const derivedTargetFor = async (activity: (typeof activityRows)[number], worksiteId: string, month: number) => {
    if (!activity.subjectSource) return null
    if (subjectRegistry.isFlowSubjectSource(activity.subjectSource)) {
      const count = await subjectRegistry.resolvePdtpSubjectCount(
        activity.subjectSource,
        worksiteId,
        { year, month },
        { capabilityCodes: activity.subjectCapabilityCodes },
      )
      return count != null && count > 0 ? count : null
    }
    const count = await stockTargetFor(activity, worksiteId)
    // `trabajadores_capacidad` guarda el cero resuelto a propósito; las demás
    // fuentes de stock caen a lo planificado cuando su registro está vacío.
    if (activity.subjectSource === "trabajadores_capacidad") return count
    return count != null && count > 0 ? count : null
  }

  const pushRow = (input: {
    activityId: string
    worksiteId: string
    month: number
    week: number
    executedQuantity: number
  }) => {
    const quantity = Math.round(input.executedQuantity * 100) / 100
    if (quantity <= 0) return
    const key = `${input.activityId}:${input.worksiteId}:${input.month}:${input.week}`
    const existing = rowsByCell.get(key)
    if (existing) {
      existing.executedQuantity = Math.max(Number(existing.executedQuantity), quantity)
      return
    }
    const instant = demoInstant(year, input.month)
    rowsByCell.set(key, {
      id: `demo-${DEMO_SEED_KEY}-${input.activityId}-${input.worksiteId}-${year}-${input.month}-${input.week}`,
      activityId: input.activityId,
      worksiteId: input.worksiteId,
      year,
      month: input.month,
      week: input.week,
      executedQuantity: quantity,
      status: "approved",
      evidenceText: "Ejecución de demostración para el tablero de Inicio (sólo dev).",
      evidencePhotos: [],
      executedByUserId: representativeUserId,
      executedAt: instant,
      approvedByUserId: representativeUserId,
      approvedAt: instant,
      origin: "manual",
      evidenceStatus: "not_required",
      sourceMetadataJson: { demoSeed: DEMO_SEED_KEY, generatedAt: now },
      createdAt: now,
      updatedAt: now,
    })
  }

  for (const worksite of selectedWorksites) {
    const activationCutoff = period.effectiveActivationFor(program.activatedAt, addedAtByWorksite.get(worksite.id) ?? null)
    const effectiveRows = period.filterPdtpRowsFromActivation(scheduleRows, activationCutoff)
      .filter((row) => row.month <= options.throughMonth)
      .filter((row) => {
        const activity = activityById.get(row.activityId)
        return activity
          && !excluded.has(`${row.activityId}:${worksite.id}`)
          && retirement.isPdtpActivityEffectiveForPeriod(activity, year, row.month, row.week)
      })

    const monthsWithScheduleByActivity = new Map<string, Set<number>>()
    for (const row of effectiveRows) {
      const months = monthsWithScheduleByActivity.get(row.activityId) ?? new Set<number>()
      months.add(row.month)
      monthsWithScheduleByActivity.set(row.activityId, months)
    }

    for (const row of effectiveRows) {
      const activity = activityById.get(row.activityId)!
      const planned = Number(row.plannedQuantity)
      if (activity.indicatorMode === "coverage") {
        const params = paramsByCell.get(`${activity.id}:${worksite.id}`)
        const manualTarget = params?.expectedSubjectCount ?? null
        const derived = await derivedTargetFor(activity, worksite.id, row.month)
        const coverageTarget = manualTarget ?? derived ?? planned
        if (coverageTarget <= 0) continue
        const targetPct = params?.targetCoveragePercent ?? null
        const threshold = targetPct != null ? Math.ceil((coverageTarget * targetPct) / 100) : coverageTarget
        pushRow({
          activityId: activity.id,
          worksiteId: worksite.id,
          month: row.month,
          week: row.week,
          executedQuantity: Math.max(coverageTarget, threshold),
        })
        continue
      }
      pushRow({
        activityId: activity.id,
        worksiteId: worksite.id,
        month: row.month,
        week: row.week,
        executedQuantity: planned,
      })
    }

    /*
     * Una cobertura de flujo (`trabajadores_nuevos`) cuenta casos incluso en un
     * mes sin calendario. Si la faena tuvo ingresos en un mes que el libro no
     * programó, el denominador los exige igual: sin una ejecución esa celda
     * quedaría en cero y bajaría el índice sin motivo visible.
     */
    for (const activity of activityRows) {
      if (activity.indicatorMode !== "coverage" || !subjectRegistry.isFlowSubjectSource(activity.subjectSource)) continue
      if (excluded.has(`${activity.id}:${worksite.id}`)) continue
      const monthsWithSchedule = monthsWithScheduleByActivity.get(activity.id) ?? new Set<number>()
      for (let month = 1; month <= options.throughMonth; month++) {
        if (monthsWithSchedule.has(month)) continue
        if (!period.isPdtpPeriodOnOrAfterActivation({ year, month, week: 4 }, activationCutoff)) continue
        if (!retirement.isPdtpActivityEffectiveForPeriod(activity, year, month, 4)) continue
        const derived = await derivedTargetFor(activity, worksite.id, month)
        if (derived == null || derived <= 0) continue
        const params = paramsByCell.get(`${activity.id}:${worksite.id}`)
        const targetPct = params?.targetCoveragePercent ?? null
        const threshold = targetPct != null ? Math.ceil((derived * targetPct) / 100) : derived
        pushRow({
          activityId: activity.id,
          worksiteId: worksite.id,
          month,
          week: 4,
          executedQuantity: Math.max(derived, threshold),
        })
      }
    }
  }

  const baseline = await compliance.getPdtpComplianceIndicatorsForScope(year, worksiteIds, { consolidateYear: true })
  const baselinePlanned = baseline?.annual.planned ?? 0

  /*
   * La brecha se reparte entre celdas de cantidad pequeña y con un hash estable:
   * así queda esparcida por faenas y meses (no un bloque de actividades en
   * cero), se repite igual en cada corrida y no toca las coberturas, cuya
   * cantidad es el padrón completo y borraría una porción enorme del numerador.
   */
  const gapTarget = Math.round((baselinePlanned * options.gapPercent) / 100)
  let gapRows = 0
  let gapUnits = 0
  if (gapTarget > 0) {
    const candidates = [...rowsByCell.entries()]
      .filter(([, row]) => activityById.get(row.activityId!)?.indicatorMode !== "coverage")
      .sort((left, right) => stableHash(left[0]) - stableHash(right[0]))
    for (const [key, row] of candidates) {
      if (gapUnits >= gapTarget) break
      const quantity = Number(row.executedQuantity)
      if (quantity > 2) continue
      rowsByCell.delete(key)
      gapUnits += quantity
      gapRows += 1
    }
  }

  const rows = [...rowsByCell.values()]
  console.log(`PDTP ${program.year} · ${program.status} · ${program.id}`)
  console.log(`Destino: ${formatTarget(target)}`)
  console.log(`Faenas: ${selectedWorksites.length}`)
  console.log(`Ejecuciones de demostración a escribir: ${rows.length}`)
  console.log(`Meses cubiertos: 1–${options.throughMonth}`)
  console.log(`Brecha deliberada: ${gapUnits} unidades en ${gapRows} celdas (~${options.gapPercent}% del plan)`)

  if (!options.apply) {
    console.log("Dry-run: no se escribió nada. Usa --apply para sembrar.")
    console.log(`Índice actual: ${baseline?.annual.percent == null ? "sin datos" : `${Math.round(baseline.annual.percent * 100)}%`} (${baseline?.annual.executed ?? 0} de ${baseline?.annual.planned ?? 0})`)
    await closeDb()
    return
  }

  const deleted = await db.delete(schema.pdtpExecutions)
    .where(drizzle.and(
      drizzle.eq(schema.pdtpExecutions.year, year),
      drizzle.sql`${schema.pdtpExecutions.sourceMetadataJson} ->> 'demoSeed' = ${DEMO_SEED_KEY}`,
    ))
    .returning({ id: schema.pdtpExecutions.id })
  console.log(`Filas de demostración previas eliminadas: ${deleted.length}`)

  const chunkSize = 400
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize)
    await db.insert(schema.pdtpExecutions).values(chunk).onConflictDoNothing()
  }

  const inserted = await db.select({ id: schema.pdtpExecutions.id }).from(schema.pdtpExecutions)
    .where(drizzle.and(
      drizzle.eq(schema.pdtpExecutions.year, year),
      drizzle.sql`${schema.pdtpExecutions.sourceMetadataJson} ->> 'demoSeed' = ${DEMO_SEED_KEY}`,
    ))
  console.log(`Filas de demostración insertadas: ${inserted.length} (las celdas con una ejecución real previa se respetaron)`)

  const result = await compliance.getPdtpComplianceIndicatorsForScope(year, worksiteIds, { consolidateYear: true })
  const percent = result?.annual.percent == null ? null : Math.round(result.annual.percent * 100)
  console.log("")
  console.log(`Índice de cumplimiento anual: ${percent == null ? "sin datos" : `${percent}%`} (${result?.annual.executed ?? 0} de ${result?.annual.planned ?? 0})`)
  if (result) {
    for (const entry of result.perWorksite) {
      const worksite = selectedWorksites.find((candidate) => candidate.id === entry.worksiteId)
      const annual = entry.indicators?.annual
      console.log(`  ${worksite?.name ?? entry.worksiteId}: ${annual?.percent == null ? "—" : `${Math.round(annual.percent * 100)}%`} (${annual?.executed ?? 0} de ${annual?.planned ?? 0})`)
    }
  }
  await closeDb()
}

async function closeDb() {
  // `db` es el singleton de Next; el script termina explícitamente para no dejar
  // el pool abierto, igual que los demás seeds de `scripts/`.
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
