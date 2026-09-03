/**
 * Submódulo Constancias (G17).
 *
 * Las actividades `mechanism = 'constancia'` no tienen dueño de datos en
 * ningún otro módulo: se hicieron o no se hicieron, y alguien lo marca acá.
 * Antes de esto no había ruta — `/prevencion/constancias` no existía, aunque
 * la cola operacional (D12) ya enviaba a los responsables a esa URL, así que
 * cada tarjeta de constancia en /pendientes terminaba en un 404.
 */
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpPrograms, pdtpProgramWorksites, worksites } from "@/db/schema"
import { currentPdtpPeriod, pdtpActivationPeriod, type PdtpPeriod } from "./period"
import { loadProgramScheduleAndExecutions, type WorksiteScope } from "./helpers"
import { resolveProgramWorksiteIds } from "./worksites"

export type PdtpConstanciaDebt = {
  activityId: string
  n: number
  activityName: string
  evidenceRequirement: string | null
  responsibleDisplay: string
  worksiteId: string
  worksiteName: string
  /** Primer mes impago, ≤ mes en curso — misma regla que `impago.mes` en
   * operational-work-queue.ts (D12), para que esta lista y el badge de
   * /pendientes cuenten exactamente lo mismo. */
  dueMonth: number
  status: "pending" | "overdue"
  overdueMonths: number
}

export type PdtpConstanciaView = {
  programId: string
  programYear: number
  /** Recorta los meses/semanas ofrecidos en el formulario: no se puede
   * marcar una constancia en un período anterior a la activación. */
  effectiveFrom: PdtpPeriod | null
  debts: PdtpConstanciaDebt[]
}

/**
 * Lista, por (actividad, faena), la deuda de constancia abierta hoy: una
 * fila por el primer mes impago, no una por cada mes vencido, para no
 * inundar la pantalla con la misma deuda repetida.
 */
export async function listPdtpConstanciaActivities(scope: WorksiteScope): Promise<PdtpConstanciaView | null> {
  if (scope !== "all" && scope.length === 0) return null
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.status, "active")).limit(1)
  if (!program) return null

  const activities = await db.select().from(pdtpActivities).where(and(
    eq(pdtpActivities.programId, program.id),
    eq(pdtpActivities.status, "active"),
    eq(pdtpActivities.mechanism, "constancia"),
    eq(pdtpActivities.scheduleMode, "scheduled"),
  ))
  const empty: PdtpConstanciaView = {
    programId: program.id, programYear: program.year,
    effectiveFrom: pdtpActivationPeriod(program.activatedAt), debts: [],
  }
  if (activities.length === 0) return empty
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
  )
  if (worksiteIds.length === 0) return empty

  const worksiteRows = await db.select({ id: worksites.id, name: worksites.name })
    .from(worksites).where(inArray(worksites.id, worksiteIds))
  const worksiteNameById = new Map(worksiteRows.map((worksite) => [worksite.id, worksite.name]))

  const period = currentPdtpPeriod()
  const activityById = new Map(activities.map((activity) => [activity.id, activity]))
  const debts: PdtpConstanciaDebt[] = []

  const perWorksite = await Promise.all(
    worksiteIds.map((worksiteId) => loadProgramScheduleAndExecutions(activityIds, program.year, worksiteId)
      .then((loaded) => ({ worksiteId, ...loaded }))),
  )
  for (const { worksiteId, scheduleRows, executionRows } of perWorksite) {
    for (const activityId of activityIds) {
      const activity = activityById.get(activityId)
      if (!activity) continue
      const plannedMonths = scheduleRows
        .filter((row) => row.activityId === activityId && row.month <= period.month && row.plannedQuantity > 0)
        .map((row) => row.month)
      if (plannedMonths.length === 0) continue
      const paidMonths = new Set(
        executionRows
          .filter((row) => row.activityId === activityId && row.executedQuantity > 0
            && (row.status === "submitted" || row.status === "approved"))
          .map((row) => row.month),
      )
      const unpaidMonths = plannedMonths.filter((month) => !paidMonths.has(month)).sort((a, b) => a - b)
      const dueMonth = unpaidMonths[0]
      if (dueMonth === undefined) continue
      debts.push({
        activityId,
        n: activity.n,
        activityName: activity.activity,
        evidenceRequirement: activity.evidenceRequirement,
        responsibleDisplay: activity.responsibleDisplay,
        worksiteId,
        worksiteName: worksiteNameById.get(worksiteId) ?? worksiteId,
        dueMonth,
        status: dueMonth < period.month ? "overdue" : "pending",
        overdueMonths: unpaidMonths.filter((month) => month < period.month).length,
      })
    }
  }

  debts.sort((a, b) => (
    (a.status === "overdue" ? 0 : 1) - (b.status === "overdue" ? 0 : 1)
    || a.n - b.n
    || a.worksiteName.localeCompare(b.worksiteName, "es-CL")
  ))

  return { programId: program.id, programYear: program.year, effectiveFrom: pdtpActivationPeriod(program.activatedAt), debts }
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
