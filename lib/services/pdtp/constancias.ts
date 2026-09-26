/**
 * Submódulo Constancias (G17).
 *
 * Las actividades `mechanism = 'constancia'` no tienen dueño de datos en
 * ningún otro módulo: se hicieron o no se hicieron, y alguien lo marca acá.
 * Antes de esto no había ruta — `/prevencion/constancias` no existía, aunque
 * la cola operacional (D12) ya enviaba a los responsables a esa URL, así que
 * cada tarjeta de constancia en /pendientes terminaba en un 404.
 */
import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpPrograms, pdtpProgramWorksites, worksites } from "@/db/schema"
import { currentPdtpPeriod, filterPdtpRowsFromActivation, pdtpActivationPeriod, type PdtpPeriod } from "./period"
import { loadProgramScheduleAndExecutions, type WorksiteScope } from "./helpers"
import { resolveProgramWorksiteIds } from "./worksites"
import { getPdtpOperationalYears } from "./operational-years"

export type PdtpConstanciaDebt = {
  activityId: string
  n: number
  activityName: string
  evidenceRequirement: string | null
  manualEvidencePolicy: string
  responsibleDisplay: string
  worksiteId: string
  worksiteName: string
  /** PREV-C03.7: año del programa al que pertenece la deuda (puede ser el año en cierre). */
  programYear: number
  /** Corte de activación del programa de esa deuda, para el formulario. */
  effectiveFrom: PdtpPeriod | null
  /** Primer mes impago, ≤ mes en curso — misma regla que `impago.mes` en
   * operational-work-queue.ts (D12), para que esta lista y el badge de
   * /pendientes cuenten exactamente lo mismo. */
  dueMonth: number
  /** La semana de `pdtp_activity_schedule` que dejó planificado `dueMonth`
   * (la menor con `plannedQuantity > 0` para ese mes): es la celda real que
   * `PdtpDeviationForm` necesita para declarar "no se hizo"/"no aplica", no
   * un valor por defecto inventado. */
  dueWeek: number
  status: "pending" | "overdue"
  overdueMonths: number
}

export type PdtpConstanciaView = {
  programId: string
  programYear: number
  /** Recorta los meses/semanas ofrecidos en el formulario: no se puede
   * marcar una constancia en un período anterior a la activación. */
  effectiveFrom: PdtpPeriod | null
  /**
   * PREV-C03.7: el año anterior, cuando sigue activo sin cierre anual mientras
   * el nuevo ya opera. Sus deudas vienen en `debts` rotuladas con su año: las
   * constancias de diciembre vencen justo en enero y no pueden desaparecer.
   */
  closingYear: number | null
  debts: PdtpConstanciaDebt[]
}

type ProgramRow = typeof pdtpPrograms.$inferSelect

async function activeProgramOfYear(year: number): Promise<ProgramRow | null> {
  const [program] = await db.select().from(pdtpPrograms)
    .where(and(eq(pdtpPrograms.status, "active"), eq(pdtpPrograms.year, year)))
    .orderBy(desc(pdtpPrograms.version))
    .limit(1)
  return program ?? null
}

/**
 * Las deudas de UN programa, contando los meses hasta `throughMonth` (el mes en
 * curso, o diciembre si el año del programa ya terminó).
 */
async function programConstanciaDebts(program: ProgramRow, scope: WorksiteScope, throughMonth: number): Promise<PdtpConstanciaDebt[]> {
  const activities = await db.select().from(pdtpActivities).where(and(
    eq(pdtpActivities.programId, program.id),
    eq(pdtpActivities.status, "active"),
    eq(pdtpActivities.mechanism, "constancia"),
    eq(pdtpActivities.scheduleMode, "scheduled"),
  ))
  if (activities.length === 0) return []
  const activityIds = activities.map((activity) => activity.id)

  const [members, allActiveWorksites] = await Promise.all([
    db.select({ worksiteId: pdtpProgramWorksites.worksiteId }).from(pdtpProgramWorksites)
      .where(and(eq(pdtpProgramWorksites.programId, program.id), eq(pdtpProgramWorksites.isActive, true))),
    db.select({ id: worksites.id }).from(worksites).where(eq(worksites.isActive, true)),
  ])
  const worksiteIds = resolveProgramWorksiteIds(
    members.map((member) => member.worksiteId),
    scope,
    allActiveWorksites.map((worksite) => worksite.id),
    program.appliesToAllWorksites,
  )
  if (worksiteIds.length === 0) return []

  const worksiteRows = await db.select({ id: worksites.id, name: worksites.name })
    .from(worksites).where(inArray(worksites.id, worksiteIds))
  const worksiteNameById = new Map(worksiteRows.map((worksite) => [worksite.id, worksite.name]))

  const activityById = new Map(activities.map((activity) => [activity.id, activity]))
  const effectiveFrom = pdtpActivationPeriod(program.activatedAt)
  const debts: PdtpConstanciaDebt[] = []

  const perWorksite = await Promise.all(
    worksiteIds.map((worksiteId) => loadProgramScheduleAndExecutions(activityIds, program.year, worksiteId)
      .then((loaded) => ({ worksiteId, ...loaded }))),
  )
  for (const { worksiteId, scheduleRows, executionRows } of perWorksite) {
    for (const activityId of activityIds) {
      const activity = activityById.get(activityId)
      if (!activity) continue
      const plannedCells = filterPdtpRowsFromActivation(scheduleRows, program.activatedAt)
        .filter((row) => row.activityId === activityId
          && row.year === program.year
          && row.month <= throughMonth
          && row.plannedQuantity > 0)
        .map((row) => ({ month: row.month, week: row.week }))
      if (plannedCells.length === 0) continue
      const plannedMonths = plannedCells.map((cell) => cell.month)
      const paidMonths = new Set(
        executionRows
          .filter((row) => row.activityId === activityId && row.executedQuantity > 0
            && (row.status === "submitted" || row.status === "approved"))
          .map((row) => row.month),
      )
      const unpaidMonths = plannedMonths.filter((month) => !paidMonths.has(month)).sort((a, b) => a - b)
      const dueMonth = unpaidMonths[0]
      if (dueMonth === undefined) continue
      // La semana más baja planificada para `dueMonth`: si el mes tiene más de
      // una celda planificada (raro en constancia, pero posible), se declara
      // sobre la primera — la misma que el badge de /pendientes considera
      // vencida antes que las demás.
      const dueWeek = Math.min(...plannedCells.filter((cell) => cell.month === dueMonth).map((cell) => cell.week))
      // Un año ya terminado no tiene "mes en curso": todo lo impago está vencido.
      const yearIsOver = throughMonth === 12 && program.year < currentPdtpPeriod().year
      debts.push({
        activityId,
        n: activity.n,
        activityName: activity.activity,
        evidenceRequirement: activity.evidenceRequirement,
        manualEvidencePolicy: activity.manualEvidencePolicy,
        responsibleDisplay: activity.responsibleDisplay,
        worksiteId,
        worksiteName: worksiteNameById.get(worksiteId) ?? worksiteId,
        programYear: program.year,
        effectiveFrom,
        dueMonth,
        dueWeek,
        status: yearIsOver || dueMonth < throughMonth ? "overdue" : "pending",
        overdueMonths: unpaidMonths.filter((month) => yearIsOver || month < throughMonth).length,
      })
    }
  }
  return debts
}

/**
 * Lista, por (actividad, faena), la deuda de constancia abierta hoy: una
 * fila por el primer mes impago, no una por cada mes vencido, para no
 * inundar la pantalla con la misma deuda repetida.
 *
 * PREV-C03.7: el programa es el del año operativo, y si el año anterior sigue
 * con cierre pendiente se suman sus deudas (rotuladas por año).
 */
export async function listPdtpConstanciaActivities(scope: WorksiteScope): Promise<PdtpConstanciaView | null> {
  if (scope !== "all" && scope.length === 0) return null
  const period = currentPdtpPeriod()
  const { primary, closing } = await getPdtpOperationalYears()
  const program = await activeProgramOfYear(primary)
  if (!program) return null
  const closingProgram = closing ? await activeProgramOfYear(closing) : null
  const throughMonthFor = (year: number) => (year < period.year ? 12 : period.month)

  const debts = [
    ...await programConstanciaDebts(program, scope, throughMonthFor(program.year)),
    ...(closingProgram ? await programConstanciaDebts(closingProgram, scope, 12) : []),
  ]
  debts.sort((a, b) => (
    (a.status === "overdue" ? 0 : 1) - (b.status === "overdue" ? 0 : 1)
    || a.programYear - b.programYear
    || a.n - b.n
    || a.worksiteName.localeCompare(b.worksiteName, "es-CL")
  ))

  return {
    programId: program.id,
    programYear: program.year,
    effectiveFrom: pdtpActivationPeriod(program.activatedAt),
    closingYear: closingProgram?.year ?? null,
    debts,
  }
}

/**
 * Compuerta de alcance para `markPdtpExecution` cuando quien registra sólo
 * tiene `prevention:constancias:execute` y no `prevention:pdtp:execute`: sin
 * esto, un permiso pensado para marcar constancias serviría para registrar
 * cumplimiento de cualquier actividad de la planilla con sólo construir el
 * POST a mano — el botón de la UI ya lo evita, pero el server action no lo
 * exigía por su cuenta.
 */
export async function assertPdtpActivityMechanism(activityId: string, mechanism: string): Promise<void> {
  const [activity] = await db.select({ mechanism: pdtpActivities.mechanism })
    .from(pdtpActivities).where(eq(pdtpActivities.id, activityId)).limit(1)
  if (!activity || activity.mechanism !== mechanism) {
    throw new Error("Esta actividad no se puede registrar desde Constancias.")
  }
}
