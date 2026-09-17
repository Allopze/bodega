/**
 * Reporte de gestión: avance y desviaciones por actividad
 * y responsables — con la estructura que mejor comunica la gestión, no la
 * distribución del archivo de origen (esa es responsabilidad del perfil de
 * compatibilidad 2026 opcional, §6.6, todavía no construido).
 */
import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpActivityWorksiteParams, pdtpPrograms } from "@/db/schema"
import { assertWorksiteAccess, loadProgramScheduleAndExecutions, type WorksiteScope } from "./helpers"
import { assertPdtpWorksiteCanOperateProgram } from "./worksites"
import { filterPdtpRowsFromActivation } from "./period"

export type PdtpManagementReportActivityRow = {
  activityNumber: number
  activity: string
  planned: number
  executed: number
  percent: number | null
  meetsTarget: boolean
  responsibles: string[]
  /**
   * Desvíos activos de la actividad dentro del período filtrado. Responde la
   * pregunta que el reporte dejaba abierta: una actividad "En desviación"
   * ¿quedó así porque nadie hizo nada, o porque se declaró por qué? Los tres
   * tipos ya están reflejados en `planned`/`executed` a través de la costura
   * única (`not_applicable` y `reprogrammed` cambian el planificado;
   * `not_performed` no), así que este conteo no corrige el avance: lo explica.
   */
  deviations: { notPerformed: number; notApplicable: number; reprogrammed: number }
}

export type PdtpManagementReportFilters = {
  responsibleSlug?: string
  activityNumber?: number
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
  activities: PdtpManagementReportActivityRow[]
  responsibleOptions: Array<{ value: string; label: string }>
  activityOptions: Array<{ value: number; label: string }>
  indicatorDefinitions: Array<{ code: string; label: string; formula: string }>
}

const INDICATOR_DEFINITIONS = [
  {
    code: "avance_actividad",
    label: "Avance por actividad",
    formula: "Cantidad ejecutada y aprobada / cantidad planificada de la actividad, con ajustes de faena aplicados, en el período filtrado.",
  },
  {
    code: "desviacion",
    label: "Desviación",
    formula: "Una actividad se marca en desviación cuando su avance es menor a la meta de cumplimiento configurada en el programa.",
  },
]

/**
 * Calcula el avance calendarizado por actividad para una faena autorizada.
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
  await assertPdtpWorksiteCanOperateProgram(program.id, input.worksiteId)

  const activities = await db.select().from(pdtpActivities)
    .where(eq(pdtpActivities.programId, program.id))
    .orderBy(pdtpActivities.displayOrder, pdtpActivities.n)
  if (activities.length === 0) {
    return {
      programId: program.id,
      programTitle: program.title,
      year: program.year,
      worksiteId: input.worksiteId,
      target: program.complianceTarget,
      activities: [],
      responsibleOptions: [],
      activityOptions: [],
      indicatorDefinitions: INDICATOR_DEFINITIONS,
    }
  }

  const filters = input.filters ?? {}
  const allScheduledActivities = activities.filter((activity) => activity.scheduleMode === "scheduled")
  const paramsRows = allScheduledActivities.length > 0
    ? await db.select().from(pdtpActivityWorksiteParams).where(and(
        inArray(pdtpActivityWorksiteParams.activityId, allScheduledActivities.map((activity) => activity.id)),
        eq(pdtpActivityWorksiteParams.worksiteId, input.worksiteId),
      ))
    : []
  const paramsByActivity = new Map(paramsRows.map((row) => [row.activityId, row]))
  const effectiveResponsibleByActivity = new Map(allScheduledActivities.map((activity) => {
    const params = paramsByActivity.get(activity.id)
    const overrideSlugs = Array.isArray(params?.responsibleSlugs)
      ? params.responsibleSlugs.filter((value): value is string => typeof value === "string")
      : null
    return [activity.id, {
      slugs: overrideSlugs ?? (activity.responsibleSlugs as string[]),
      display: overrideSlugs ? params?.responsibleDisplay ?? activity.responsibleDisplay : activity.responsibleDisplay,
    }] as const
  }))
  const responsibleOptionMap = new Map<string, string>()
  for (const activity of allScheduledActivities) {
    const responsible = effectiveResponsibleByActivity.get(activity.id)!
    for (const slug of responsible.slugs) responsibleOptionMap.set(slug, responsible.display)
  }
  const responsibleOptions = [...responsibleOptionMap]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"))
  const activityOptions = allScheduledActivities.map((activity) => ({
    value: activity.n,
    label: `${activity.n}. ${activity.activity}`,
  }))
  const scheduledActivities = allScheduledActivities.filter((activity) => {
    if (filters.activityNumber !== undefined && activity.n !== filters.activityNumber) return false
    if (filters.responsibleSlug && !effectiveResponsibleByActivity.get(activity.id)!.slugs.includes(filters.responsibleSlug)) return false
    return true
  })

  const activityIds = scheduledActivities.map((a) => a.id)
  const loaded = activityIds.length > 0
    ? await loadProgramScheduleAndExecutions(activityIds, program.year, input.worksiteId)
    : { scheduleRows: [], executionRows: [], deviationRows: [] }
  const scheduleRows = filterPdtpRowsFromActivation(loaded.scheduleRows, program.activatedAt)
  const executionRows = filterPdtpRowsFromActivation(loaded.executionRows, program.activatedAt)
  const deviationRows = filterPdtpRowsFromActivation(loaded.deviationRows, program.activatedAt)
  const approvedExecutions = executionRows.filter((row) => row.status === "approved")

  const inPeriod = (month: number) => (filters.monthFrom === undefined || month >= filters.monthFrom) && (filters.monthTo === undefined || month <= filters.monthTo)

  const deviationsByActivity = new Map<string, { notPerformed: number; notApplicable: number; reprogrammed: number }>()
  for (const row of deviationRows) {
    // Se cuenta por la celda de ORIGEN: una reprogramación se declara sobre la
    // semana que no se va a cumplir, y ésa es la que el filtro de meses
    // selecciona. Contarla además en el destino la duplicaría.
    if (!inPeriod(row.month)) continue
    const entry = deviationsByActivity.get(row.activityId) ?? { notPerformed: 0, notApplicable: 0, reprogrammed: 0 }
    if (row.kind === "not_performed") entry.notPerformed += 1
    else if (row.kind === "not_applicable") entry.notApplicable += 1
    else entry.reprogrammed += 1
    deviationsByActivity.set(row.activityId, entry)
  }

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

  const reportActivities: PdtpManagementReportActivityRow[] = scheduledActivities
    .map((activity) => {
      const planned = plannedByActivity.get(activity.id) ?? 0
      const executed = Math.min(executedByActivity.get(activity.id) ?? 0, planned)
      const percent = planned > 0 ? Math.round((executed / planned) * 100) / 100 : null
      const meetsTarget = percent !== null && percent >= program.complianceTarget
      const responsible = effectiveResponsibleByActivity.get(activity.id)!
      return {
        activityNumber: activity.n,
        activity: activity.activity,
        planned,
        executed,
        percent,
        meetsTarget,
        responsibles: responsible.display ? [responsible.display] : [],
        deviations: deviationsByActivity.get(activity.id) ?? { notPerformed: 0, notApplicable: 0, reprogrammed: 0 },
      }
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
    activities: reportActivities,
    responsibleOptions,
    activityOptions,
    indicatorDefinitions: INDICATOR_DEFINITIONS,
  }
}

/** Programa activo (o el más reciente) de un año, para resolver el reporte sin pedir un programId explícito. */
export async function resolveActivePdtpProgramId(year: number): Promise<string | null> {
  const programs = await db.select({ id: pdtpPrograms.id, status: pdtpPrograms.status }).from(pdtpPrograms)
    .where(eq(pdtpPrograms.year, year)).orderBy(desc(pdtpPrograms.version)).limit(10)
  return programs.find((p) => p.status === "active")?.id ?? programs[0]?.id ?? null
}
