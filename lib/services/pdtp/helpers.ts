import { and, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpActivitySchedule,
  pdtpActivityWorksiteExclusions,
  pdtpChangeLog,
  pdtpExecutionChecklists,
  pdtpExecutions,
  pdtpPrograms,
  pdtpSheets,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { applyOverridesToSchedule, loadPdtpOverrides } from "./overrides"
import { isPdtpActivityEffectiveForPeriod } from "./retirement"
import { getPdtpActionWorksiteId } from "./capa-view"

export type WorksiteScope = string[] | "all"

function hasUniqueViolationCode(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "23505"
}

/**
 * Código de error Postgres 23505 = unique_violation (driver `postgres`).
 * Drizzle envuelve el error del driver en un `DrizzleQueryError` cuyo
 * `.code` propio no existe — el código real queda en `.cause` — así que
 * hay que revisar ambos niveles para no dejar pasar la violación real.
 */
export function isUniqueViolation(e: unknown): boolean {
  if (hasUniqueViolationCode(e)) return true
  const cause = e instanceof Error ? e.cause : undefined
  return hasUniqueViolationCode(cause)
}

export function assertWorksiteAccess(worksiteId: string, scope: WorksiteScope): void {
  if (scope === "all") return
  if (!scope.includes(worksiteId)) {
    throw new Error("Actividad PDTP no encontrada o sin acceso a la faena.")
  }
}

/** Evita que un usuario global use un identificador arbitrario como contexto de exportación. */
export async function isActivePdtpWorksite(worksiteId: string): Promise<boolean> {
  const [worksite] = await db
    .select({ id: worksites.id })
    .from(worksites)
    .where(and(eq(worksites.id, worksiteId), eq(worksites.isActive, true)))
    .limit(1)
  return Boolean(worksite)
}

type EditableProgramState = Pick<
  typeof pdtpPrograms.$inferSelect,
  "status" | "approvedByJdprUserId" | "approvedByLegalUserId" | "contentDigest" | "reviewStartedAt"
>

/** Bloquea contenido que ya entro a revision, incluidas firmas legacy que aun figuren como draft. */
export function assertPdtpProgramEditableState(program: EditableProgramState): void {
  if (
    program.status !== "draft"
    || program.approvedByJdprUserId
    || program.approvedByLegalUserId
    || program.contentDigest
    || program.reviewStartedAt
  ) {
    throw new Error("El programa ya entró a revisión y su contenido está bloqueado. Crea una nueva versión o reábrelo formalmente.")
  }
}

export async function assertPdtpProgramEditable(programId: string): Promise<typeof pdtpPrograms.$inferSelect> {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  assertPdtpProgramEditableState(program)
  return program
}

/** Verifica que una ejecución exista y pertenezca a una faena visible. */
export async function assertPdtpExecutionAccess(executionId: string, scope: WorksiteScope): Promise<void> {
  const [execution] = await db.select({ worksiteId: pdtpExecutions.worksiteId })
    .from(pdtpExecutions)
    .where(eq(pdtpExecutions.id, executionId))
    .limit(1)
  if (!execution) throw new Error("Ejecución PDTP no encontrada.")
  assertWorksiteAccess(execution.worksiteId, scope)
}

/** Verifica el alcance a partir de una instancia de checklist. */
export async function assertPdtpChecklistInstanceAccess(instanceId: string, scope: WorksiteScope): Promise<void> {
  const [instance] = await db.select({ worksiteId: pdtpExecutions.worksiteId })
    .from(pdtpExecutionChecklists)
    .innerJoin(pdtpExecutions, eq(pdtpExecutionChecklists.executionId, pdtpExecutions.id))
    .where(eq(pdtpExecutionChecklists.id, instanceId))
    .limit(1)
  if (!instance) throw new Error("Checklist de ejecución PDTP no encontrado.")
  assertWorksiteAccess(instance.worksiteId, scope)
}

/**
 * Verifica el alcance a partir de una acción correctiva. La faena es columna
 * directa de la CAPA, así que no hace falta pasar por la ejecución (D11).
 */
export async function assertPdtpActionPlanItemAccess(itemId: string, scope: WorksiteScope): Promise<void> {
  const worksiteId = await getPdtpActionWorksiteId(itemId)
  if (!worksiteId) throw new Error("Acción correctiva PDTP no encontrada.")
  assertWorksiteAccess(worksiteId, scope)
}

export function emptyMonthlyTotals() {
  return Array.from({ length: 12 }, (_, index) => ({ month: index + 1, planned: 0, executed: 0, percent: null as number | null }))
}

export function pdtpProgramId(year: number, version: number) {
  return `pdtp-${year}-v${version}`
}

/**
 * Resuelve la hoja PDTP (template o program-scoped) para un código dado.
 * Un código puede tener dos filas: una plantilla global (`program_id
 * NULL`, del seed) y una program-scoped (`program_id = programId`, creada
 * por el materializador anual/el adaptador de importación por lotes). Sin este orden explícito,
 * `.limit(1)` sobre ambas filas elige de forma arbitraria y puede devolver
 * la plantilla — cuyas membresías (`pdtp_sheet_activities`) no incluyen las
 * actividades de este programa — dando una vista vacía en silencio.
 * Preferimos siempre la hoja program-scoped; caemos a la plantilla solo si
 * el programa no tiene una copia propia.
 */
export async function resolveSheetForProgram(programId: string, sheetCode: string) {
  const [sheet] = await db.select().from(pdtpSheets)
    .where(and(
      eq(pdtpSheets.code, sheetCode),
      or(isNull(pdtpSheets.programId), eq(pdtpSheets.programId, programId)),
    ))
    .orderBy(sql`${pdtpSheets.programId} ASC NULLS LAST`)
    .limit(1)
  return sheet ?? null
}

export function pdtpActivityId(programId: string, activityNumber: number) {
  return `${programId}-a-${String(activityNumber).padStart(3, "0")}`
}

export function pdtpScheduleId(activityId: string, year: number, month: number, week: number) {
  return `${activityId}-s-${year}-${String(month).padStart(2, "0")}-${week}`
}

export function pdtpSheetActivityId(programId: string, sheetCode: string, activityNumber: number) {
  return `${programId}-${sheetCode}-a-${String(activityNumber).padStart(3, "0")}`
}

export function pdtpExecutionId(activityId: string, worksiteId: string, year: number, month: number, week: number) {
  return `${activityId}-e-${worksiteId}-${year}-${String(month).padStart(2, "0")}-${week}`
}

export async function getPdtpProgramActivityCount(programId: string): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pdtpActivities)
    .where(eq(pdtpActivities.programId, programId))
  return result?.count ?? 0
}

export async function addPdtpChangeLogEntry(
  programId: string, version: number, userId: string | null,
  section: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, note: string,
  dbOrTx: Tx | typeof db = db,
) {
  const now = new Date().toISOString()
  await dbOrTx.insert(pdtpChangeLog).values({
    id: nanoid(), programId, version, changedByUserId: userId,
    changedAt: now, section, before, after, note,
  })
}

export async function loadProgramScheduleAndExecutions(activityIds: string[], year: number, worksiteId?: string) {
  const [scheduleRows, executionRows, overrideRows, exclusionRows, activityRows] = await Promise.all([
    db.select().from(pdtpActivitySchedule).where(and(
      inArray(pdtpActivitySchedule.activityId, activityIds),
      eq(pdtpActivitySchedule.year, year),
    )),
    worksiteId
      ? db.select().from(pdtpExecutions).where(and(inArray(pdtpExecutions.activityId, activityIds), eq(pdtpExecutions.worksiteId, worksiteId), eq(pdtpExecutions.year, year), isNull(pdtpExecutions.obligationId)))
      : Promise.resolve([] as Array<typeof pdtpExecutions.$inferSelect>),
    worksiteId
      ? loadPdtpOverrides(activityIds, year, worksiteId)
      : Promise.resolve([] as Awaited<ReturnType<typeof loadPdtpOverrides>>),
    worksiteId
      ? db.select({ activityId: pdtpActivityWorksiteExclusions.activityId }).from(pdtpActivityWorksiteExclusions)
          .where(and(inArray(pdtpActivityWorksiteExclusions.activityId, activityIds), eq(pdtpActivityWorksiteExclusions.worksiteId, worksiteId)))
      : Promise.resolve([] as Array<{ activityId: string }>),
    db.select({
      id: pdtpActivities.id,
      status: pdtpActivities.status,
      retiredEffectiveFrom: pdtpActivities.retiredEffectiveFrom,
    }).from(pdtpActivities).where(inArray(pdtpActivities.id, activityIds)),
  ])
  // Aplicabilidad por faena (regla R4): una actividad excluida de la faena
  // (p. ej. CPHS en faenas con <25 trabajadores) no aporta al denominador ni al
  // ejecutado de esa faena. Antes las exclusiones se firmaban (content-digest)
  // pero no se aplicaban al cómputo.
  const excluded = new Set(exclusionRows.map((row) => row.activityId))
  const retirementByActivity = new Map(activityRows.map((row) => [row.id, row]))
  const withoutExcluded = <T extends { activityId: string }>(rows: T[]) =>
    excluded.size === 0 ? rows : rows.filter((row) => !excluded.has(row.activityId))
  const effectiveForPeriod = <
    T extends { activityId: string; year: number; month: number; week: number },
  >(rows: T[]) => rows.filter((row) => {
    const activity = retirementByActivity.get(row.activityId)
    return activity
      ? isPdtpActivityEffectiveForPeriod(activity, row.year, row.month, row.week)
      : false
  })
  const effectiveSchedule = worksiteId
    ? withoutExcluded(applyOverridesToSchedule(scheduleRows, overrideRows))
    : scheduleRows
  return {
    scheduleRows: effectiveForPeriod(effectiveSchedule),
    executionRows: effectiveForPeriod(withoutExcluded(executionRows)),
  }
}

/**
 * Schedule efectivo y ejecuciones **aprobadas** de un programa sobre varias
 * faenas, resueltas faena por faena para que overrides y exclusiones (R4) se
 * apliquen con el contexto de cada una — omitir la faena devuelve cero
 * ejecuciones (UX-01), así que agregar no es lo mismo que consultar sin filtro.
 *
 * Devuelve las filas crudas: quien llama decide cómo agruparlas. Los indicadores
 * formales solo cuentan ejecuciones aprobadas.
 */
export async function loadApprovedExecutionsForWorksites(
  activityIds: string[],
  year: number,
  worksiteIds: string[],
) {
  if (activityIds.length === 0 || worksiteIds.length === 0) {
    return { scheduleRows: [], executionRows: [] } as {
      scheduleRows: Awaited<ReturnType<typeof loadProgramScheduleAndExecutions>>["scheduleRows"]
      executionRows: Awaited<ReturnType<typeof loadProgramScheduleAndExecutions>>["executionRows"]
    }
  }
  const perWorksite = await Promise.all(
    worksiteIds.map((worksiteId) => loadProgramScheduleAndExecutions(activityIds, year, worksiteId)),
  )
  return {
    scheduleRows: perWorksite.flatMap((entry) => entry.scheduleRows),
    executionRows: perWorksite.flatMap((entry) => entry.executionRows.filter((row) => row.status === "approved")),
  }
}
