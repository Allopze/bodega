/**
 * Conjunto de datos sintético y determinista para medir el cumplimiento PDTP
 * (I12, T7b): cuántas consultas cuesta cada lectura y si las cifras cambian al
 * optimizarla.
 *
 * Lo comparten la prueba de presupuesto de consultas y la de cifras doradas
 * (`pdtp-compliance-performance.test.ts`, PGlite) y el bloque PDTP de
 * `npm run perf:queries` (Postgres real, 10 faenas × 80 actividades). Por eso
 * recibe la base como parámetro y no importa `@/db`.
 *
 * Cubre a propósito todo lo que el cálculo distingue, para que una
 * optimización que mezcle faenas o pierda una regla se note en las cifras:
 *
 * - dos versiones del año (v1 cerrada por reemplazo y v2 activa desde julio),
 *   con ejecuciones tardías de la v1 fuera de su ventana;
 * - una faena incorporada a mitad de año (corte por faena);
 * - actividades por calendario (mensuales y trimestrales), por cobertura con
 *   cada fuente de padrón (stock, flujo y capacidades) y override manual, por
 *   plazo con piso anual, con ocurrencias (completadas con ejecución aprobada y
 *   con ejecución enviada, N/A, canceladas) y una retirada en octubre;
 * - sobreejecución, envíos no aprobados, integración que duplica la carga
 *   manual, overrides, exclusiones y desvíos de los tres tipos;
 * - acciones CAPA sobre ejecuciones aprobadas (ejes 2 y 3 del integral).
 */
import { eq } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import * as schema from "@/db/schema"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FixtureDb = PgDatabase<PgQueryResultHKT, typeof schema, any>

export type PdtpComplianceFixtureOptions = {
  year?: number
  worksiteCount?: number
  /** Actividades por versión. */
  activityCount?: number
  /** `false` deja sólo la v1 activa, sin revisión. */
  revised?: boolean
  prefix?: string
}

export type PdtpComplianceFixture = {
  year: number
  userId: string
  worksiteIds: string[]
  v1ProgramId: string
  v2ProgramId: string | null
  /** La versión vigente: la que mira el tablero. */
  activeProgramId: string
}

const SOURCES = ["dotacion", "trabajadores_nuevos", "trabajadores_capacidad", "extintores", "equipos", "expuestos_ges", null] as const
const CREATED = "2024-12-15T12:00:00.000Z"

type ActivityKind = "grid" | "quarterly" | "coverage" | "closed_on_time" | "instances"

function kindOf(n: number): ActivityKind {
  if (n % 12 === 3 || n % 12 === 9 || n % 12 === 10) return "coverage"
  if (n % 12 === 7) return "closed_on_time"
  if (n % 12 === 11) return "instances"
  if (n % 5 === 0) return "quarterly"
  return "grid"
}

/** Fuente de padrón de la k-ésima actividad de cobertura: recorre las siete (seis fuentes y "sin fuente"). */
function sourceOf(n: number): (typeof SOURCES)[number] {
  let ordinal = 0
  for (let m = 1; m < n; m++) if (kindOf(m) === "coverage") ordinal++
  return SOURCES[ordinal % SOURCES.length]!
}

function pad(value: number, size = 2) {
  return String(value).padStart(size, "0")
}

async function insertChunked<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>, size = 500) {
  for (let index = 0; index < rows.length; index += size) {
    const chunk = rows.slice(index, index + size)
    if (chunk.length > 0) await insert(chunk)
  }
}

export async function seedPdtpComplianceFixture(db: FixtureDb, options: PdtpComplianceFixtureOptions = {}): Promise<PdtpComplianceFixture> {
  const year = options.year ?? 2025
  const worksiteCount = options.worksiteCount ?? 6
  const activityCount = options.activityCount ?? 24
  const revised = options.revised ?? true
  const p = options.prefix ?? "fx"
  const userId = `${p}-user-1`
  const approverId = `${p}-user-2`
  const worksiteIds = Array.from({ length: worksiteCount }, (_, index) => `${p}-ws-${pad(index + 1)}`)
  const v1ProgramId = `${p}-pdtp-${year}-v1`
  const v2ProgramId = revised ? `${p}-pdtp-${year}-v2` : null
  const v1ActivatedAt = `${year}-01-06T12:00:00.000Z`
  const v2ActivatedAt = `${year}-07-01T12:00:00.000Z`

  await db.insert(schema.users).values([
    { id: userId, name: "Registra fixture", email: `${userId}@fixture.test`, hashedPassword: "x", isActive: true },
    { id: approverId, name: "Aprueba fixture", email: `${approverId}@fixture.test`, hashedPassword: "x", isActive: true },
  ])
  await db.insert(schema.worksites).values(worksiteIds.map((id, index) => ({ id, name: `Faena ${index + 1}`, code: `${p.toUpperCase()}${pad(index + 1)}`, isActive: true })))

  const programBase = {
    year,
    elaboratedByName: "Fixture",
    elaboratedByTitle: "Prevencionista",
    creationMode: "blank",
    complianceTarget: 0.9,
    pesoEjecucion: 0.5,
    pesoVerificacion: 0.3,
    pesoCierre: 0.2,
    appliesToAllWorksites: false,
    createdAt: CREATED,
    updatedAt: CREATED,
  }
  await db.insert(schema.pdtpPrograms).values([
    { ...programBase, id: v1ProgramId, version: 1, title: `PDTP ${year} v1`, status: revised ? "closed" : "active", activatedAt: v1ActivatedAt },
    ...(v2ProgramId ? [{ ...programBase, id: v2ProgramId, version: 2, title: `PDTP ${year} v2`, status: "active", activatedAt: v2ActivatedAt }] : []),
  ])
  const programIds = [v1ProgramId, ...(v2ProgramId ? [v2ProgramId] : [])]

  // La última faena entra al programa en abril: su corte es por faena.
  await db.insert(schema.pdtpProgramWorksites).values(programIds.flatMap((programId) => worksiteIds.map((worksiteId, index) => ({
    id: `${programId}-pw-${worksiteId}`,
    programId,
    worksiteId,
    isActive: true,
    addedByUserId: userId,
    addedAt: index === worksiteCount - 1 && worksiteCount > 1 ? `${year}-04-15T12:00:00.000Z` : `${year}-01-01T12:00:00.000Z`,
  }))))

  // ── Actividades (la v2 copia la v1 con los mismos números) ────────────────
  const activityId = (programId: string, n: number) => `${programId}-a-${pad(n, 3)}`
  const activities = programIds.flatMap((programId) => Array.from({ length: activityCount }, (_, index) => {
    const n = index + 1
    const kind = kindOf(n)
    const source = kind === "coverage" ? sourceOf(n) : null
    return {
      id: activityId(programId, n),
      programId,
      n,
      activity: `Actividad ${n}`,
      program: ["Liderazgo", "Riesgos", "Emergencias", "Salud"][n % 4]!,
      responsibleSlugs: ["prevencionista"],
      responsibleDisplay: "Prevencionista",
      scheduleMode: kind === "closed_on_time" || n === 3 ? "on_demand" : "scheduled",
      indicatorMode: kind === "coverage" ? "coverage" : kind === "closed_on_time" ? "closed_on_time" : "planned_vs_completed",
      subjectSource: source,
      subjectCapabilityCodes: source === "trabajadores_capacidad" ? ["drives_vehicle"] : null,
      scheduleDefinition: kind === "instances" ? { kind: "fixed_dates", dates: [] } : null,
      minAnnualExecutions: kind === "closed_on_time" ? 3 : n === 3 ? 2 : null,
      // La N°5 se retira en octubre: sus celdas desde entonces dejan de exigirse.
      status: n === 5 ? "retired" : "active",
      retiredReason: n === 5 ? "Se reemplaza por otra actividad" : null,
      retiredEffectiveFrom: n === 5 ? `${year}-10-01` : null,
      retiredAt: n === 5 ? `${year}-09-20T12:00:00.000Z` : null,
      sourceSheetRow: n,
      createdAt: CREATED,
      updatedAt: CREATED,
    }
  }))
  await insertChunked(activities, (chunk) => db.insert(schema.pdtpActivities).values(chunk as Array<typeof schema.pdtpActivities.$inferInsert>))
  // Una hoja general por versión con todas sus actividades (planilla agregada).
  await db.insert(schema.pdtpSheets).values(programIds.map((programId) => ({
    id: `${programId}-sheet-general`, code: "pdtp_general", programId, label: "General", area: "General", defaultScopeRoles: [],
  })))
  await insertChunked(activities.map((activity) => ({
    id: `${activity.id}-sheet-general`, sheetId: `${activity.programId}-sheet-general`, sheetCode: "pdtp_general",
    activityId: activity.id, sheetRow: activity.n, displayOrder: activity.n,
  })), (chunk) => db.insert(schema.pdtpSheetActivities).values(chunk))

  // ── Calendario global ──────────────────────────────────────────────────────
  const weekOf = (n: number, month: number) => 1 + ((n + month) % 4)
  const plannedOf = (n: number) => 1 + (n % 3)
  const scheduleRows: Array<typeof schema.pdtpActivitySchedule.$inferInsert> = []
  for (const programId of programIds) {
    for (let n = 1; n <= activityCount; n++) {
      const kind = kindOf(n)
      if (kind === "closed_on_time" || kind === "instances") continue
      const months = kind === "quarterly" ? [3, 6, 9, 12] : Array.from({ length: 12 }, (_, i) => i + 1)
      for (const month of months) {
        const week = weekOf(n, month)
        scheduleRows.push({
          id: `${activityId(programId, n)}-s-${year}-${pad(month)}-${week}`,
          activityId: activityId(programId, n),
          year, month, week,
          plannedQuantity: plannedOf(n),
          sourceColumn: "fixture",
        })
      }
    }
  }
  await insertChunked(scheduleRows, (chunk) => db.insert(schema.pdtpActivitySchedule).values(chunk))

  // Enero..junio es de la v1; julio..diciembre, de la v2. La v1 además recibe
  // julio y agosto tardíos, que su ventana debe descartar.
  const ownerOf = (month: number) => (v2ProgramId && month >= 7 ? v2ProgramId : v1ProgramId)

  // ── Ejecuciones del libro ─────────────────────────────────────────────────
  const executions: Array<typeof schema.pdtpExecutions.$inferInsert> = []
  worksiteIds.forEach((worksiteId, k) => {
    for (let n = 1; n <= activityCount; n++) {
      const kind = kindOf(n)
      if (kind === "closed_on_time" || kind === "instances") continue
      const months = kind === "quarterly" ? [3, 6, 9, 12] : Array.from({ length: 12 }, (_, i) => i + 1)
      for (const month of months) {
        if ((n + k + month) % 3 === 0) continue
        const week = weekOf(n, month)
        const programs = v2ProgramId && (month === 7 || month === 8) ? [v1ProgramId, v2ProgramId] : [ownerOf(month)]
        for (const programId of programs) {
          const id = `${activityId(programId, n)}-e-${worksiteId}-${pad(month)}-${week}`
          const submitted = (n + k + month) % 5 === 0
          const quantity = kind === "coverage"
            ? 2 + ((n + k + month) % 6)
            : plannedOf(n) + ((n + month) % 7 === 0 ? 1 : 0) - ((n + k) % 4 === 0 ? 1 : 0)
          executions.push({
            id,
            activityId: activityId(programId, n),
            worksiteId, year, month, week,
            executedQuantity: Math.max(0, quantity),
            status: submitted ? "submitted" : "approved",
            executedByUserId: userId,
            approvedByUserId: submitted ? null : approverId,
            approvedAt: submitted ? null : `${year}-${pad(month)}-20T12:00:00.000Z`,
            origin: "manual",
            createdAt: `${year}-${pad(month)}-15T12:00:00.000Z`,
            updatedAt: `${year}-${pad(month)}-${pad(10 + ((n + k) % 18))}T12:00:00.000Z`,
          })
          // Una acreditación de la misma semana: se toma el mayor, no la suma.
          if ((n + k + month) % 11 === 0) {
            executions.push({
              id: `${id}-int`,
              activityId: activityId(programId, n),
              worksiteId, year, month, week,
              executedQuantity: 1 + (n % 2),
              status: "approved",
              executedByUserId: userId,
              approvedByUserId: approverId,
              approvedAt: `${year}-${pad(month)}-21T12:00:00.000Z`,
              origin: "integration",
              sourceType: "inspeccion",
              sourceId: `${id}-run`,
              idempotencyKey: `${id}-int-key`,
              createdAt: `${year}-${pad(month)}-16T12:00:00.000Z`,
              updatedAt: `${year}-${pad(month)}-22T12:00:00.000Z`,
            })
          }
        }
      }
    }
  })

  // ── Ocurrencias (actividades con definición propia) ───────────────────────
  const instances: Array<typeof schema.pdtpScheduledInstances.$inferInsert> = []
  worksiteIds.forEach((worksiteId, k) => {
    for (let n = 1; n <= activityCount; n++) {
      if (kindOf(n) !== "instances") continue
      for (let month = 1; month <= 12; month++) {
        const programId = ownerOf(month)
        const id = `${activityId(programId, n)}-i-${worksiteId}-${pad(month)}`
        const variant = (n + k + month) % 5
        const status = variant === 0 ? "not_applicable" : variant === 1 ? "cancelled" : variant === 2 ? "pending" : "completed"
        const scheduledFor = `${year}-${pad(month)}-10`
        instances.push({
          id, programId, activityId: activityId(programId, n), worksiteId, scheduledFor,
          isoWeekYear: year, isoWeek: Math.min(53, month * 4),
          plannedQuantity: 1 + (month % 2),
          status,
          notApplicableReason: status === "not_applicable" ? "No hubo turno" : null,
          cancellationReason: status === "cancelled" ? "Se reprogramó" : null,
          cancelledAt: status === "cancelled" ? `${year}-${pad(month)}-09T12:00:00.000Z` : null,
          completedAt: status === "completed" ? `${year}-${pad(month)}-10T18:00:00.000Z` : null,
          idempotencyKey: `${id}-key`,
          createdAt: CREATED,
          updatedAt: `${year}-${pad(month)}-${pad(11 + (k % 10))}T12:00:00.000Z`,
        })
        if (status !== "completed") continue
        // D19: la ocurrencia completada cuenta sólo si su ejecución está aprobada.
        const week = 2
        executions.push({
          id: `${id}-e`,
          activityId: activityId(programId, n),
          worksiteId, year, month, week,
          executedQuantity: 1,
          status: variant === 4 ? "submitted" : "approved",
          executedByUserId: userId,
          approvedByUserId: variant === 4 ? null : approverId,
          approvedAt: variant === 4 ? null : `${year}-${pad(month)}-12T12:00:00.000Z`,
          origin: "manual",
          scheduledInstanceId: id,
          createdAt: `${year}-${pad(month)}-10T19:00:00.000Z`,
          updatedAt: `${year}-${pad(month)}-12T12:00:00.000Z`,
        })
      }
    }
  })
  await insertChunked(instances, (chunk) => db.insert(schema.pdtpScheduledInstances).values(chunk))
  await insertChunked(executions, (chunk) => db.insert(schema.pdtpExecutions).values(chunk))

  // ── Obligaciones (plazo y casos de cobertura) ─────────────────────────────
  const obligations: Array<typeof schema.pdtpObligations.$inferInsert> = []
  worksiteIds.forEach((worksiteId, k) => {
    for (let n = 1; n <= activityCount; n++) {
      const kind = kindOf(n)
      if (kind !== "closed_on_time" && kind !== "coverage") continue
      for (let c = 0; c < 4; c++) {
        const month = 1 + ((n + k * 3 + c * 4) % 12)
        const programId = ownerOf(month)
        const id = `${activityId(programId, n)}-o-${worksiteId}-${c}`
        const variant = (n + k + c) % 4
        const status = variant === 3 ? "cancelled" : variant === 2 ? "pending" : "completed"
        const dueAt = `${year}-${pad(month)}-20T12:00:00.000Z`
        obligations.push({
          id, programId, activityId: activityId(programId, n), worksiteId,
          mode: "on_demand", status, origin: "integration",
          sourceType: "fixture", sourceId: id,
          dueAt: c === 3 && k === 0 ? `${year + 1}-01-10T12:00:00.000Z` : dueAt,
          reportedAt: status === "completed" ? (variant === 0 ? `${year}-${pad(month)}-18T12:00:00.000Z` : `${year}-${pad(month)}-25T12:00:00.000Z`) : null,
          completedAt: status === "completed" ? `${year}-${pad(month)}-26T12:00:00.000Z` : null,
          cancelledAt: status === "cancelled" ? `${year}-${pad(month)}-05T12:00:00.000Z` : null,
          cancellationReason: status === "cancelled" ? "Se descartó el caso por duplicado" : null,
          // Sólo algunas obligaciones de cobertura son un caso propio.
          sourceMetadataJson: kind === "coverage" ? { countsAsCoverageCase: c % 2 === 0 } : {},
          idempotencyKey: `${id}-key`,
          createdAt: CREATED,
          updatedAt: CREATED,
        })
      }
    }
  })
  await insertChunked(obligations, (chunk) => db.insert(schema.pdtpObligations).values(chunk))

  // ── Overrides, exclusiones, desvíos y parámetros por faena ───────────────
  const overrides: Array<typeof schema.pdtpActivityScheduleOverrides.$inferInsert> = []
  const exclusions: Array<typeof schema.pdtpActivityWorksiteExclusions.$inferInsert> = []
  const deviations: Array<typeof schema.pdtpExecutionDeviations.$inferInsert> = []
  const params: Array<typeof schema.pdtpActivityWorksiteParams.$inferInsert> = []
  for (const programId of programIds) {
    worksiteIds.forEach((worksiteId, k) => {
      if (k % 3 === 1) {
        overrides.push(
          { id: `${programId}-ov-${worksiteId}-1`, activityId: activityId(programId, 2), worksiteId, year, month: 4, week: weekOf(2, 4), plannedQuantity: 5, createdAt: CREATED, updatedAt: CREATED },
          { id: `${programId}-ov-${worksiteId}-2`, activityId: activityId(programId, 2), worksiteId, year, month: 9, week: 1, plannedQuantity: 2, createdAt: CREATED, updatedAt: CREATED },
        )
      }
      if (k % 3 === 2) {
        for (const n of [4, 7]) {
          if (n > activityCount) continue
          exclusions.push({ id: `${programId}-ex-${worksiteId}-${n}`, activityId: activityId(programId, n), worksiteId, reason: "No aplica en la faena", createdAt: CREATED })
        }
      }
      if (k % 3 === 0) {
        const base = { worksiteId, year, reason: "Motivo de desvío de prueba", status: "active", createdByUserId: userId, createdAt: CREATED }
        deviations.push(
          { ...base, id: `${programId}-dv-${worksiteId}-na`, activityId: activityId(programId, 1), month: 2, week: weekOf(1, 2), kind: "not_applicable", reviewedByUserId: approverId, reviewedAt: CREATED },
          { ...base, id: `${programId}-dv-${worksiteId}-na2`, activityId: activityId(programId, 1), month: 9, week: weekOf(1, 9), kind: "not_applicable", reviewedByUserId: approverId, reviewedAt: CREATED },
          { ...base, id: `${programId}-dv-${worksiteId}-rp`, activityId: activityId(programId, 2), month: 3, week: weekOf(2, 3), kind: "reprogrammed", targetMonth: 4, targetWeek: 4 },
          { ...base, id: `${programId}-dv-${worksiteId}-rp2`, activityId: activityId(programId, 2), month: 10, week: weekOf(2, 10), kind: "reprogrammed", targetMonth: 11, targetWeek: 1 },
          { ...base, id: `${programId}-dv-${worksiteId}-np`, activityId: activityId(programId, 6), month: 5, week: weekOf(6, 5), kind: "not_performed" },
          { ...base, id: `${programId}-dv-${worksiteId}-np2`, activityId: activityId(programId, 6), month: 11, week: weekOf(6, 11), kind: "not_performed" },
        )
      }
      for (let n = 1; n <= activityCount; n++) {
        if (kindOf(n) !== "coverage") continue
        const source = sourceOf(n)
        // Override manual en la mitad de las faenas cuando la actividad no
        // tiene fuente; meta de cobertura bajo el padrón en otras.
        if (source === null && k % 2 === 0) params.push({ id: `${programId}-pa-${worksiteId}-${n}`, activityId: activityId(programId, n), worksiteId, expectedSubjectCount: 4 + k })
        else if (k % 2 === 1) params.push({ id: `${programId}-pa-${worksiteId}-${n}`, activityId: activityId(programId, n), worksiteId, targetCoveragePercent: 80 })
      }
    })
  }
  await insertChunked(overrides, (chunk) => db.insert(schema.pdtpActivityScheduleOverrides).values(chunk))
  await insertChunked(exclusions, (chunk) => db.insert(schema.pdtpActivityWorksiteExclusions).values(chunk))
  await insertChunked(deviations, (chunk) => db.insert(schema.pdtpExecutionDeviations).values(chunk))
  await insertChunked(params, (chunk) => db.insert(schema.pdtpActivityWorksiteParams).values(chunk))

  // ── Registros de sujetos (padrón derivado) ────────────────────────────────
  // El catálogo base ya siembra `drives_vehicle` (migraciones); si no, se crea.
  const [seededCapability] = await db.select({ id: schema.workerCapabilities.id }).from(schema.workerCapabilities)
    .where(eq(schema.workerCapabilities.code, "drives_vehicle")).limit(1)
  const capabilityId = seededCapability?.id ?? `${p}-cap-drives`
  if (!seededCapability) await db.insert(schema.workerCapabilities).values({ id: capabilityId, code: "drives_vehicle", name: "Conduce vehículos", isActive: true })
  await db.insert(schema.workerPositions).values([
    { id: `${p}-pos-driver`, code: `${p.toUpperCase()}-COND`, name: "Conductor", normalizedKey: `${p}-conductor`, isActive: true, needsReview: false, isSystem: false },
    { id: `${p}-pos-admin`, code: `${p.toUpperCase()}-ADM`, name: "Administrativo", normalizedKey: `${p}-administrativo`, isActive: true, needsReview: false, isSystem: false },
  ])
  await db.insert(schema.workerPositionCapabilities).values({ positionId: `${p}-pos-driver`, capabilityId })
  const workers: Array<typeof schema.workers.$inferInsert> = []
  worksiteIds.forEach((worksiteId, k) => {
    for (let i = 0; i < 3 + k; i++) {
      workers.push({
        id: `${p}-wk-${worksiteId}-${i}`,
        rut: `${p}-${k}-${i}`,
        firstName: "Trabajador",
        lastName: `${k}-${i}`,
        // La penúltima faena no tiene conductores: su padrón por capacidad
        // queda pendiente de clasificación (incidencia visible, no cero).
        positionId: i % 2 === 0 && k !== worksiteCount - 2 ? `${p}-pos-driver` : `${p}-pos-admin`,
        worksiteId,
        // El último de cada faena está inactivo: no es padrón.
        isActive: i !== 2 + k,
        createdAt: CREATED,
      })
    }
  })
  await insertChunked(workers, (chunk) => db.insert(schema.workers).values(chunk))
  const firstWorker = (k: number, i: number) => `${p}-wk-${worksiteIds[k]}-${i}`
  // Un conductor excluido y un administrativo incluido a mano en la primera faena.
  if (worksiteCount > 0) {
    await db.insert(schema.workerCapabilityOverrides).values([
      { id: `${p}-cov-ex`, workerId: firstWorker(0, 0), capabilityId, mode: "exclude", reason: "No conduce actualmente", createdByUserId: userId },
      { id: `${p}-cov-in`, workerId: firstWorker(0, 1), capabilityId, mode: "include", reason: "Conduce la camioneta de faena", createdByUserId: userId },
    ])
  }
  // Actas de trabajador nuevo (flujo): cerradas en febrero y mayo, un borrador.
  const evaluations: Array<typeof schema.sstEvaluations.$inferInsert> = []
  worksiteIds.forEach((worksiteId, k) => {
    for (let i = 0; i < Math.min(3, 3 + k); i++) {
      const month = [2, 5, 5][i]!
      evaluations.push({
        id: `${p}-ev-${worksiteId}-${i}`, worksiteId, workerId: firstWorker(k, i), createdBy: userId,
        definicionCode: "trabajador_nuevo", definicionVersion: "01", tipo: "nuevo",
        fechaEvaluacion: `${year}-${pad(month)}-${pad(5 + i)}`,
        estado: i === 2 && k % 2 === 0 ? "borrador" : "cerrado",
        createdAt: CREATED, updatedAt: CREATED,
      })
    }
  })
  await insertChunked(evaluations, (chunk) => db.insert(schema.sstEvaluations).values(chunk))
  // Extintores y equipos.
  await db.insert(schema.preventionEmergencyResourceTypes).values({ id: `${p}-rt-ext`, resourceClass: "extinguisher", agent: "PQS", capacity: 6, capacityUnit: "kg", canonicalName: `Extintor PQS 6 kg ${p}` })
  await db.insert(schema.preventionEmergencyResources).values(worksiteIds.flatMap((worksiteId, k) => Array.from({ length: 1 + (k % 3) }, (_, i) => ({
    id: `${p}-res-${worksiteId}-${i}`, worksiteId, typeId: `${p}-rt-ext`, name: `Ext ${i}`, kind: "extintor", location: "Portería",
    status: i === 2 ? "out_of_service" : "operational",
  }))))
  await db.insert(schema.fuelEquipmentTypes).values({ id: `${p}-eqt`, slug: `${p}-camion`, name: "Camión" })
  await db.insert(schema.fuelVehicles).values(worksiteIds.flatMap((worksiteId, k) => Array.from({ length: 1 + (k % 2) }, (_, i) => ({
    id: `${p}-veh-${worksiteId}-${i}`, plate: `${p.toUpperCase()}${pad(k)}${i}`, type: "camion", equipmentTypeId: `${p}-eqt`, worksiteId, isActive: true,
  }))))
  // Expuestos con vigilancia (GES por faena).
  await db.insert(schema.preventionExposureAgents).values({
    id: `${p}-ag`, code: `${p.toUpperCase()}-RUIDO`, name: "Ruido", agentType: "physical", unit: "dB(A)", limitBasis: "DS 594 art. 70", createdByUserId: userId,
  })
  await db.insert(schema.preventionExposureGroups).values(worksiteIds.map((worksiteId, k) => ({
    id: `${p}-ges-${worksiteId}`, code: `${p.toUpperCase()}-GES-${k}`, name: "Con vigilancia", worksiteId, agentId: `${p}-ag`,
    processDescription: "Proceso", surveillanceRequired: true, surveillanceReason: "Excedió el nivel de acción.", createdByUserId: userId,
  })))
  await insertChunked(worksiteIds.flatMap((worksiteId, k) => Array.from({ length: Math.min(2, 2 + k) }, (_, i) => ({
    id: `${p}-gm-${worksiteId}-${i}`, groupId: `${p}-ges-${worksiteId}`, workerId: firstWorker(k, i), joinedOn: `${year}-01-05`,
  }))), (chunk) => db.insert(schema.preventionExposureGroupMembers).values(chunk))

  // ── CAPA sobre ejecuciones aprobadas (ejes verificación/cierre) ──────────
  const approvedIds = executions.filter((row) => row.status === "approved" && row.origin === "manual").map((row) => row.id)
  const capa = approvedIds.filter((_, index) => index % 9 === 0).map((sourceId, index) => {
    const execution = executions.find((row) => row.id === sourceId)!
    return {
      id: `${p}-capa-${index}`, code: `${p.toUpperCase()}-CAPA-${pad(index, 5)}`, sourceType: "pdtp", sourceId,
      worksiteId: execution.worksiteId, finding: "Hallazgo de prueba", actionDescription: "Acción de prueba",
      targetDate: `${year}-12-31`, status: index % 3 === 0 ? "pending_verification" : "pending", createdByUserId: userId,
      createdAt: CREATED, updatedAt: CREATED,
    }
  })
  await insertChunked(capa, (chunk) => db.insert(schema.preventionCapaActions).values(chunk))

  return { year, userId, worksiteIds, v1ProgramId, v2ProgramId, activeProgramId: v2ProgramId ?? v1ProgramId }
}
