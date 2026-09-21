import { and, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpActivitySchedule,
  pdtpActivityWorksiteExclusions,
  pdtpChangeLog,
  pdtpExecutions,
  pdtpProgramWorksites,
  pdtpPrograms,
  pdtpSheets,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { applyOverridesToSchedule, loadPdtpOverrides } from "./overrides"
import { applyDeviationsToSchedule, loadPdtpDeviations } from "./deviations"
import { isPdtpActivityEffectiveForPeriod } from "./retirement"
import { effectiveActivationFor, filterPdtpRowsFromActivation } from "./period"
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
export async function resolveSheetForProgram(programId: string, sheetCode: string, client: DB | Tx = db) {
  const [sheet] = await client.select().from(pdtpSheets)
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

/**
 * Clave de exclusión mutua de una celda PDTP (actividad × faena ×
 * año/mes/semana). `markPdtpExecution` (executions.ts) y
 * `recordPdtpDeviation` (deviations.ts) toman el mismo
 * `pg_advisory_xact_lock(hashtext(...))` con esta clave antes de leer lo que
 * el otro escribe: sin un objeto común que ambas transacciones bloqueen, las
 * dos lecturas son fantasmas (la fila que buscan todavía no existe) y ambas
 * operaciones pueden pasar, dejando la celda con ejecución aprobada Y desvío
 * activo — justo lo que la exclusión mutua promete impedir.
 */
export function pdtpCellLockKey(
  activityId: string, worksiteId: string, year: number, month: number, week: number,
): string {
  return `pdtp-cell:${activityId}:${worksiteId}:${year}:${month}:${week}`
}

/**
 * Cuándo esta faena entró al programa. Es la mitad por faena del corte de
 * exigibilidad; la otra mitad es la activación del programa, y quien las une es
 * `effectiveActivationFor`.
 *
 * `null` cuando la faena no tiene fila de membresía, que es el caso de los
 * programas con `appliesToAllWorksites`: ahí no hay fecha de incorporación
 * porque nunca hubo incorporación, y el corte queda siendo el del programa.
 */
export async function loadWorksiteAddedAt(
  programId: string, worksiteId: string, client: DB | Tx = db,
): Promise<string | null> {
  const [row] = await client.select({ addedAt: pdtpProgramWorksites.addedAt })
    .from(pdtpProgramWorksites)
    .where(and(
      eq(pdtpProgramWorksites.programId, programId),
      eq(pdtpProgramWorksites.worksiteId, worksiteId),
    ))
    .limit(1)
  return row?.addedAt ?? null
}

export async function loadProgramScheduleAndExecutions(activityIds: string[], year: number, worksiteId?: string) {
  const [scheduleRows, executionRows, overrideRows, exclusionRows, activityRows, deviationRows] = await Promise.all([
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
    worksiteId
      ? loadPdtpDeviations(activityIds, year, worksiteId)
      : Promise.resolve([] as Awaited<ReturnType<typeof loadPdtpDeviations>>),
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
  const isCellEffective = (activityId: string, month: number, week: number) => {
    const activity = retirementByActivity.get(activityId)
    return activity ? isPdtpActivityEffectiveForPeriod(activity, year, month, week) : false
  }
  // Costura única: los desvíos por celda (not_applicable/reprogrammed/
  // not_performed) se aplican acá, después de overrides y exclusiones, y
  // sólo cuando hay `worksiteId` — la misma condición que habilita esas dos
  // transformaciones.
  //
  // La vigencia por retiro se filtra en DOS pasadas, una a cada lado de los
  // desvíos, porque cada lado responde a una pregunta distinta:
  //
  // 1. ANTES: el ORIGEN. Una celda ya nula por retiro no puede prestar su
  //    planificado: sin esta pasada, un `reprogrammed` con origen en un
  //    período retirado trasladaba planificado fantasma a un período vigente
  //    e inflaba el denominador con trabajo que ya no se exige.
  // 2. DESPUÉS: el DESTINO y el resto del set. Una celda destino creada por
  //    un desvío se evalúa como cualquier otra. `applyDeviationsToSchedule`
  //    recibe además `isCellEffective` para no consumir el origen cuando el
  //    destino no es vigente (ver su JSDoc: el planificado se conserva en el
  //    origen en vez de evaporarse).
  const effectiveSchedule = worksiteId
    ? applyDeviationsToSchedule(
        effectiveForPeriod(withoutExcluded(applyOverridesToSchedule(scheduleRows, overrideRows))),
        deviationRows,
        isCellEffective,
      )
    : scheduleRows
  return {
    scheduleRows: effectiveForPeriod(effectiveSchedule),
    executionRows: effectiveForPeriod(withoutExcluded(executionRows)),
    // Mismo tratamiento que las otras dos colecciones: un desvío de una
    // actividad excluida en la faena, o de un período ya retirado, describe
    // una celda que el cómputo descartó — mostrarlo (Task 3.3, UI) sería
    // contradecir lo que el propio indicador calcula.
    deviationRows: effectiveForPeriod(withoutExcluded(deviationRows)),
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
  /**
   * Cuando viene, el corte de exigibilidad se aplica **por faena** acá adentro.
   * Tiene que ser acá y no en el llamador: este resultado aplana las faenas y
   * `scheduleRows` no lleva `worksiteId`, así que después de aplanar ya no se
   * puede saber a qué corte someter cada fila.
   */
  activation?: { programId: string; activatedAt: string | null },
) {
  if (activityIds.length === 0 || worksiteIds.length === 0) {
    return { scheduleRows: [], executionRows: [] } as {
      scheduleRows: Awaited<ReturnType<typeof loadProgramScheduleAndExecutions>>["scheduleRows"]
      executionRows: Awaited<ReturnType<typeof loadProgramScheduleAndExecutions>>["executionRows"]
    }
  }
  const perWorksite = await Promise.all(
    worksiteIds.map(async (worksiteId) => {
      const entry = await loadProgramScheduleAndExecutions(activityIds, year, worksiteId)
      if (!activation) return entry
      const cutoff = effectiveActivationFor(
        activation.activatedAt,
        await loadWorksiteAddedAt(activation.programId, worksiteId),
      )
      return {
        ...entry,
        scheduleRows: filterPdtpRowsFromActivation(entry.scheduleRows, cutoff),
        executionRows: filterPdtpRowsFromActivation(entry.executionRows, cutoff),
      }
    }),
  )
  return {
    scheduleRows: perWorksite.flatMap((entry) => entry.scheduleRows),
    executionRows: perWorksite.flatMap((entry) => entry.executionRows.filter((row) => row.status === "approved")),
  }
}
