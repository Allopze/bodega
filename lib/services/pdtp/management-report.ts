/**
 * Reporte de gestión (Fase 6.4): resumen por objetivo — avance, desviaciones
 * y responsables — con la estructura que mejor comunica la gestión, no la
 * distribución del archivo de origen (esa es responsabilidad del perfil de
 * compatibilidad 2026 opcional, §6.6, todavía no construido).
 */
import { desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpPrograms } from "@/db/schema"
import { assertWorksiteAccess, loadProgramScheduleAndExecutions, type WorksiteScope } from "./helpers"

export type PdtpManagementReportObjectiveRow = {
  objectiveOrder: number
  objective: string
  activityCount: number
  planned: number
  executed: number
  percent: number | null
  meetsTarget: boolean
  responsibles: string[]
}

export type PdtpManagementReportFilters = {
  responsibleSlug?: string
  objectiveOrder?: number
  /** "meets" = cumple la meta del programa; "deviates" = por debajo. */
  status?: "meets" | "deviates"
  monthFrom?: number
  monthTo?: number
}

export type PdtpManagementReport = {
  programId: string
  programTitle: string
  year: number
  worksiteId: string
  target: number
  objectives: PdtpManagementReportObjectiveRow[]
  indicatorDefinitions: Array<{ code: string; label: string; formula: string }>
}

const INDICATOR_DEFINITIONS = [
  {
    code: "avance_objetivo",
    label: "Avance por objetivo",
    formula: "Suma de cantidades ejecutadas y aprobadas de las actividades calendarizadas del objetivo / suma de cantidades planificadas (con excepciones vigentes aplicadas), en el período filtrado.",
  },
  {
    code: "desviacion",
    label: "Desviación",
    formula: "Un objetivo se marca en desviación cuando su avance es menor a la meta de cumplimiento configurada en el programa.",
  },
]

/**
 * Agrupa el avance calendarizado por objetivo para una faena autorizada.
 * Reusa `loadProgramScheduleAndExecutions` (ya correcto por-faena); no
 * incluye trabajo a demanda/disparado (ese indicador vive aparte, §4.3/6.1).
 */
export async function getPdtpManagementReport(input: {
  programId: string
  worksiteId: string
  scope: WorksiteScope
  filters?: PdtpManagementReportFilters
}): Promise<PdtpManagementReport | null> {
  assertWorksiteAccess(input.worksiteId, input.scope)

  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, input.programId)).limit(1)
  if (!program) return null

  const activities = await db.select().from(pdtpActivities)
    .where(eq(pdtpActivities.programId, program.id))
    .orderBy(pdtpActivities.objectiveOrder, pdtpActivities.n)
  if (activities.length === 0) {
    return { programId: program.id, programTitle: program.title, year: program.year, worksiteId: input.worksiteId, target: program.complianceTarget, objectives: [], indicatorDefinitions: INDICATOR_DEFINITIONS }
  }

  const filters = input.filters ?? {}
  const scheduledActivities = activities.filter((activity) => {
    if (activity.scheduleMode !== "scheduled") return false
    if (filters.responsibleSlug && !(activity.responsibleSlugs as string[]).includes(filters.responsibleSlug)) return false
    if (filters.objectiveOrder !== undefined && activity.objectiveOrder !== filters.objectiveOrder) return false
    return true
  })

  const activityIds = scheduledActivities.map((a) => a.id)
  const { scheduleRows, executionRows } = activityIds.length > 0
    ? await loadProgramScheduleAndExecutions(activityIds, program.year, input.worksiteId)
    : { scheduleRows: [], executionRows: [] }
  const approvedExecutions = executionRows.filter((row) => row.status === "approved")

  const inPeriod = (month: number) => (filters.monthFrom === undefined || month >= filters.monthFrom) && (filters.monthTo === undefined || month <= filters.monthTo)

  const plannedByActivity = new Map<string, number>()
  for (const row of scheduleRows) {
    if (!inPeriod(row.month)) continue
    plannedByActivity.set(row.activityId, (plannedByActivity.get(row.activityId) ?? 0) + row.plannedQuantity)
  }
  const executedByActivity = new Map<string, number>()
  for (const row of approvedExecutions) {
    if (!inPeriod(row.month)) continue
    executedByActivity.set(row.activityId, (executedByActivity.get(row.activityId) ?? 0) + row.executedQuantity)
  }

  const byObjective = new Map<number, { objective: string; activities: typeof scheduledActivities }>()
  for (const activity of scheduledActivities) {
    const entry = byObjective.get(activity.objectiveOrder) ?? { objective: activity.objective, activities: [] }
    entry.activities.push(activity)
    byObjective.set(activity.objectiveOrder, entry)
  }

  const objectives: PdtpManagementReportObjectiveRow[] = [...byObjective.entries()]
    .sort(([a], [b]) => a - b)
    .map(([objectiveOrder, { objective, activities: objectiveActivities }]) => {
      const planned = objectiveActivities.reduce((sum, a) => sum + (plannedByActivity.get(a.id) ?? 0), 0)
      const executed = Math.min(
        objectiveActivities.reduce((sum, a) => sum + (executedByActivity.get(a.id) ?? 0), 0),
        planned,
      )
      const percent = planned > 0 ? Math.round((executed / planned) * 100) / 100 : null
      const meetsTarget = percent !== null && percent >= program.complianceTarget
      const responsibles = [...new Set(objectiveActivities.map((a) => a.responsibleDisplay).filter(Boolean))]
      return { objectiveOrder, objective, activityCount: objectiveActivities.length, planned, executed, percent, meetsTarget, responsibles }
    })
    .filter((row) => {
      if (filters.status === "meets") return row.meetsTarget
      if (filters.status === "deviates") return !row.meetsTarget
      return true
    })

  return {
    programId: program.id,
    programTitle: program.title,
    year: program.year,
    worksiteId: input.worksiteId,
    target: program.complianceTarget,
    objectives,
    indicatorDefinitions: INDICATOR_DEFINITIONS,
  }
}

/** Programa activo (o el más reciente) de un año, para resolver el reporte sin pedir un programId explícito. */
export async function resolveActivePdtpProgramId(year: number): Promise<string | null> {
  const programs = await db.select({ id: pdtpPrograms.id, status: pdtpPrograms.status }).from(pdtpPrograms)
    .where(eq(pdtpPrograms.year, year)).orderBy(desc(pdtpPrograms.version)).limit(10)
  return programs.find((p) => p.status === "active")?.id ?? programs[0]?.id ?? null
}
