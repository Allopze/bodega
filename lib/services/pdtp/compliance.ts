import { and, eq, inArray, ne } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivityWorksiteExclusions,
  pdtpActivityWorksiteParams,
  pdtpExecutions,
  pdtpObligations,
  pdtpProgramWorksites,
  pdtpPrograms,
  pdtpScheduledInstances,
  preventionCapaActions,
  preventionInspectionFindings,
  preventionInspectionRuns,
} from "@/db/schema"
import { PDTP_ESTADOS_CERRADOS } from "./checklist-domain"
import { capaEstado } from "./capa-view"
import {
  loadApprovedExecutionsForWorksites,
  loadProgramScheduleAndExecutions,
  loadProgramScheduleAndExecutionsForWorksites,
  loadWorksiteAddedAtMap,
  type PdtpLoadedScheduleAndExecutions,
} from "./helpers"
import { isFlowSubjectSource, loadPdtpSubjectRosterBatch, type PdtpSubjectRosterBatch } from "./subject-registry"
import { effectiveActivationFor, filterPdtpRowsFromActivation, pdtpPeriodFromChileDate, type PdtpPeriod } from "./period"
import {
  describePdtpVersionWindow,
  filterPdtpRowsBeforeSuccessor,
  isPdtpMonthBeforeSuccessor,
  type PdtpVersionWindow,
} from "./version-window"
import { PDTP_ANNUAL_MINIMUM_MONTH, pdtpAnnualMinimumFloor } from "./annual-minimum"
import {
  loadPdtpIndicatorActivitiesForRequest,
  loadPdtpProgramForRequest,
  loadPdtpProgramForYearForRequest,
  loadPdtpVersionWindowForRequest,
  loadPdtpYearVersionWindowsForRequest,
  type PdtpIndicatorActivity,
} from "./request-cache"
import { isPdtpActivityEffectiveForPeriod } from "./retirement"
import { chileDateParts } from "@/lib/utils"
import { pdtpScheduledInstanceCountsAsExecuted } from "./scheduled-compliance"

export type PdtpComplianceMonth = {
  month: number
  planned: number
  executed: number
  /** Fracción 0-1 (no 0-100): se compara directo contra `complianceTarget`,
   * que también es fracción. Distinto de `PdtpSheetView.monthlyTotals[].percent`
   * (entero 0-100) — no mezclar los dos sin convertir. */
  percent: number | null
  /**
   * Cuántas actividades del "resto" (ni `coverage` ni `closed_on_time`)
   * tuvieron planificación este mes (`p > 0`) y ninguna ejecución aprobada
   * (`rawExecuted === 0`). No cambia `percent` ni `executed`: desde PREV-C02
   * cada actividad topa a su plan del mes (ver el bucle mensual), así que una
   * actividad en cero ya baja el %; esto nombra cuáles fueron. `coverage` y `closed_on_time` no
   * cuentan aquí: son todo-o-nada por su propia regla y un cero ahí significa
   * "no se acreditó el padrón/plazo", no "no se hizo nada".
   */
  zeroActivities: number
  /**
   * Ids de las actividades que componen `zeroActivities` este mes. La UI no
   * enlaza por id (el visor de actividades filtra por mes + estado
   * `en_cero`, ver `isPdtpActivityZeroThisMonth` en `period.ts`): este campo
   * existe para que `getPdtpComplianceIndicatorsForScope` pueda **deduplicar**
   * la unión entre faenas — una actividad en cero en dos faenas es una sola
   * actividad en cero para el agregado (ver comentario ahí) — sin volver a
   * consultar cuáles son.
   */
  zeroActivityIds: string[]
  /**
   * Cuántas celdas (actividad × semana) de este mes tienen un desvío "no
   * realizada" activo declarado en la faena. **No cambia nada del cálculo**:
   * un `not_performed` deja el planificado intacto a propósito y la actividad
   * sigue contando en `zeroActivities`. Existe para poder decir, junto al
   * porcentaje, cuánto de lo que quedó en cero tiene un motivo registrado y
   * cuánto es silencio — que es una diferencia de gestión, no de fórmula.
   *
   * `not_applicable` y `reprogrammed` no se cuentan acá: ésos sí transforman
   * el planificado y ya están reflejados en `planned` gracias a la costura
   * única (`loadProgramScheduleAndExecutions`). Contarlos además sería
   * mostrar dos veces el mismo ajuste.
   */
  declaredNotPerformed: number
}

export type PdtpComplianceIndicators = {
  programId: string
  year: number
  target: number
  monthly: PdtpComplianceMonth[]
  quarterly: Array<{ quarter: number; planned: number; executed: number; percent: number | null }>
  annual: {
    planned: number
    executed: number
    percent: number | null
    /** Meses del año con al menos una actividad en cero (`PdtpComplianceMonth.zeroActivities > 0`). */
    zeroActivityMonths: number
    /** Unión de `zeroActivityIds` de los 12 meses, sin duplicar: una actividad
     * que quedó en cero en más de un mes cuenta una sola vez en este listado
     * anual (es un listado de actividades, no de eventos mes-actividad). */
    zeroActivityIds: string[]
  }
  /** Cumplimiento a la fecha: plan y ejecutado hasta `throughMonth` (PREV-I15). */
  toDate: { throughMonth: number; planned: number; executed: number; percent: number | null }
  /** Última `updatedAt` entre las ejecuciones aprobadas que componen el
   * indicador, o `null` si no hay ninguna todavía. No es la hora del
   * cálculo (eso es "corte", ver `asOf` en el caller) sino de los datos. */
  lastExecutionUpdatedAt: string | null
  /** Fuentes automáticas declaradas pero todavía sin una nómina utilizable.
   *  Se exponen para que la vista no confunda "sin clasificar" con "no aplica". */
  subjectRosterIssues: Array<{
    activityId: string
    worksiteId: string
    source: "trabajadores_capacidad"
    status: "pending_classification" | "not_configured"
    capabilityCodes: string[]
    explanation: string
  }>
}

type ApprovedExecution = Awaited<ReturnType<typeof loadProgramScheduleAndExecutions>>["executionRows"][number]

/**
 * Denominador y numerador de `closed_on_time` por actividad-mes: cuántas
 * obligaciones vencían ese mes (según `dueAt`) y cuántas de ésas se cerraron
 * dentro de plazo. `completed` es el único estado que cuenta como cierre —
 * `reported` es un cumplimiento todavía sin aprobar, igual que una ejecución
 * `submitted` no cuenta para el resto de los modos.
 *
 * Toma una lista de faenas, no una sola: la vista por faena pasa `[id]` y el
 * desglose por eje pasa el alcance completo, con la misma consulta y la misma
 * regla. Sin faenas no hay a qué obligaciones mirar y devuelve vacío, mismo
 * límite que el padrón derivado de `coverage`.
 *
 * `coverageActivityIds`: actividades de cobertura cuyas obligaciones pueden
 * sumar como caso propio. De ellas sólo cuentan las que su conector declara
 * así (`source_metadata_json.countsAsCoverageCase`): la entrega de un RIOHS
 * nuevo a la dotación (N°18) sí es un caso; una brecha de capacitación abierta
 * sobre la misma actividad no, porque su sujeto ya está en el padrón y contarla
 * sería exigirlo dos veces.
 *
 * `year`: el año del programa. Una obligación que vence fuera de ese año cuenta
 * en su mes límite —diciembre si vence después, enero si venció antes—
 * (PREV-M07). Antes una de diciembre que vencía en enero del año siguiente se
 * sumaba al enero del mismo programa. Tampoco se descarta: la obligación es de
 * una actividad de este programa (desde PREV-C03.6 nace en el programa del año
 * de su hecho) y el programa del año siguiente no la vería nunca.
 */
export const PDTP_COVERAGE_CASE_METADATA_KEY = "countsAsCoverageCase"

type ClosedOnTimeRow = {
  activityId: string
  worksiteId: string
  status: string
  dueAt: string | null
  reportedAt: string | null
  metadata: unknown
}

/**
 * Las obligaciones no canceladas de un conjunto de actividades en varias
 * faenas, en una sola consulta (I12). Quien las agrega por faena o por el
 * alcance completo usa `tallyClosedOnTime`, con la misma regla.
 */
async function loadClosedOnTimeRows(activityIds: string[], worksiteIds: readonly string[]): Promise<ClosedOnTimeRow[]> {
  if (worksiteIds.length === 0 || activityIds.length === 0) return []
  return db.select({
    activityId: pdtpObligations.activityId,
    worksiteId: pdtpObligations.worksiteId,
    status: pdtpObligations.status,
    dueAt: pdtpObligations.dueAt,
    reportedAt: pdtpObligations.reportedAt,
    metadata: pdtpObligations.sourceMetadataJson,
  }).from(pdtpObligations)
    .where(and(
      inArray(pdtpObligations.activityId, activityIds),
      inArray(pdtpObligations.worksiteId, [...new Set(worksiteIds)]),
      ne(pdtpObligations.status, "cancelled"),
    ))
}

function tallyClosedOnTime(rows: readonly ClosedOnTimeRow[], year: number, coverageActivityIds: ReadonlySet<string> = new Set()) {
  const planned = new Map<string, number>()
  const executed = new Map<string, number>()
  /** Cierres `completed` por actividad en el año, a tiempo o no y tengan o no
   * `dueAt`: es lo "realizado" contra lo que se acredita el piso anual. */
  const completedByActivity = new Map<string, number>()
  for (const row of rows) {
    if (coverageActivityIds.has(row.activityId)
      && (row.metadata as Record<string, unknown> | null)?.[PDTP_COVERAGE_CASE_METADATA_KEY] !== true) continue
    const dueParts = row.dueAt ? chileDateParts(row.dueAt) : null
    const due = dueParts && {
      month: dueParts.year > year ? 12 : dueParts.year < year ? 1 : dueParts.month,
    }
    if (row.status === "completed") completedByActivity.set(row.activityId, (completedByActivity.get(row.activityId) ?? 0) + 1)
    if (!due) continue // sin plazo no hay mes al que asignarla.
    const key = `${row.activityId}:${due.month}`
    planned.set(key, (planned.get(key) ?? 0) + 1)
    const onTime = row.status === "completed" && (!!row.reportedAt && !!row.dueAt && row.reportedAt <= row.dueAt)
    if (onTime) executed.set(key, (executed.get(key) ?? 0) + 1)
  }
  return { planned, executed, completedByActivity }
}

function groupRowsByWorksite<T extends { worksiteId: string }>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const list = grouped.get(row.worksiteId)
    if (list) list.push(row)
    else grouped.set(row.worksiteId, [row])
  }
  return grouped
}

/**
 * Lo ejecutado de cada celda semanal, sin contar dos veces el mismo trabajo
 * (PREV-C02, auditoría 2026-09-26). La carga manual/XLS y lo que acreditan los
 * submódulos pueden describir la misma semana: se toma el **mayor** entre la
 * carga manual y la suma de las acreditaciones. Antes sólo las inspecciones se
 * deduplicaban y el resto se sumaba a la carga manual, así que registrar a mano
 * una semana ya acreditada contaba doble. Las acreditaciones entre sí siguen
 * sumando: son hechos distintos (dos inspecciones, un acta y una capacitación).
 * Quien necesita declarar un total mayor lo hace en la carga manual, con su
 * evidencia.
 *
 * Exportada (tarea 1.5, RE-36) para que el documento cuente `E` con la misma
 * regla de deduplicación que este indicador.
 *
 * El objeto devuelto **pierde `worksiteId` y `year`** (la deduplicación sí los
 * usa como parte de la clave por celda, pero no viajan en el resultado). Por lo
 * tanto, sólo debe invocarse con filas ya acotadas a **una** faena y **un**
 * año: con filas mezcladas, dos celdas distintas colisionarían al reagrupar.
 */
export function effectiveApprovedExecutionsByCell(
  rows: Array<Pick<ApprovedExecution, "activityId" | "worksiteId" | "year" | "month" | "week" | "origin" | "executedQuantity"> & {
    linkedInstance?: PdtpLinkedScheduledInstance | null
  }>,
  options: PdtpExecutionCellOptions = {},
) {
  const cells = new Map<string, {
    activityId: string
    month: number
    week: number
    manualQuantity: number
    integrationQuantity: number
    representedQuantity: number
  }>()
  const cellFor = (row: { activityId: string; worksiteId: string; year: number }, month: number, week: number) => {
    const key = `${row.activityId}:${row.worksiteId}:${row.year}:${month}:${week}`
    const cell = cells.get(key) ?? {
      activityId: row.activityId, month, week, manualQuantity: 0, integrationQuantity: 0, representedQuantity: 0,
    }
    cells.set(key, cell)
    return cell
  }
  const instanceCells: Array<{ row: { activityId: string; worksiteId: string; year: number }; instance: PdtpLinkedScheduledInstance }> = []
  for (const row of rows) {
    const cell = cellFor(row, row.month, row.week)
    if (row.origin === "integration") cell.integrationQuantity += row.executedQuantity
    else cell.manualQuantity += row.executedQuantity
    if (pdtpExecutionRepresentedByScheduledInstance(row, options.instanceCutoff)) {
      cell.representedQuantity += row.executedQuantity
      if (options.instanceCells) instanceCells.push({ row, instance: row.linkedInstance! })
    }
  }
  // PREV-I08-a: la parte de la celda que es el hecho de una ocurrencia se
  // descuenta después de deduplicar, así una carga manual de la misma semana
  // (el mismo hecho, D2) queda absorbida y lo que declare por encima sigue
  // contando.
  const result = [...cells.values()].map((cell) => ({
    activityId: cell.activityId,
    month: cell.month,
    week: cell.week,
    executedQuantity: Math.max(0, Math.max(cell.manualQuantity, cell.integrationQuantity) - cell.representedQuantity),
  }))
  for (const { row, instance } of instanceCells) {
    const slot = pdtpPeriodFromChileDate(instance.scheduledFor)
    if (!slot) continue
    result.push({ activityId: row.activityId, month: slot.month, week: slot.week, executedQuantity: Number(instance.plannedQuantity) || 0 })
  }
  return result
}

/**
 * Lo mínimo de una ocurrencia programada enlazada a una ejecución del libro
 * (`pdtp_executions.scheduled_instance_id`). Lo adjunta
 * `loadProgramScheduleAndExecutions` a cada ejecución enlazada.
 */
export type PdtpLinkedScheduledInstance = {
  id: string
  status: string
  scheduledFor: string
  plannedQuantity: number | string
}

export type PdtpExecutionCellOptions = {
  /**
   * Corte de exigibilidad de la vista (el mismo que pasa a
   * `filterPdtpRowsFromActivation`). Una ocurrencia anterior no cuenta en el
   * indicador, así que su ejecución tampoco se descuenta.
   */
  instanceCutoff?: string | null
  /**
   * Para las vistas que no representan ocurrencias (eje, reporte de gestión,
   * planilla): el hecho descontado de su celda se suma en la celda de su
   * ocurrencia, con la cantidad planificada de la ocurrencia, que es donde lo
   * cuenta el indicador. Sin esto la vista lo perdería. El indicador y el
   * RE-36 (que tiene su hoja de calendario de ocurrencias) no lo piden: allí
   * la ocurrencia ya cuenta por su cuenta.
   */
  instanceCells?: boolean
}

/**
 * Aplica de antemano el corte de exigibilidad de las ocurrencias a filas que
 * luego se mezclan entre faenas (planilla agregada): la ocurrencia anterior al
 * corte de su faena deja de representar a su ejecución, que vuelve a contar
 * por el libro, igual que en el indicador de esa faena.
 */
export function pdtpApplyScheduledInstanceCutoff<T extends { scheduledInstanceId?: string | null; linkedInstance?: PdtpLinkedScheduledInstance | null }>(
  rows: T[],
  instanceCutoff: string | null,
): T[] {
  if (!instanceCutoff) return rows
  return rows.map((row) => row.linkedInstance && row.linkedInstance.scheduledFor < instanceCutoff.slice(0, 10)
    ? { ...row, linkedInstance: null }
    : row)
}

/**
 * PREV-I08-a, regla única de "un hecho, un conteo". Una ejecución aprobada
 * enlazada a una ocurrencia que cuenta (completada, D19, y exigible según el
 * corte de la vista) es el hecho de esa ocurrencia: no suma además en su celda
 * del libro. La comparten el indicador, el eje, el reporte de gestión, la
 * planilla, el RE-36 y los objetivos del cierre a través de
 * `effectiveApprovedExecutionsByCell`.
 */
export function pdtpExecutionRepresentedByScheduledInstance(
  row: { linkedInstance?: PdtpLinkedScheduledInstance | null },
  instanceCutoff?: string | null,
): boolean {
  const instance = row.linkedInstance
  if (!instance) return false
  // La fila que llega acá ya está aprobada: por eso basta el estado de la ocurrencia.
  if (!pdtpScheduledInstanceCountsAsExecuted(instance.status)) return false
  return !instanceCutoff || instance.scheduledFor >= instanceCutoff.slice(0, 10)
}

/**
 * Lo que una actividad aporta al cumplimiento de un mes (PREV-C02, decisión
 * 2026-09-26 que reemplaza la "respuesta 2.4"): como máximo lo planificado de
 * esa actividad en ese mes, y nada si no tenía plan. Una actividad
 * sobreejecutada ya no compensa a otra que quedó en cero. Es la regla que
 * comparten el indicador, el avance por eje, el reporte de gestión, los
 * objetivos del cierre y la planilla.
 */
export function pdtpCountedExecuted(planned: number, executed: number): number {
  return planned > 0 ? Math.min(executed, planned) : 0
}

/**
 * El indicador tal como estaba al cierre del mes `cutoffMonth` (W1-N02): los
 * meses posteriores quedan en cero, trimestres y año se recalculan sobre ese
 * recorte y `toDate` se mide contra el corte. `lastExecutionUpdatedAt` se
 * descarta porque es el máximo de todo el año y no se puede recortar sin las
 * filas. Así la foto de un cierre no cambia porque se opere un mes posterior.
 * Conserva los doce meses para no cambiar la forma de `PdtpComplianceIndicators`.
 */
export function cutPdtpComplianceIndicatorsToMonth(
  indicators: PdtpComplianceIndicators,
  cutoffMonth: number,
): PdtpComplianceIndicators {
  const monthly = indicators.monthly.map((month) => month.month <= cutoffMonth
    ? month
    : { ...month, planned: 0, executed: 0, percent: null, zeroActivities: 0, zeroActivityIds: [], declaredNotPerformed: 0 })
  const quarterly = indicators.quarterly.map((quarter) => {
    const months = monthly.slice((quarter.quarter - 1) * 3, quarter.quarter * 3)
    const planned = months.reduce((sum, month) => sum + month.planned, 0)
    const executed = months.reduce((sum, month) => sum + month.executed, 0)
    return { ...quarter, planned, executed, percent: planned > 0 ? Math.round((executed / planned) * 100) / 100 : null }
  })
  const annualPlanned = monthly.reduce((sum, month) => sum + month.planned, 0)
  const annualExecuted = monthly.reduce((sum, month) => sum + month.executed, 0)
  return {
    ...indicators,
    monthly,
    quarterly,
    annual: {
      ...indicators.annual,
      planned: annualPlanned,
      executed: annualExecuted,
      percent: annualPlanned > 0 ? Math.round((annualExecuted / annualPlanned) * 100) / 100 : null,
      zeroActivityMonths: monthly.filter((month) => month.zeroActivities > 0).length,
      zeroActivityIds: [...new Set(monthly.flatMap((month) => month.zeroActivityIds))],
    },
    toDate: pdtpComplianceToDate(monthly, indicators.year, { year: indicators.year, month: cutoffMonth }),
    lastExecutionUpdatedAt: null,
  }
}

/**
 * Cumplimiento a la fecha (PREV-I15, auditoría 2026-09-26): lo planificado
 * hasta el mes en curso contra lo ejecutado en esos mismos meses. El "anual"
 * mide avance contra el plan de todo el año —a mitad de año siempre está bajo
 * la meta aunque todo lo exigible esté hecho—; esta cifra responde "¿vamos al
 * día?". Un año pasado cuenta sus doce meses; uno futuro, ninguno.
 */
export function pdtpComplianceToDate(
  monthly: Array<{ month: number; planned: number; executed: number }>,
  year: number,
  today: { year: number; month: number } = chileDateParts(),
): { throughMonth: number; planned: number; executed: number; percent: number | null } {
  const throughMonth = year < today.year ? 12 : year > today.year ? 0 : today.month
  const months = monthly.filter((entry) => entry.month <= throughMonth)
  const planned = months.reduce((sum, entry) => sum + entry.planned, 0)
  const executed = months.reduce((sum, entry) => sum + entry.executed, 0)
  return { throughMonth, planned, executed, percent: planned > 0 ? Math.round((executed / planned) * 100) / 100 : null }
}

type PdtpIndicatorProgram = typeof pdtpPrograms.$inferSelect

/**
 * Lo que una versión aporta al indicador de una faena, ya recortado a su
 * ventana y agrupado por actividad y mes. Es la entrada de
 * `computePdtpIndicatorsFromInputs`: con una sola versión el cálculo es el de
 * siempre; con varias (C05-C) se suman por actividad de catálogo.
 */
type PdtpIndicatorInputs = {
  program: PdtpIndicatorProgram
  /** Primer período de la sucesora (exclusivo), o `null` si nadie la reemplazó. */
  until: PdtpPeriod | null
  activityRows: PdtpIndicatorActivity[]
  plannedByActivityMonth: Map<string, number>
  executedByActivityMonth: Map<string, number>
  declaredNotPerformedByMonth: number[]
  expectedByActivity: Map<string, number>
  coverageTargetPctByActivity: Map<string, number>
  derivedStockByActivity: Map<string, number>
  derivedFlowByActivityMonth: Map<string, number>
  subjectRosterIssues: PdtpComplianceIndicators["subjectRosterIssues"]
  closedOnTimePlanned: Map<string, number>
  closedOnTimeExecuted: Map<string, number>
  closedOnTimeCompleted: Map<string, number>
  /** Actividades con piso anual excluidas en la faena (se leía aparte al calcular). */
  minimumExcludedActivityIds: ReadonlySet<string>
  lastExecutionUpdatedAt: string | null
  approvedExecutionIds: string[]
}

/* I12: las lecturas base (programa, ventana, actividades) salen de
 * `request-cache.ts`, deduplicadas por request con `React.cache`. */
const loadIndicatorProgramById = loadPdtpProgramForRequest
const loadIndicatorProgramForYear = loadPdtpProgramForYearForRequest
const loadIndicatorVersionWindow = loadPdtpVersionWindowForRequest
const loadIndicatorYearWindows = loadPdtpYearVersionWindowsForRequest
const loadIndicatorActivities = loadPdtpIndicatorActivitiesForRequest

async function resolveIndicatorProgram(yearOrProgramId: number | string): Promise<PdtpIndicatorProgram | null> {
  return typeof yearOrProgramId === "string"
    ? loadIndicatorProgramById(yearOrProgramId)
    : loadIndicatorProgramForYear(yearOrProgramId)
}

function emptyPdtpComplianceIndicators(program: PdtpIndicatorProgram): PdtpComplianceIndicators {
  return {
    programId: program.id, year: program.year, target: program.complianceTarget,
    monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, planned: 0, executed: 0, percent: null, zeroActivities: 0, zeroActivityIds: [], declaredNotPerformed: 0 })),
    quarterly: Array.from({ length: 4 }, (_, i) => ({ quarter: i + 1, planned: 0, executed: 0, percent: null })),
    annual: { planned: 0, executed: 0, percent: null, zeroActivityMonths: 0, zeroActivityIds: [] },
    toDate: pdtpComplianceToDate([], program.year),
    lastExecutionUpdatedAt: null,
    subjectRosterIssues: [],
  }
}

/**
 * Faena de la que se calcula el indicador; `undefined` es la vista
 * consolidada sin faena (sin ejecuciones: ver UX-01 en
 * `getPdtpComplianceIndicatorsForScope`).
 */
type PdtpIndicatorTarget = string | undefined

export async function getPdtpComplianceIndicators(yearOrProgramId: number | string, worksiteId?: string): Promise<PdtpComplianceIndicators | null> {
  const program = await resolveIndicatorProgram(yearOrProgramId)
  if (!program) return null
  // PREV-C05-B: una versión reemplazada se mide sólo en su ventana. Sin
  // sucesora `until` es `null` y el cálculo es exactamente el de siempre.
  const inputs = (await loadPdtpIndicatorInputsForTargets(program, [worksiteId], await loadIndicatorVersionWindow(program.id))).get(worksiteId) ?? null
  if (!inputs) return emptyPdtpComplianceIndicators(program)
  return computePdtpIndicatorsFromInputs(program, worksiteId, [inputs])
}

/** Una versión del año, tal como se rotula junto al indicador consolidado. */
export type PdtpComplianceVersion = {
  programId: string
  version: number
  status: string
  activatedAt: string | null
  from: PdtpPeriod | null
  until: PdtpPeriod | null
  label: string
}

export type PdtpYearComplianceIndicators = PdtpComplianceIndicators & {
  /** Versiones que componen el año, en orden de vigencia. Una sola = sin revisión. */
  versions: PdtpComplianceVersion[]
}

function toComplianceVersion(window: PdtpVersionWindow & { status: string }): PdtpComplianceVersion {
  return {
    programId: window.programId,
    version: window.version,
    status: window.status,
    activatedAt: window.activatedAt,
    from: window.from,
    until: window.until,
    label: describePdtpVersionWindow(window),
  }
}

/**
 * PREV-C05-C (T6): el cumplimiento del **año**, consolidado entre versiones.
 * Una revisión v+1 activada en noviembre dejaba el "anual" del tablero en
 * noviembre y diciembre: la v2 corta en su activación y la v1 dejaba de
 * mirarse. Acá cada versión aporta lo de su ventana (en cada faena, desde su
 * propio corte por incorporación) y las actividades se juntan por identidad de
 * catálogo (`catalogActivityId`, con caída al número): el tope por actividad y
 * mes y el listado de actividades en cero se aplican una vez sobre la unión.
 *
 * Con una sola versión el resultado es **idéntico** a
 * `getPdtpComplianceIndicators` (lo fija una prueba): es el mismo cálculo con
 * una sola entrada.
 */
export async function getPdtpYearComplianceIndicators(
  yearOrProgramId: number | string,
  worksiteId?: string,
): Promise<PdtpYearComplianceIndicators | null> {
  const focus = await resolveIndicatorProgram(yearOrProgramId)
  if (!focus) return null
  const { versions, byTarget } = await computeYearIndicatorsForTargets(focus, [worksiteId])
  return { ...byTarget.get(worksiteId)!, versions }
}

/**
 * El año consolidado de varias faenas a la vez (I12): las entradas de cada
 * versión se cargan una vez para todas las faenas que la operan, y el cálculo
 * sigue siendo por faena. Antes cada faena repetía programa, ventanas,
 * membresías y entradas.
 */
async function computeYearIndicatorsForTargets(
  focus: PdtpIndicatorProgram,
  targets: readonly PdtpIndicatorTarget[],
): Promise<{ versions: PdtpComplianceVersion[]; byTarget: Map<PdtpIndicatorTarget, PdtpComplianceIndicators> }> {
  const byTarget = new Map<PdtpIndicatorTarget, PdtpComplianceIndicators>()
  const chain = (await loadIndicatorYearWindows(focus.year)).filter((window) => window.status !== "archived")
  if (chain.length <= 1 || !chain.some((window) => window.programId === focus.id)) {
    const inputs = await loadPdtpIndicatorInputsForTargets(focus, targets, await loadIndicatorVersionWindow(focus.id))
    for (const target of targets) {
      const own = inputs.get(target) ?? null
      byTarget.set(target, own ? computePdtpIndicatorsFromInputs(focus, target, [own]) : emptyPdtpComplianceIndicators(focus))
    }
    const own = chain.find((window) => window.programId === focus.id)
    return { versions: own ? [toComplianceVersion(own)] : [], byTarget }
  }
  const programs = await db.select().from(pdtpPrograms).where(inArray(pdtpPrograms.id, chain.map((window) => window.programId)))
  const programById = new Map(programs.map((program) => [program.id, program]))
  // Por versión, en orden de vigencia: qué faenas la operan y sus entradas.
  const perWindow = await Promise.all(chain.map(async (window) => {
    const program = programById.get(window.programId)
    if (!program) return null
    // Una faena que no opera esta versión no le aporta nada. La vista sin
    // faena no tiene membresía que mirar.
    const operates = await pdtpProgramWorksiteMembership(program)
    const included = targets.filter((target) => target === undefined || operates(target))
    return loadPdtpIndicatorInputsForTargets(program, included, window)
  }))
  const primary = programById.get(chain.at(-1)!.programId)!
  const versions = chain.map(toComplianceVersion)
  for (const target of targets) {
    const parts = perWindow
      .map((inputs) => inputs?.get(target) ?? null)
      .filter((inputs): inputs is PdtpIndicatorInputs => inputs !== null)
    byTarget.set(target, parts.length === 0 ? emptyPdtpComplianceIndicators(primary) : computePdtpIndicatorsFromInputs(primary, target, parts))
  }
  return { versions, byTarget }
}

/** ¿La faena opera esta versión? Mismo criterio que la membresía del programa. */
async function pdtpProgramWorksiteMembership(program: PdtpIndicatorProgram): Promise<(worksiteId: string) => boolean> {
  const members = await db.select({ worksiteId: pdtpProgramWorksites.worksiteId })
    .from(pdtpProgramWorksites)
    .where(and(eq(pdtpProgramWorksites.programId, program.id), eq(pdtpProgramWorksites.isActive, true)))
  if (members.length === 0) return () => program.appliesToAllWorksites
  const memberIds = new Set(members.map((member) => member.worksiteId))
  return (worksiteId) => memberIds.has(worksiteId)
}

/**
 * Las entradas del indicador de un programa para varias faenas (y/o la vista
 * sin faena), con un número de consultas que no depende de cuántas faenas son
 * (I12). Lo que se carga por lote —calendario y ejecuciones, incorporación,
 * ocurrencias, parámetros, padrón, obligaciones— se reparte por faena y cada
 * una se arma con `assemblePdtpIndicatorInputs`, que es el cálculo que antes
 * se hacía faena por faena.
 */
async function loadPdtpIndicatorInputsForTargets(
  program: PdtpIndicatorProgram,
  targets: readonly PdtpIndicatorTarget[],
  window: Pick<PdtpVersionWindow, "until" | "successor"> | null,
): Promise<Map<PdtpIndicatorTarget, PdtpIndicatorInputs | null>> {
  const result = new Map<PdtpIndicatorTarget, PdtpIndicatorInputs | null>()
  if (targets.length === 0) return result
  const year = program.year
  const activityRows = await loadIndicatorActivities(program.id)
  if (activityRows.length === 0) {
    for (const target of targets) result.set(target, null)
    return result
  }
  const worksiteIds = [...new Set(targets.filter((target): target is string => target !== undefined))]
  const withoutWorksite = targets.includes(undefined)
  const allActivityIds = activityRows.map((row) => row.id)
  // Las actividades nuevas no usan la grilla histórica de cuatro bloques. Sus
  // ocurrencias se leen como instancias independientes y se incorporan a los
  // mismos acumuladores mensuales que el resto, manteniendo intacta la
  // semántica de los programas firmados con grilla.
  const scheduledActivityIds = activityRows
    .filter((activity) => {
      const definition = activity.scheduleDefinition
      return definition && typeof definition === "object"
        && (definition as { kind?: unknown }).kind !== "legacy_grid"
    })
    .map((activity) => activity.id)
  // Las de cobertura también pueden tener casos: la N°18 se mide sobre los
  // trabajadores nuevos del mes, y además una versión nueva del RIOHS abre
  // por faena la obligación de entregarla a toda la dotación. Esa entrega es
  // un caso propio —a tiempo o no— y se suma con la regla de `closed_on_time`.
  // La ejecución que la cierra no infla el padrón: `loadProgramScheduleAndExecutions`
  // ya descarta las ejecuciones con `obligationId`.
  const closedOnTimeActivityIds = activityRows
    .filter((a) => a.indicatorMode === "closed_on_time" || a.indicatorMode === "coverage")
    .map((a) => a.id)
  const rosterActivities = activityRows.filter((a) => a.indicatorMode === "coverage" && a.subjectSource !== null)
  const minimumActivityIds = activityRows.filter((a) => (a.minAnnualExecutions ?? 0) > 0).map((a) => a.id)
  const instanceColumns = {
    id: pdtpScheduledInstances.id,
    activityId: pdtpScheduledInstances.activityId,
    worksiteId: pdtpScheduledInstances.worksiteId,
    scheduledFor: pdtpScheduledInstances.scheduledFor,
    plannedQuantity: pdtpScheduledInstances.plannedQuantity,
    status: pdtpScheduledInstances.status,
    completedAt: pdtpScheduledInstances.completedAt,
    updatedAt: pdtpScheduledInstances.updatedAt,
  }

  const [
    loadedByWorksite, consolidatedLoaded, addedAtByWorksite, worksiteInstances, consolidatedInstances,
    paramRows, rosters, closedOnTimeRows, minimumExclusions,
  ] = await Promise.all([
    loadProgramScheduleAndExecutionsForWorksites(allActivityIds, year, worksiteIds),
    withoutWorksite ? loadProgramScheduleAndExecutions(allActivityIds, year) : Promise.resolve(null),
    loadWorksiteAddedAtMap(program.id, worksiteIds),
    scheduledActivityIds.length > 0 && worksiteIds.length > 0
      ? db.select(instanceColumns).from(pdtpScheduledInstances).where(and(
          inArray(pdtpScheduledInstances.activityId, scheduledActivityIds),
          inArray(pdtpScheduledInstances.worksiteId, worksiteIds),
        ))
      : Promise.resolve([]),
    // Sin faena, las ocurrencias de todas las faenas (comportamiento histórico).
    scheduledActivityIds.length > 0 && withoutWorksite
      ? db.select(instanceColumns).from(pdtpScheduledInstances).where(inArray(pdtpScheduledInstances.activityId, scheduledActivityIds))
      : Promise.resolve([]),
    worksiteIds.length > 0
      ? db.select({
          activityId: pdtpActivityWorksiteParams.activityId,
          worksiteId: pdtpActivityWorksiteParams.worksiteId,
          expectedSubjectCount: pdtpActivityWorksiteParams.expectedSubjectCount,
          targetCoveragePercent: pdtpActivityWorksiteParams.targetCoveragePercent,
        })
          .from(pdtpActivityWorksiteParams)
          .where(and(inArray(pdtpActivityWorksiteParams.activityId, allActivityIds), inArray(pdtpActivityWorksiteParams.worksiteId, worksiteIds)))
      : Promise.resolve([]),
    // Padrón por lote: una consulta por fuente para todas las faenas (y la
    // de flujo, para los doce meses), en vez de una por actividad, faena y mes.
    rosterActivities.length > 0 && worksiteIds.length > 0
      ? loadPdtpSubjectRosterBatch(
          rosterActivities.map((activity) => ({ source: activity.subjectSource, capabilityCodes: activity.subjectCapabilityCodes })),
          worksiteIds,
          year,
        )
      : Promise.resolve(null),
    loadClosedOnTimeRows(closedOnTimeActivityIds, worksiteIds),
    minimumActivityIds.length > 0 && worksiteIds.length > 0
      ? db.select({ activityId: pdtpActivityWorksiteExclusions.activityId, worksiteId: pdtpActivityWorksiteExclusions.worksiteId })
          .from(pdtpActivityWorksiteExclusions)
          .where(and(
            inArray(pdtpActivityWorksiteExclusions.activityId, minimumActivityIds),
            inArray(pdtpActivityWorksiteExclusions.worksiteId, worksiteIds),
          ))
      : Promise.resolve([]),
  ])

  /* El corte de exigibilidad es por faena, no sólo por programa: una faena
   * incorporada en octubre no arrastra las casillas de marzo. Sin `worksiteId`
   * —vista consolidada— el corte sigue siendo el del programa, que es lo que
   * corresponde: no hay una faena de la cual hablar. */
  const cutoffFor = (target: PdtpIndicatorTarget) => target
    ? effectiveActivationFor(program.activatedAt, addedAtByWorksite.get(target) ?? null)
    : program.activatedAt
  const successorActivatedAt = window?.successor?.activatedAt ?? null
  const instancesByWorksite = groupRowsByWorksite(worksiteInstances)
  const eligibleInstancesFor = (target: PdtpIndicatorTarget) => {
    const activationCutoff = cutoffFor(target)
    return (target ? instancesByWorksite.get(target) ?? [] : consolidatedInstances).filter((instance) => {
      // PREV-C05-B: la ocurrencia desde el día de activación de la sucesora es
      // de la sucesora (mismo corte por día que usa su materialización).
      if (successorActivatedAt && instance.scheduledFor >= successorActivatedAt.slice(0, 10)) return false
      if (!activationCutoff) return true
      // Las instancias materializadas antes del día de activación no deben
      // inventar deuda en el indicador de una versión recién firmada. Con faena,
      // el corte incluye además su fecha de incorporación al programa.
      return instance.scheduledFor >= activationCutoff.slice(0, 10)
    })
  }
  const eligibleByTarget = new Map(targets.map((target) => [target, eligibleInstancesFor(target)]))
  // D19 (T3): una ocurrencia completada cuenta sólo si su ejecución enlazada
  // está aprobada. El estado de esa ejecución se lee aparte, sin filtro de
  // faena ni de exclusión: en la vista consolidada `executionRows` viene vacío
  // y el predicado quedaría sin saber del enlace. Una consulta para todas las
  // faenas.
  const completedInstanceIds = [...new Set([...eligibleByTarget.values()].flatMap((instances) => instances
    .filter((instance) => instance.status === "completed")
    .map((instance) => instance.id)))]
  const linkedExecutionStatusByInstance = new Map<string, string>()
  if (completedInstanceIds.length > 0) {
    const linked = await db.select({ scheduledInstanceId: pdtpExecutions.scheduledInstanceId, status: pdtpExecutions.status })
      .from(pdtpExecutions)
      .where(inArray(pdtpExecutions.scheduledInstanceId, completedInstanceIds))
    for (const row of linked) {
      if (row.scheduledInstanceId) linkedExecutionStatusByInstance.set(row.scheduledInstanceId, row.status)
    }
  }

  const paramsByWorksite = groupRowsByWorksite(paramRows)
  const closedOnTimeByWorksite = groupRowsByWorksite(closedOnTimeRows)
  const minimumExclusionsByWorksite = groupRowsByWorksite(minimumExclusions)
  const coverageActivityIds = new Set(activityRows.filter((a) => a.indicatorMode === "coverage").map((a) => a.id))
  for (const target of targets) {
    result.set(target, assemblePdtpIndicatorInputs({
      program,
      window,
      target,
      activityRows,
      loaded: target ? loadedByWorksite.get(target)! : consolidatedLoaded!,
      activationCutoff: cutoffFor(target),
      eligibleScheduledInstances: eligibleByTarget.get(target)!,
      linkedExecutionStatusByInstance,
      paramRows: target ? paramsByWorksite.get(target) ?? [] : [],
      rosters,
      // Sin faena no hay obligaciones que mirar, mismo límite que el padrón derivado.
      closedOnTime: tallyClosedOnTime(target ? closedOnTimeByWorksite.get(target) ?? [] : [], year, coverageActivityIds),
      minimumExcludedActivityIds: new Set((target ? minimumExclusionsByWorksite.get(target) ?? [] : []).map((row) => row.activityId)),
    }))
  }
  return result
}

function assemblePdtpIndicatorInputs(input: {
  program: PdtpIndicatorProgram
  window: Pick<PdtpVersionWindow, "until" | "successor"> | null
  target: PdtpIndicatorTarget
  activityRows: PdtpIndicatorActivity[]
  loaded: PdtpLoadedScheduleAndExecutions
  activationCutoff: string | null | undefined
  eligibleScheduledInstances: Array<{ id: string; activityId: string; scheduledFor: string; plannedQuantity: number; status: string; updatedAt: string }>
  linkedExecutionStatusByInstance: ReadonlyMap<string, string>
  paramRows: Array<{ activityId: string; expectedSubjectCount: number | null; targetCoveragePercent: number | null }>
  rosters: PdtpSubjectRosterBatch | null
  closedOnTime: ReturnType<typeof tallyClosedOnTime>
  minimumExcludedActivityIds: ReadonlySet<string>
}): PdtpIndicatorInputs {
  const { program, activityRows, loaded, activationCutoff, eligibleScheduledInstances, linkedExecutionStatusByInstance } = input
  const worksiteId = input.target
  const year = program.year
  const until = input.window?.until ?? null

  // PREV-C05-B: y termina donde empieza la versión sucesora, si la hay.
  const windowed = <T extends { year: number; month: number; week: number }>(rows: T[]) =>
    filterPdtpRowsBeforeSuccessor(filterPdtpRowsFromActivation(rows, activationCutoff), until)
  const scheduleRows = windowed(loaded.scheduleRows)
  const executionRows = windowed(loaded.executionRows)
  // Métrica, no insumo del cálculo: los desvíos que transforman el
  // planificado ya vienen aplicados en `scheduleRows` desde la costura única.
  // Acá sólo se cuentan los "no realizada" por mes para exponerlos.
  const declaredNotPerformedByMonth = Array.from({ length: 12 }, () => 0)
  for (const row of windowed(loaded.deviationRows)) {
    if (row.kind !== "not_performed") continue
    declaredNotPerformedByMonth[row.month - 1] = (declaredNotPerformedByMonth[row.month - 1] ?? 0) + 1
  }
  // El cumplimiento formal solo incorpora ejecuciones validadas. Las
  // submitted siguen visibles en el tablero operativo y en aprobaciones.
  const instanceCounts = (instance: { id: string; status: string }) =>
    pdtpScheduledInstanceCountsAsExecuted(instance.status, linkedExecutionStatusByInstance.get(instance.id))
  // PREV-I08-a: una ocurrencia que cuenta ya aporta su cantidad planificada;
  // la ejecución enlazada a ella es el mismo hecho y no suma de nuevo en su
  // celda. La regla vive en `effectiveApprovedExecutionsByCell` para que todas
  // las vistas la apliquen igual, incluida la carga manual de la misma semana.
  const approvedExecutionRows = executionRows.filter((row) => row.status === "approved")
  const effectiveExecutionRows = effectiveApprovedExecutionsByCell(approvedExecutionRows, { instanceCutoff: activationCutoff })

  /**
   * Padrón por actividad. La cadena es: **override manual → padrón derivado del
   * registro de sujetos → cantidad planificada del mes**.
   *
   * El derivado es lo nuevo (`subject_source`): el padrón deja de ser un número
   * que alguien teclea y pasa a leerse de donde los sujetos ya viven —la
   * dotación, el inventario de extintores, los expuestos de un GES—. Un número
   * guardado envejece; una consulta no.
   *
   * Se conserva el override porque sigue habiendo sujetos sin registro propio, y
   * gana sobre lo derivado: si alguien lo cargó a mano, sabe algo que la consulta
   * no.
   *
   * Las fuentes históricas conservan la caída a planificación cuando su
   * registro está vacío. `trabajadores_capacidad` es distinta: un cero indica
   * clasificación pendiente, se expone como incidencia y jamás se reemplaza
   * silenciosamente por la cantidad planificada.
   */
  const expectedByActivity = new Map<string, number>()
  const coverageTargetPctByActivity = new Map<string, number>()
  /** Padrón derivado. Las fuentes de stock se resuelven una vez; las de flujo, por mes. */
  const derivedStockByActivity = new Map<string, number>()
  const derivedFlowByActivityMonth = new Map<string, number>()
  const subjectRosterIssues: PdtpComplianceIndicators["subjectRosterIssues"] = []

  if (worksiteId) {
    for (const row of input.paramRows) {
      if (row.expectedSubjectCount != null) expectedByActivity.set(row.activityId, row.expectedSubjectCount)
      if (row.targetCoveragePercent != null) coverageTargetPctByActivity.set(row.activityId, Number(row.targetCoveragePercent))
    }

    // Sólo se lee el padrón de las actividades que de verdad miden por
    // cobertura, declaran fuente y no tienen override: lo demás sería trabajo de
    // más sobre un dato que no se va a usar. El padrón ya viene cargado por
    // lote (`loadPdtpSubjectRosterBatch`).
    const needDerived = activityRows.filter((a) => a.indicatorMode === "coverage"
      && a.subjectSource !== null
      && !expectedByActivity.has(a.id))

    for (const activity of needDerived) {
      const rosters = input.rosters!
      if (isFlowSubjectSource(activity.subjectSource)) {
        for (let month = 1; month <= 12; month++) {
          const roster = rosters.get(activity.subjectSource, worksiteId, { year, month })
          if (roster && roster.count > 0) derivedFlowByActivityMonth.set(`${activity.id}:${month}`, roster.count)
        }
        continue
      }
      const roster = rosters.get(
        activity.subjectSource,
        worksiteId,
        { year, month: 1 },
        { capabilityCodes: activity.subjectCapabilityCodes },
      )
      if (!roster) continue
      if (activity.subjectSource === "trabajadores_capacidad") {
        // Guardar también cero es deliberado: `Map.has` diferencia una nómina
        // vacía resuelta de la ausencia de fuente que sí cae a planificación.
        derivedStockByActivity.set(activity.id, roster.count)
        if (roster.status !== "resolved") {
          subjectRosterIssues.push({
            activityId: activity.id,
            worksiteId,
            source: "trabajadores_capacidad",
            status: roster.status,
            capabilityCodes: roster.capabilityCodes,
            explanation: roster.explanation,
          })
        }
      } else if (roster.count > 0) {
        derivedStockByActivity.set(activity.id, roster.count)
      }
    }
  }

  const plannedByActivityMonth = new Map<string, number>()
  for (const row of scheduleRows) {
    const key = `${row.activityId}:${row.month}`
    plannedByActivityMonth.set(key, (plannedByActivityMonth.get(key) ?? 0) + row.plannedQuantity)
  }
  for (const row of eligibleScheduledInstances) {
    if (row.status === "not_applicable" || row.status === "cancelled") continue
    const month = Number(row.scheduledFor.slice(5, 7))
    if (month < 1 || month > 12) continue
    const key = `${row.activityId}:${month}`
    plannedByActivityMonth.set(key, (plannedByActivityMonth.get(key) ?? 0) + row.plannedQuantity)
  }
  const executedByActivityMonth = new Map<string, number>()
  for (const row of effectiveExecutionRows) {
    const key = `${row.activityId}:${row.month}`
    executedByActivityMonth.set(key, (executedByActivityMonth.get(key) ?? 0) + row.executedQuantity)
  }
  for (const row of eligibleScheduledInstances) {
    if (!instanceCounts(row)) continue
    const month = Number(row.scheduledFor.slice(5, 7))
    if (month < 1 || month > 12) continue
    const key = `${row.activityId}:${month}`
    executedByActivityMonth.set(key, (executedByActivityMonth.get(key) ?? 0) + row.plannedQuantity)
  }

  const lastExecutionUpdatedAt = approvedExecutionRows.reduce<string | null>((latest, row) => {
    return !latest || row.updatedAt > latest ? row.updatedAt : latest
  }, null)
  const latestScheduledCompletion = eligibleScheduledInstances
    .filter((row) => row.status === "completed")
    .reduce<string | null>((latest, row) => !latest || row.updatedAt > latest ? row.updatedAt : latest, null)
  const finalLastExecutionUpdatedAt = latestScheduledCompletion
    && (!lastExecutionUpdatedAt || latestScheduledCompletion > lastExecutionUpdatedAt)
    ? latestScheduledCompletion
    : lastExecutionUpdatedAt

  return {
    program,
    until,
    activityRows,
    plannedByActivityMonth,
    executedByActivityMonth,
    declaredNotPerformedByMonth,
    expectedByActivity,
    coverageTargetPctByActivity,
    derivedStockByActivity,
    derivedFlowByActivityMonth,
    subjectRosterIssues,
    closedOnTimePlanned: input.closedOnTime.planned,
    closedOnTimeExecuted: input.closedOnTime.executed,
    closedOnTimeCompleted: input.closedOnTime.completedByActivity,
    minimumExcludedActivityIds: input.minimumExcludedActivityIds,
    lastExecutionUpdatedAt: finalLastExecutionUpdatedAt,
    approvedExecutionIds: approvedExecutionRows.map((row) => row.id),
  }
}

/**
 * Clave de consolidación de cada actividad entre versiones: la actividad de la
 * versión más reciente que comparte su identidad de catálogo (o, sin ella, su
 * número). Con una sola versión es la identidad.
 */
function consolidationKeys(parts: readonly PdtpIndicatorInputs[]): Map<string, string> {
  const keyOf = new Map<string, string>()
  if (parts.length === 1) {
    for (const activity of parts[0]!.activityRows) keyOf.set(activity.id, activity.id)
    return keyOf
  }
  const identityOf = (part: PdtpIndicatorInputs, activity: PdtpIndicatorActivity) => {
    // Un catálogo repetido dentro de la misma versión no identifica a nadie:
    // se cae al número, que sí es único por programa.
    const repeated = activity.catalogActivityId
      && part.activityRows.filter((row) => row.catalogActivityId === activity.catalogActivityId).length > 1
    return activity.catalogActivityId && !repeated ? `cat:${activity.catalogActivityId}` : `n:${activity.n}`
  }
  const representative = new Map<string, string>()
  // La versión más reciente gana: se recorre de la última a la primera.
  for (const part of [...parts].reverse()) {
    for (const activity of part.activityRows) {
      const identity = identityOf(part, activity)
      if (!representative.has(identity)) representative.set(identity, activity.id)
      keyOf.set(activity.id, representative.get(identity)!)
    }
  }
  return keyOf
}

function remapActivityMonthMap(target: Map<string, number>, source: Map<string, number>, keyOf: Map<string, string>) {
  for (const [key, value] of source) {
    const separator = key.lastIndexOf(":")
    const activityId = key.slice(0, separator)
    const merged = `${keyOf.get(activityId) ?? activityId}${key.slice(separator)}`
    target.set(merged, (target.get(merged) ?? 0) + value)
  }
}

function computePdtpIndicatorsFromInputs(
  primary: PdtpIndicatorProgram,
  worksiteId: string | undefined,
  parts: readonly PdtpIndicatorInputs[],
): PdtpComplianceIndicators {
  const year = primary.year
  const keyOf = consolidationKeys(parts)
  const key = (activityId: string) => keyOf.get(activityId) ?? activityId

  /* Las filas representativas (de la versión más reciente) dan el modo, la
   * fuente del padrón y el piso anual; el resto se suma. Los parámetros por
   * faena se superponen de la más antigua a la más reciente. */
  const representativeRows = new Map<string, PdtpIndicatorActivity & { until: PdtpPeriod | null }>()
  const plannedByActivityMonth = new Map<string, number>()
  const executedByActivityMonth = new Map<string, number>()
  const closedOnTimePlanned = new Map<string, number>()
  const closedOnTimeExecuted = new Map<string, number>()
  const closedOnTimeCompleted = new Map<string, number>()
  const expectedByActivity = new Map<string, number>()
  const coverageTargetPctByActivity = new Map<string, number>()
  const derivedStockByActivity = new Map<string, number>()
  const derivedFlowByActivityMonth = new Map<string, number>()
  const declaredNotPerformedByMonth = Array.from({ length: 12 }, () => 0)
  const subjectRosterIssues: PdtpComplianceIndicators["subjectRosterIssues"] = []
  let lastExecutionUpdatedAt: string | null = null
  for (const part of parts) {
    for (const activity of part.activityRows) {
      if (key(activity.id) === activity.id) representativeRows.set(activity.id, { ...activity, until: part.until })
    }
    remapActivityMonthMap(plannedByActivityMonth, part.plannedByActivityMonth, keyOf)
    remapActivityMonthMap(executedByActivityMonth, part.executedByActivityMonth, keyOf)
    remapActivityMonthMap(closedOnTimePlanned, part.closedOnTimePlanned, keyOf)
    remapActivityMonthMap(closedOnTimeExecuted, part.closedOnTimeExecuted, keyOf)
    for (const [activityId, value] of part.closedOnTimeCompleted) {
      closedOnTimeCompleted.set(key(activityId), (closedOnTimeCompleted.get(key(activityId)) ?? 0) + value)
    }
    for (const [activityId, value] of part.expectedByActivity) expectedByActivity.set(key(activityId), value)
    for (const [activityId, value] of part.coverageTargetPctByActivity) coverageTargetPctByActivity.set(key(activityId), value)
    for (const [activityId, value] of part.derivedStockByActivity) derivedStockByActivity.set(key(activityId), value)
    for (const [monthKey, value] of part.derivedFlowByActivityMonth) {
      const separator = monthKey.lastIndexOf(":")
      derivedFlowByActivityMonth.set(`${key(monthKey.slice(0, separator))}${monthKey.slice(separator)}`, value)
    }
    part.declaredNotPerformedByMonth.forEach((count, index) => { declaredNotPerformedByMonth[index] = (declaredNotPerformedByMonth[index] ?? 0) + count })
    for (const issue of part.subjectRosterIssues) {
      if (key(issue.activityId) === issue.activityId) subjectRosterIssues.push(issue)
    }
    if (part.lastExecutionUpdatedAt && (!lastExecutionUpdatedAt || part.lastExecutionUpdatedAt > lastExecutionUpdatedAt)) {
      lastExecutionUpdatedAt = part.lastExecutionUpdatedAt
    }
  }
  const activityRows = [...representativeRows.values()]
  const allActivityIds = activityRows.map((row) => row.id)

  // Modo de indicador por actividad: 'coverage' se calcula todo-o-nada; el resto
  // se capa en lo planificado (R3). El cómputo es por actividad-mes para poder
  // aplicar reglas distintas por actividad y no dejar que una compense a otra.
  const modeByActivity = new Map(activityRows.map((a) => [a.id, a.indicatorMode]))
  const sourceByActivity = new Map<string, string | null>(activityRows.map((a) => [a.id, a.subjectSource]))
  const untilByActivity = new Map(activityRows.map((a) => [a.id, a.until]))

  /** Padrón efectivo de una celda actividad-mes, o `null` si no hay ninguno. */
  const padronFor = (activityId: string, month: number): number | null => {
    const manual = expectedByActivity.get(activityId)
    if (manual != null) return manual
    const flow = derivedFlowByActivityMonth.get(`${activityId}:${month}`)
    if (flow != null) return flow
    return derivedStockByActivity.get(activityId) ?? null
  }

  // Piso anual (`minAnnualExecutions`): cuánto puso cada actividad en el
  // denominador del año y cuánto realizó, contara o no. Se acumula en el bucle
  // mensual —que es donde se decide qué cuenta— y se aplica al cierre.
  const annualMeasuredByActivity = new Map<string, number>()
  const annualPerformedByActivity = new Map<string, number>()
  const bumpAnnual = (map: Map<string, number>, activityId: string, amount: number) => {
    if (amount > 0) map.set(activityId, (map.get(activityId) ?? 0) + amount)
  }

  const monthly: PdtpComplianceMonth[] = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    // Actividades de cobertura: todo o nada por actividad (respuesta 2.2).
    let coveragePlanned = 0
    let coverageExecuted = 0
    // Resto de actividades: cada una aporta como máximo su plan del mes
    // (`pdtpCountedExecuted`, PREV-C02). Hasta el 2026-09-26 el techo se
    // aplicaba al total del mes (respuesta 2.4) y una actividad sobreejecutada
    // compensaba a otra en cero; esa regla se reemplazó.
    let restPlanned = 0
    let restExecuted = 0
    // Actividades del "resto" con planificación este mes y cero ejecución
    // aprobada: el detalle de qué quedó sin hacer.
    const zeroActivityIds: string[] = []
    for (const activityId of allActivityIds) {
      const p = plannedByActivityMonth.get(`${activityId}:${month}`) ?? 0
      const rawExecuted = executedByActivityMonth.get(`${activityId}:${month}`) ?? 0
      if (modeByActivity.get(activityId) === "coverage") {
        const derived = padronFor(activityId, month)
        // Una fuente de stock se barre según calendario, así que sin planificación
        // en el mes no hay nada que exigir. Una de flujo es al revés: el
        // denominador son los casos que ocurrieron, y ocurren cuando ocurren — la
        // N°18 no tiene calendario y aun así debe contar el mes que entró gente.
        // PREV-C05-B: salvo los meses que ya son de la versión sucesora.
        const esFlujo = isFlowSubjectSource(sourceByActivity.get(activityId) ?? null)
          && isPdtpMonthBeforeSuccessor(year, month, untilByActivity.get(activityId))
        bumpAnnual(annualPerformedByActivity, activityId, rawExecuted)
        const obligationKey = `${activityId}:${month}`
        const obligationCases = closedOnTimePlanned.get(obligationKey) ?? 0
        if (obligationCases > 0) {
          coveragePlanned += obligationCases
          coverageExecuted += closedOnTimeExecuted.get(obligationKey) ?? 0
          bumpAnnual(annualMeasuredByActivity, activityId, obligationCases)
        }
        if (p === 0 && !(esFlujo && derived != null)) continue
        // Override manual → padrón derivado → cantidad planificada. Sin ninguno,
        // se mide por lo planificado y no contra una población inventada.
        const target = derived ?? p
        // R2: `targetCoveragePercent` baja el umbral de acreditación sin tocar el
        // denominador — con meta 90 % y padrón 50, acreditan 45 ejecuciones y el
        // aporte sigue siendo 50/50. Sin meta configurada se exige el padrón
        // completo, que es el comportamiento histórico.
        const targetPct = coverageTargetPctByActivity.get(activityId)
        const threshold = targetPct != null ? Math.ceil((target * targetPct) / 100) : target
        coveragePlanned += target
        coverageExecuted += threshold > 0 && rawExecuted >= threshold ? target : 0
        bumpAnnual(annualMeasuredByActivity, activityId, target)
      } else if (modeByActivity.get(activityId) === "closed_on_time") {
        // A demanda: no hay calendario contra el cual medir, así que `p` es
        // siempre 0 (no confundir con "sin casos": es que esta actividad
        // nunca tuvo celdas planificadas). El denominador son los casos que
        // vencieron este mes, y el numerador los que se cerraron a tiempo —
        // se suman a `coverage*` porque comparten la misma regla todo-o-nada
        // por caso (cada obligación pesa 1, no se prorratea).
        const monthKey = `${activityId}:${month}`
        const casesDue = closedOnTimePlanned.get(monthKey) ?? 0
        if (casesDue === 0) continue // sin casos este mes: no es un 0%, es nada que medir.
        coveragePlanned += casesDue
        coverageExecuted += closedOnTimeExecuted.get(monthKey) ?? 0
        bumpAnnual(annualMeasuredByActivity, activityId, casesDue)
      } else {
        // Resto: tope por actividad y mes (PREV-C02). Lo ejecutado sin plan
        // en el mes no aporta, y el excedente no cubre a otra actividad.
        restPlanned += p
        restExecuted += pdtpCountedExecuted(p, rawExecuted)
        if (p > 0 && rawExecuted === 0) zeroActivityIds.push(activityId)
      }
    }
    const planned = coveragePlanned + restPlanned
    const executed = coverageExecuted + restExecuted
    const percent = planned > 0 ? Math.round((executed / planned) * 100) / 100 : null
    return {
      month, planned, executed, percent,
      zeroActivities: zeroActivityIds.length, zeroActivityIds,
      declaredNotPerformed: declaredNotPerformedByMonth[i] ?? 0,
    }
  })

  // Piso anual de las actividades "cuando corresponda". Sólo por faena: sin
  // faena no hay obligaciones ni padrón que medir (mismo límite que
  // `closed_on_time` y `coverage`), y el consolidado suma las faenas. Lo que
  // falte para el mínimo vence al cierre del año, así que entra a diciembre
  // —igual que una celda planificada futura ya cuenta en el denominador anual—
  // y con la regla todo-o-nada de los modos por caso: no compensa ni es
  // compensado por otra actividad.
  // PREV-C05-B: lo exige sólo la versión dueña de diciembre (sin sucesora).
  if (worksiteId) {
    const withMinimum = activityRows.filter((a) => (a.minAnnualExecutions ?? 0) > 0
      && a.until === null
      && isPdtpActivityEffectiveForPeriod(a, year, PDTP_ANNUAL_MINIMUM_MONTH, 4))
    // Las exclusiones de la faena ya vienen en las entradas de cada versión
    // (I12: antes se consultaban acá, una vez por faena).
    const excludedIds = new Set(parts.flatMap((part) => [...part.minimumExcludedActivityIds]))
    const closing = monthly[PDTP_ANNUAL_MINIMUM_MONTH - 1]!
    for (const activity of withMinimum) {
      if (excludedIds.has(activity.id)) continue
      const performed = activity.indicatorMode === "closed_on_time"
        ? closedOnTimeCompleted.get(activity.id) ?? 0
        : (annualPerformedByActivity.get(activity.id) ?? 0) + (closedOnTimeCompleted.get(activity.id) ?? 0)
      const floor = pdtpAnnualMinimumFloor({
        minimum: activity.minAnnualExecutions,
        measured: annualMeasuredByActivity.get(activity.id) ?? 0,
        performed,
      })
      closing.planned += floor.planned
      closing.executed += floor.executed
    }
    closing.percent = closing.planned > 0 ? Math.round((closing.executed / closing.planned) * 100) / 100 : null
  }

  const quarterly = Array.from({ length: 4 }, (_, q) => {
    const months = monthly.slice(q * 3, q * 3 + 3)
    const planned = months.reduce((s, m) => s + m.planned, 0)
    const executed = months.reduce((s, m) => s + m.executed, 0)
    const percent = planned > 0 ? Math.round((executed / planned) * 100) / 100 : null
    return { quarter: q + 1, planned, executed, percent }
  })

  const annualPlanned = monthly.reduce((s, m) => s + m.planned, 0)
  const annualExecuted = monthly.reduce((s, m) => s + m.executed, 0)
  const annual = {
    planned: annualPlanned, executed: annualExecuted,
    percent: annualPlanned > 0 ? Math.round((annualExecuted / annualPlanned) * 100) / 100 : null,
    zeroActivityMonths: monthly.filter((m) => m.zeroActivities > 0).length,
    // Unión, no concatenación: la misma actividad en cero en dos meses distintos
    // sigue siendo una actividad para este listado anual.
    zeroActivityIds: [...new Set(monthly.flatMap((m) => m.zeroActivityIds))],
  }

  return {
    programId: primary.id,
    year,
    target: primary.complianceTarget,
    monthly,
    quarterly,
    annual,
    toDate: pdtpComplianceToDate(monthly, year),
    lastExecutionUpdatedAt,
    subjectRosterIssues,
  }
}

/**
 * Agrega el indicador de cumplimiento sobre varias faenas autorizadas (por
 * ejemplo, todas las que ve un usuario global) reutilizando el cálculo
 * por-faena ya correcto, en vez de omitir `worksiteId` — omitirlo deja
 * `executed` en 0 aunque exista avance real (UX-01). Falla cerrado: sin
 * faenas explícitas no hay agregado.
 */
export async function getPdtpComplianceIndicatorsForScope(
  yearOrProgramId: number | string,
  worksiteIds: string[],
  /**
   * PREV-C05-C: `consolidateYear` agrega el cumplimiento del **año** entre
   * versiones (`getPdtpYearComplianceIndicators`) en vez del de un solo
   * programa. Es lo que muestran el tablero y la tarjeta de inicio; la ficha
   * de cada versión sigue midiendo la suya.
   */
  options: { consolidateYear?: boolean } = {},
): Promise<(PdtpComplianceIndicators & {
  worksiteCount: number
  /** Desglose por faena, en el mismo orden que `worksiteIds`. Se expone para que
   * un consumidor que necesita el agregado *y* la comparativa por faena (el
   * tablero) no tenga que volver a calcular lo mismo N veces. */
  perWorksite: Array<{ worksiteId: string; indicators: PdtpComplianceIndicators | null }>
  /** Sólo con `consolidateYear`: las versiones que componen el año. */
  versions?: PdtpComplianceVersion[]
}) | null> {
  if (worksiteIds.length === 0) return null
  let versions: PdtpComplianceVersion[] | undefined
  // I12: todas las faenas en una sola carga por versión (antes, el cálculo
  // completo —programa, ventana, actividades, calendario, padrón— por faena).
  const program = await resolveIndicatorProgram(yearOrProgramId)
  let perWorksiteResults: Array<PdtpComplianceIndicators | null> = worksiteIds.map(() => null)
  if (program && !options.consolidateYear) {
    const inputs = await loadPdtpIndicatorInputsForTargets(program, worksiteIds, await loadIndicatorVersionWindow(program.id))
    perWorksiteResults = worksiteIds.map((id) => {
      const own = inputs.get(id) ?? null
      return own ? computePdtpIndicatorsFromInputs(program, id, [own]) : emptyPdtpComplianceIndicators(program)
    })
  } else if (program) {
    // Las versiones son del año, no de la faena: se exponen una vez arriba.
    const year = await computeYearIndicatorsForTargets(program, worksiteIds)
    versions = year.versions
    perWorksiteResults = worksiteIds.map((id) => year.byTarget.get(id) ?? null)
  }
  if (options.consolidateYear) versions ??= []
  const perWorksite = worksiteIds.map((worksiteId, index) => ({ worksiteId, indicators: perWorksiteResults[index] ?? null }))
  const resolved = perWorksiteResults.filter((x): x is PdtpComplianceIndicators => x !== null)
  if (resolved.length === 0) return null

  const monthly: PdtpComplianceMonth[] = Array.from({ length: 12 }, (_, i) => {
    const planned = resolved.reduce((sum, entry) => sum + entry.monthly[i]!.planned, 0)
    const executed = resolved.reduce((sum, entry) => sum + entry.monthly[i]!.executed, 0)
    // Unión de ids entre faenas, no suma de conteos: la misma actividad en
    // cero en dos faenas es una sola actividad en cero para el agregado (una
    // faena que ya reprueba esa actividad no la hace "más en cero" porque otra
    // faena también la reprueba).
    const zeroActivityIds = [...new Set(resolved.flatMap((entry) => entry.monthly[i]!.zeroActivityIds))]
    return {
      month: i + 1, planned, executed,
      percent: planned > 0 ? Math.round((executed / planned) * 100) / 100 : null,
      zeroActivities: zeroActivityIds.length,
      zeroActivityIds,
      // Suma, no unión: cada desvío es un evento de una faena concreta sobre
      // una celda concreta. Dos faenas que declaran "no realizada" la misma
      // actividad son dos declaraciones, no una.
      declaredNotPerformed: resolved.reduce((sum, entry) => sum + entry.monthly[i]!.declaredNotPerformed, 0),
    }
  })
  const quarterly = Array.from({ length: 4 }, (_, q) => {
    const months = monthly.slice(q * 3, q * 3 + 3)
    const planned = months.reduce((s, m) => s + m.planned, 0)
    const executed = months.reduce((s, m) => s + m.executed, 0)
    return { quarter: q + 1, planned, executed, percent: planned > 0 ? Math.round((executed / planned) * 100) / 100 : null }
  })
  const annualPlanned = monthly.reduce((s, m) => s + m.planned, 0)
  const annualExecuted = monthly.reduce((s, m) => s + m.executed, 0)
  const lastExecutionUpdatedAt = resolved.reduce<string | null>((latest, entry) => {
    return entry.lastExecutionUpdatedAt && (!latest || entry.lastExecutionUpdatedAt > latest) ? entry.lastExecutionUpdatedAt : latest
  }, null)
  const subjectRosterIssues = resolved.flatMap((entry) => entry.subjectRosterIssues)

  return {
    programId: resolved[0]!.programId,
    year: resolved[0]!.year,
    target: resolved[0]!.target,
    monthly,
    quarterly,
    toDate: pdtpComplianceToDate(monthly, resolved[0]!.year),
    annual: {
      planned: annualPlanned, executed: annualExecuted,
      percent: annualPlanned > 0 ? Math.round((annualExecuted / annualPlanned) * 100) / 100 : null,
      zeroActivityMonths: monthly.filter((m) => m.zeroActivities > 0).length,
      zeroActivityIds: [...new Set(monthly.flatMap((m) => m.zeroActivityIds))],
    },
    lastExecutionUpdatedAt,
    subjectRosterIssues,
    worksiteCount: worksiteIds.length,
    perWorksite,
    ...(versions ? { versions } : {}),
  }
}

export type PdtpCategoryCompliance = {
  /** Eje del sistema de gestión: `pdtpActivities.program`. */
  category: string
  planned: number
  executed: number
  percent: number | null
}

/**
 * Avance por eje SG-SST sobre las faenas autorizadas. Se calcula con las mismas
 * reglas que el indicador mensual —solo ejecuciones aprobadas y techo de
 * sobrecumplimiento— pero agrupando por `program` en vez de por mes.
 *
 * Las actividades de cobertura quedan **fuera**: su denominador es un padrón
 * (50 trabajadores) que se puntúa todo-o-nada, así que sumarlo a un eje que
 * cuenta instancias de actividad (12 inspecciones) dejaría que una sola
 * actividad de cobertura domine el eje completo. Esa es la mezcla de unidades
 * que se evita.
 *
 * Las de `closed_on_time` sí entran, con sus **casos** como unidad: 3
 * obligaciones vencidas y 2 cerradas a tiempo es 2/3, proporcional y del mismo
 * orden de magnitud que "12 inspecciones planificadas". Hasta el 2026-09-03
 * quedaban dentro del bucket pero aportando planned=0 —son `on_demand`, no
 * tienen `scheduleRows`—, así que 18 de las 81 actividades desaparecían en
 * silencio de su eje. Cuentan por obligación, nunca por sus celdas de
 * calendario: si una `closed_on_time` tuviera cronograma, sus celdas se
 * ignoran igual que en el cálculo mensual.
 */
export async function getPdtpComplianceByCategoryForScope(
  programId: string,
  worksiteIds: string[],
): Promise<PdtpCategoryCompliance[] | null> {
  if (worksiteIds.length === 0) return null
  const program = await loadIndicatorProgramById(programId)
  if (!program) return null

  const activityRows = await loadIndicatorActivities(program.id)

  // Las de cobertura quedan fuera del eje completas, incluidos sus casos por
  // obligación (la entrega de un RIOHS nuevo, N°18): su unidad es el padrón y
  // mezclarla con instancias de actividad es lo que este desglose evita.
  const scorable = activityRows.filter((row) => row.indicatorMode !== "coverage")
  if (scorable.length === 0) return []
  const categoryByActivity = new Map(scorable.map((row) => [row.id, row.program || "General"]))

  // Las por plazo no se miden por calendario: se excluyen de la carga de
  // cronograma/ejecuciones y entran más abajo contando obligaciones.
  const closedOnTimeIds = scorable.filter((row) => row.indicatorMode === "closed_on_time").map((row) => row.id)
  const scheduledIds = scorable.filter((row) => row.indicatorMode !== "closed_on_time").map((row) => row.id)
  // Piso anual, con la misma regla que el indicador mensual y por faena: el
  // mínimo se exige en cada una, así que no puede calcularse sobre la suma.
  // Sólo `closed_on_time` llega acá — las de cobertura están fuera del eje.
  const withMinimum = scorable.filter((row) => row.indicatorMode === "closed_on_time"
    && (row.minAnnualExecutions ?? 0) > 0
    && isPdtpActivityEffectiveForPeriod(row, program.year, PDTP_ANNUAL_MINIMUM_MONTH, 4))

  /* El corte va adentro del cargador porque se aplica por faena y el
   * resultado aplana las faenas: acá afuera `scheduleRows` ya no sabe de cuál
   * vino. I12: calendario, obligaciones y exclusiones de todas las faenas se
   * leen a la vez y una sola vez; antes el piso anual consultaba las
   * obligaciones faena por faena, en serie. */
  const [loaded, closedOnTimeRows, exclusions] = await Promise.all([
    loadIndicatorVersionWindow(program.id).then((window) => loadApprovedExecutionsForWorksites(
      scheduledIds,
      program.year,
      worksiteIds,
      { programId: program.id, activatedAt: program.activatedAt, until: window?.until ?? null },
    )),
    loadClosedOnTimeRows(closedOnTimeIds, worksiteIds),
    withMinimum.length > 0
      ? db.select({
          activityId: pdtpActivityWorksiteExclusions.activityId,
          worksiteId: pdtpActivityWorksiteExclusions.worksiteId,
        }).from(pdtpActivityWorksiteExclusions)
          .where(and(
            inArray(pdtpActivityWorksiteExclusions.activityId, withMinimum.map((row) => row.id)),
            inArray(pdtpActivityWorksiteExclusions.worksiteId, worksiteIds),
          ))
      : Promise.resolve([]),
  ])
  const totals = new Map<string, { planned: number; executed: number }>()
  const bump = (activityId: string, field: "planned" | "executed", amount: number) => {
    const category = categoryByActivity.get(activityId)
    if (!category) return
    const entry = totals.get(category) ?? { planned: 0, executed: 0 }
    entry[field] += amount
    totals.set(category, entry)
  }
  // PREV-C01/C02: lo calendarizado se topa por faena, actividad y mes, con la
  // misma regla que el indicador (`pdtpCountedExecuted`): una actividad no
  // cubre a otra ni un mes sin plan cubre uno en cero.
  for (const entry of loaded.perWorksite) {
    const plannedByActivityMonth = new Map<string, number>()
    for (const row of entry.scheduleRows) {
      const key = `${row.activityId}:${row.month}`
      plannedByActivityMonth.set(key, (plannedByActivityMonth.get(key) ?? 0) + row.plannedQuantity)
      bump(row.activityId, "planned", row.plannedQuantity)
    }
    const executedByActivityMonth = new Map<string, number>()
    // PREV-I08-a: el eje no representa ocurrencias; el hecho de una ocurrencia
    // se cuenta en su celda (`instanceCells`), igual que en el indicador.
    for (const cell of effectiveApprovedExecutionsByCell(entry.executionRows, { instanceCutoff: entry.cutoff, instanceCells: true })) {
      const key = `${cell.activityId}:${cell.month}`
      executedByActivityMonth.set(key, (executedByActivityMonth.get(key) ?? 0) + cell.executedQuantity)
    }
    for (const [key, executed] of executedByActivityMonth) {
      const activityId = key.slice(0, key.lastIndexOf(":"))
      bump(activityId, "executed", pdtpCountedExecuted(plannedByActivityMonth.get(key) ?? 0, executed))
    }
  }

  // Casos por plazo: cada obligación vencida pesa 1 en el denominador y cada
  // cierre dentro de plazo pesa 1 en el numerador, con la misma regla que el
  // cálculo mensual (`tallyClosedOnTime`). Se suma sobre todos los meses porque
  // este desglose agrupa por eje, no por mes.
  const closedOnTime = tallyClosedOnTime(closedOnTimeRows, program.year)
  for (const [key, cases] of closedOnTime.planned) {
    bump(key.slice(0, key.lastIndexOf(":")), "planned", cases)
  }
  for (const [key, onTime] of closedOnTime.executed) {
    bump(key.slice(0, key.lastIndexOf(":")), "executed", onTime)
  }

  if (withMinimum.length > 0) {
    const excluded = new Set(exclusions.map((row) => `${row.activityId}:${row.worksiteId}`))
    const rowsByWorksite = groupRowsByWorksite(closedOnTimeRows)
    for (const worksiteId of worksiteIds) {
      const perWorksite = tallyClosedOnTime(rowsByWorksite.get(worksiteId) ?? [], program.year)
      for (const activity of withMinimum) {
        if (excluded.has(`${activity.id}:${worksiteId}`)) continue
        let measured = 0
        for (const [key, cases] of perWorksite.planned) {
          if (key.slice(0, key.lastIndexOf(":")) === activity.id) measured += cases
        }
        const floor = pdtpAnnualMinimumFloor({
          minimum: activity.minAnnualExecutions,
          measured,
          performed: perWorksite.completedByActivity.get(activity.id) ?? 0,
        })
        bump(activity.id, "planned", floor.planned)
        bump(activity.id, "executed", floor.executed)
      }
    }
  }

  return [...totals.entries()]
    .map(([category, { planned, executed }]) => {
      // Mismo techo que el cálculo mensual: sobrecumplir no sube del 100 %.
      const capped = Math.min(executed, planned)
      return {
        category,
        planned,
        executed: capped,
        percent: planned > 0 ? Math.round((capped / planned) * 100) / 100 : null,
      }
    })
    .sort((a, b) => b.planned - a.planned)
}

/* ── Cumplimiento integral (3 ejes: ejecución + verificación + cierre) ────── */

export type PdtpIntegralComplianceAxes = {
  ejecucion: number | null   // 0-1: ejecutado / planificado
  verificacion: number | null // 0-100: % items cumple del checklist
  cierre: number | null      // 0-100: % acciones cerradas
}

export type PdtpIntegralCompliance = PdtpIntegralComplianceAxes & {
  programId: string
  year: number
  integral: number | null     // 0-100: ponderado
  pesos: { ejecucion: number; verificacion: number; cierre: number }
}

/**
 * Ejes 2 y 3 sobre un conjunto de ejecuciones aprobadas. Vive aparte porque
 * tanto la versión por faena como la agregada tienen que calcularlos **sobre las
 * filas crudas**: `verificacion` es un promedio y `cierre` un ratio, así que
 * promediar los resultados por faena daría un número distinto (y equivocado)
 * cuando las faenas tienen distinto número de checklists o de acciones.
 *
 * `verificacion` sale de las inspecciones del motor transversal, alcanzadas por
 * la ejecución que acreditaron (`sourceType='inspeccion'`, `sourceId=runId`).
 * El motor de checklist propio del PDTP era la otra fuente y se retiró; sus dos
 * tablas estaban vacías, así que no aportaba nada.
 *
 * `cierre` lee CAPA y hallazgos de inspección. Las acciones que en su momento
 * creó el motor viejo siguen contando: viven en `prevention_capa_actions`.
 */
async function computeVerificacionYCierre(approvedExecutionIds: string[]): Promise<{
  verificacion: number | null
  cierre: number | null
}> {
  if (approvedExecutionIds.length === 0) return { verificacion: null, cierre: null }

  const [actions, inspectionRows] = await Promise.all([
    // D11: el estado de la acción vive en su CAPA. Leer el espejo daba un %
    // congelado cuando la acción se avanzaba desde la pantalla de CAPA.
    db.select({ estado: preventionCapaActions.status })
      .from(preventionCapaActions).where(and(
        eq(preventionCapaActions.sourceType, "pdtp"),
        inArray(preventionCapaActions.sourceId, approvedExecutionIds),
      )),
    db.select({
      runId: preventionInspectionRuns.id,
      compliancePercent: preventionInspectionRuns.compliancePercent,
    })
      .from(pdtpExecutions)
      .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, pdtpExecutions.sourceId))
      .where(and(
        inArray(pdtpExecutions.id, approvedExecutionIds),
        eq(pdtpExecutions.sourceType, "inspeccion"),
      )),
  ])

  /*
   * Se leen las dos columnas, la del hallazgo y la de su CAPA.
   *
   * El comentario que había aquí afirmaba que `status` «nunca llega a 'closed'
   * porque sólo hay escritor para 'capa_linked'». Eso **dejó de ser cierto** el
   * 2026-08-18, cuando B-06 agregó los escritores: hoy cierran el hallazgo la
   * transición de su CAPA a `verified`/`closed` (`prevention-capa.ts`), el
   * cierre directo de un hallazgo sin CAPA (`prevention-inspections.ts`) y el
   * cierre por orden de mantención (`maintenance.ts`).
   *
   * La consulta se conserva igual porque sigue siendo la correcta, pero por otra
   * razón: las filas anteriores a aquel arreglo quedaron con la CAPA cerrada y
   * el hallazgo en `capa_linked`, y mirar sólo la columna del hallazgo las
   * contaría como abiertas para siempre. Es un superconjunto deliberado.
   *
   * `INS-001` de la auditoría 2026-09-14 se apoyaba en este comentario y quedó
   * refutado al comprobarlo contra el código; ver `auditoria/07-reauditoria/`.
   */
  const inspectionRunIds = inspectionRows.map((row) => row.runId)
  const findings = inspectionRunIds.length > 0
    ? await db.select({
        status: preventionInspectionFindings.status,
        capaStatus: preventionCapaActions.status,
      })
        .from(preventionInspectionFindings)
        .leftJoin(preventionCapaActions, eq(preventionCapaActions.id, preventionInspectionFindings.capaActionId))
        .where(inArray(preventionInspectionFindings.runId, inspectionRunIds))
    : []

  const validPct = inspectionRows
    .map((row) => row.compliancePercent)
    .filter((pct): pct is number => pct !== null)
  const verificacion = validPct.length > 0
    ? Math.round((validPct.reduce((sum, pct) => sum + pct, 0) / validPct.length) * 100) / 100
    : null

  // Mismo criterio para las dos fuentes: cuenta como cerrado lo que quedó
  // verificado o cerrado. Un hallazgo sin CAPA enlazada está abierto.
  const findingCerrado = (f: { status: string; capaStatus: string | null }) =>
    f.status === "closed" || f.capaStatus === "closed" || f.capaStatus === "verified"
  const cerrados = actions.filter((a) => PDTP_ESTADOS_CERRADOS.has(capaEstado(a.estado))).length
    + findings.filter(findingCerrado).length
  const totalCierre = actions.length + findings.length
  const cierre = totalCierre > 0
    ? Math.round((cerrados / totalCierre) * 10000) / 100
    : null

  return { verificacion, cierre }
}

function weightIntegral(
  program: typeof pdtpPrograms.$inferSelect,
  axes: PdtpIntegralComplianceAxes,
): PdtpIntegralCompliance {
  const pesos = {
    ejecucion: program.pesoEjecucion,
    verificacion: program.pesoVerificacion,
    cierre: program.pesoCierre,
  }
  /* Un eje sin datos se pondera FUERA del denominador, no como cero.
   *
   * Antes `axes.verificacion ?? 0` hacía que un programa sin datos de
   * verificación perdiera `pesoVerificacion × 100` puntos —hasta 30— y mostrara
   * un integral rebajado en silencio, indistinguible de uno que sí midió y salió
   * mal. Con los tres ejes presentes los pesos suman 1 (CHECK
   * `pdtp_programs_pesos_sum_check`), así que esto no mueve ningún número que
   * hoy esté bien calculado: sólo arregla el caso degenerado.
   *
   * `ejecucion` llega como ratio 0-1; los otros dos ya son porcentaje. */
  const ponderables = [
    { peso: pesos.ejecucion, valor: axes.ejecucion === null ? null : axes.ejecucion * 100 },
    { peso: pesos.verificacion, valor: axes.verificacion },
    { peso: pesos.cierre, valor: axes.cierre },
  ].filter((eje): eje is { peso: number; valor: number } => eje.valor !== null)

  // Si lo único con dato pesa 0, no hay nada que ponderar: es "sin datos", no un 0.
  const pesoTotal = ponderables.reduce((suma, eje) => suma + eje.peso, 0)
  const integral = pesoTotal > 0
    ? Math.round((ponderables.reduce((suma, eje) => suma + eje.peso * eje.valor, 0) / pesoTotal) * 100) / 100
    : null

  return { programId: program.id, year: program.year, ...axes, integral, pesos }
}

/**
 * Cumplimiento integral agregado sobre las faenas autorizadas del usuario, para
 * el tablero cuando no hay una faena elegida. No es el promedio de los
 * integrales por faena: los tres ejes se agregan a nivel de filas.
 */
export async function getPdtpIntegralComplianceForScope(
  programId: string,
  worksiteIds: string[],
  /** PREV-C05-C: los tres ejes sobre el año consolidado entre versiones. */
  options: { consolidateYear?: boolean } = {},
): Promise<PdtpIntegralCompliance | null> {
  if (worksiteIds.length === 0) return null
  const program = await loadIndicatorProgramById(programId)
  if (!program) return null

  const [scoped, executionIds] = await Promise.all([
    getPdtpComplianceIndicatorsForScope(program.id, worksiteIds, options),
    (async () => {
      // Con el año consolidado, verificación y cierre leen las ejecuciones de cada
      // versión en su ventana; sin él, las del programa en la suya.
      const windows = options.consolidateYear
        ? (await loadIndicatorYearWindows(program.year)).filter((window) => window.status !== "archived")
        : []
      const sources = windows.some((window) => window.programId === program.id)
        ? await db.select().from(pdtpPrograms).where(inArray(pdtpPrograms.id, windows.map((window) => window.programId)))
        : [program]
      // I12: cada versión con una carga para todas las faenas (antes, siete
      // consultas por faena y versión, en serie entre versiones).
      const perSource = await Promise.all(sources.map(async (source) => {
        const [activityRows, window] = await Promise.all([loadIndicatorActivities(source.id), loadIndicatorVersionWindow(source.id)])
        const loaded = await loadApprovedExecutionsForWorksites(
          activityRows.map((row) => row.id),
          source.year,
          worksiteIds,
          { programId: source.id, activatedAt: source.activatedAt, until: window?.until ?? null },
        )
        return loaded.executionRows.map((row) => row.id)
      }))
      return perSource.flat()
    })(),
  ])
  const ejecucion = scoped?.annual.percent ?? null
  const { verificacion, cierre } = await computeVerificacionYCierre(executionIds)

  return weightIntegral(program, { ejecucion, verificacion, cierre })
}

/**
 * I12: indicador e integral de un programa en una faena con **un solo**
 * cálculo. La ficha del programa y la foto del cierre de mes pedían los dos por
 * separado, y el integral volvía a calcular el indicador completo para sacar su
 * eje de ejecución y a cargar las ejecuciones para los otros dos. Acá los tres
 * ejes salen de las mismas entradas: `ejecucion` es el `annual.percent` del
 * indicador y verificación/cierre miran exactamente sus ejecuciones aprobadas
 * (mismo corte por faena y misma ventana de versión).
 *
 * Es idéntico a pedir `getPdtpComplianceIndicators` y `getPdtpIntegralCompliance`
 * por separado (lo fija `pdtp-compliance-performance.test.ts`).
 */
export async function getPdtpComplianceWithIntegral(
  yearOrProgramId: number | string,
  worksiteId?: string,
): Promise<{ indicators: PdtpComplianceIndicators | null; integral: PdtpIntegralCompliance | null }> {
  const program = await resolveIndicatorProgram(yearOrProgramId)
  if (!program) return { indicators: null, integral: null }
  const inputs = (await loadPdtpIndicatorInputsForTargets(program, [worksiteId], await loadIndicatorVersionWindow(program.id))).get(worksiteId) ?? null
  const indicators = inputs ? computePdtpIndicatorsFromInputs(program, worksiteId, [inputs]) : emptyPdtpComplianceIndicators(program)
  // El indicador integral es formal: checklist y acciones también requieren
  // que la ejecución base haya sido aprobada.
  const { verificacion, cierre } = await computeVerificacionYCierre(inputs?.approvedExecutionIds ?? [])
  return {
    indicators,
    integral: weightIntegral(program, { ejecucion: indicators.annual.percent, verificacion, cierre }),
  }
}

/**
 * Calcula el cumplimiento integral del programa: 0.5*ejec + 0.3*verif + 0.2*cierre.
 * Los pesos vienen de pdtpPrograms (defaults 0.5/0.3/0.2). Quien necesita
 * también el indicador usa `getPdtpComplianceWithIntegral`.
 */
export async function getPdtpIntegralCompliance(
  yearOrProgramId: number | string,
  worksiteId?: string,
): Promise<PdtpIntegralCompliance | null> {
  return (await getPdtpComplianceWithIntegral(yearOrProgramId, worksiteId)).integral
}
