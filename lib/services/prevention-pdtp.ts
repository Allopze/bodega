/**
 * lib/services/prevention-pdtp.ts
 * Programa de Trabajo Preventivo SG-SST: carga de catálogo y base del cronograma.
 */

import { and, desc, eq, inArray } from "drizzle-orm"
import { db, type DB } from "@/db"
import {
  pdtpActivities,
  pdtpActivitySchedule,
  pdtpExecutions,
  pdtpPrograms,
  pdtpResponsibleCatalog,
  pdtpSheetActivities,
  pdtpSheets,
} from "@/db/schema"
import type { PdtpCatalog, PdtpSheetCode } from "@/lib/services/prevention-pdtp-catalog"
import type { ReportData, ReportCell } from "@/lib/reports/export"
import { pdtpExecutionSchema } from "@/lib/validation/prevention"

type LoadPdtpCatalogInput = {
  year: number
  version: number
  title: string
  catalog: PdtpCatalog
  userId: string
}

export type WorksiteScope = string[] | "all"

export type PdtpSheetView = {
  program: typeof pdtpPrograms.$inferSelect
  sheet: typeof pdtpSheets.$inferSelect
  activities: Array<typeof pdtpActivities.$inferSelect & {
    schedule: Array<typeof pdtpActivitySchedule.$inferSelect>
    totalPlanned: number
    totalExecuted: number
    monthlyPlanned: number[]
    monthlyExecuted: number[]
  }>
  monthlyTotals: Array<{ month: number; planned: number; executed: number; percent: number | null }>
}

const SHEET_META: Record<PdtpSheetCode, { label: string; area: string; defaultScopeRoles: string[] }> = {
  pdtp_general: { label: "Programa preventivo general", area: "prevencion", defaultScopeRoles: ["prevencionista", "administrador"] },
  cphs: { label: "Comité Paritario de Higiene y Seguridad", area: "prevencion", defaultScopeRoles: ["cphs", "prevencionista", "admin_contrato"] },
  prf_adm_contrato: {
    label: "Prevencionista de faena y administración de contrato",
    area: "prevencion",
    defaultScopeRoles: ["prevencionista_faena", "admin_contrato"],
  },
  sup_jt: { label: "Supervisión y jefatura de terreno", area: "prevencion", defaultScopeRoles: ["supervisor_faena", "jefe_terreno"] },
  prf: { label: "Prevencionista de riesgos en faena", area: "prevencion", defaultScopeRoles: ["prevencionista_faena"] },
  adm_contrato: { label: "Administración de contrato", area: "prevencion", defaultScopeRoles: ["admin_contrato"] },
  subgerente: { label: "Subgerencia de operaciones y mantenimiento", area: "subgerencia", defaultScopeRoles: ["jefa_chome"] },
  capacitacion: { label: "Capacitación y campañas", area: "capacitacion", defaultScopeRoles: ["prevencionista_faena"] },
}

const SHEET_EXPORT_NAMES: Record<PdtpSheetCode, string> = {
  pdtp_general: "Programa preventivo",
  cphs: "Comité Paritario Higiene SST",
  prf_adm_contrato: "Prevención y contrato",
  sup_jt: "Supervisión y terreno",
  prf: "Prevención faena",
  adm_contrato: "Administración contrato",
  subgerente: "Subgerencia operaciones",
  capacitacion: "Capacitación y campañas",
}

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

const ROLE_RESPONSIBLE_SLUGS = new Map<string, string>([
  ["admin_contrato", "admin_contrato"],
  ["cphs", "cphs"],
  ["gerente_legal_rrhh", "jefa_chome"],
  ["jdpr", "prevencionista"],
  ["jm", "jefe_mantencion"],
  ["jt", "jefe_terreno"],
  ["prf", "prevencionista_faena"],
  ["subgerente_operaciones", "jefa_chome"],
  ["sup", "supervisor_faena"],
])

export async function loadPdtpCatalog(input: LoadPdtpCatalogInput, database: DB = db) {
  const now = new Date().toISOString()
  const programId = pdtpProgramId(input.year, input.version)

  const [program] = await database.insert(pdtpPrograms)
    .values({
      id: programId,
      year: input.year,
      version: input.version,
      status: "draft",
      title: input.title,
      elaboratedByUserId: input.userId,
      elaboratedByName: "Lorena Alvarado Cornejo",
      elaboratedByTitle: "Jefa Dpto. Prevención de Riesgos",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [pdtpPrograms.year, pdtpPrograms.version],
      set: {
        title: input.title,
        elaboratedByUserId: input.userId,
        updatedAt: now,
      },
    })
    .returning()

  if (!program) throw new Error("No se pudo cargar el programa PDTP.")

  for (const responsible of collectResponsibleCatalog(input.catalog)) {
    await database.insert(pdtpResponsibleCatalog)
      .values(responsible)
      .onConflictDoUpdate({
        target: pdtpResponsibleCatalog.slug,
        set: {
          displayName: responsible.displayName,
          roleName: responsible.roleName,
          kind: responsible.kind,
          notes: responsible.notes,
        },
      })
  }

  for (const [code, meta] of Object.entries(SHEET_META) as Array<[PdtpSheetCode, typeof SHEET_META[PdtpSheetCode]]>) {
    await database.insert(pdtpSheets)
      .values({
        code,
        label: meta.label,
        area: meta.area,
        defaultScopeRoles: meta.defaultScopeRoles,
      })
      .onConflictDoUpdate({
        target: pdtpSheets.code,
        set: {
          label: meta.label,
          area: meta.area,
          defaultScopeRoles: meta.defaultScopeRoles,
        },
      })
  }

  const activityIdByNumber = new Map<number, string>()

  for (const activity of input.catalog.activities) {
    const activityId = pdtpActivityId(program.id, activity.n)
    activityIdByNumber.set(activity.n, activityId)

    await database.insert(pdtpActivities)
      .values({
        id: activityId,
        programId: program.id,
        n: activity.n,
        objectiveOrder: activity.objectiveOrder,
        objective: activity.objective,
        activity: activity.activity,
        program: activity.program,
        responsibleSlugs: activity.responsibleSlugs,
        responsibleDisplay: displayNameForActivity(activity.responsibleSlugs, activity.responsibleDisplay),
        sourceSheetRow: activity.sourceSheetRow,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [pdtpActivities.programId, pdtpActivities.n],
        set: {
          objectiveOrder: activity.objectiveOrder,
          objective: activity.objective,
          activity: activity.activity,
          program: activity.program,
          responsibleSlugs: activity.responsibleSlugs,
          responsibleDisplay: displayNameForActivity(activity.responsibleSlugs, activity.responsibleDisplay),
          sourceSheetRow: activity.sourceSheetRow,
          updatedAt: now,
        },
      })

    for (const cell of activity.schedule) {
      await database.insert(pdtpActivitySchedule)
        .values({
          id: pdtpScheduleId(activityId, input.year, cell.month, cell.week),
          activityId,
          year: input.year,
          month: cell.month,
          week: cell.week,
          plannedQuantity: cell.plannedQuantity,
          sourceColumn: cell.sourceColumn,
        })
        .onConflictDoUpdate({
          target: [pdtpActivitySchedule.activityId, pdtpActivitySchedule.year, pdtpActivitySchedule.month, pdtpActivitySchedule.week],
          set: {
            plannedQuantity: cell.plannedQuantity,
            sourceColumn: cell.sourceColumn,
          },
        })
    }
  }

  for (const [sheetCode, activityNumbers] of Object.entries(input.catalog.sheetActivities) as Array<[PdtpSheetCode, number[]]>) {
    for (const [index, activityNumber] of activityNumbers.entries()) {
      const activityId = activityIdByNumber.get(activityNumber)
      if (!activityId) throw new Error(`La hoja ${sheetCode} referencia actividad PDTP inexistente: ${activityNumber}.`)

      await database.insert(pdtpSheetActivities)
        .values({
          id: pdtpSheetActivityId(program.id, sheetCode, activityNumber),
          sheetCode,
          activityId,
          sheetRow: index + 1,
          displayOrder: index + 1,
        })
        .onConflictDoUpdate({
          target: [pdtpSheetActivities.sheetCode, pdtpSheetActivities.activityId],
          set: {
            sheetRow: index + 1,
            displayOrder: index + 1,
          },
        })
    }
  }

  return { program }
}

export async function getActivePdtpProgram(year: number) {
  const [program] = await db.select().from(pdtpPrograms).where(
    and(eq(pdtpPrograms.year, year), eq(pdtpPrograms.status, "active")),
  ).limit(1)

  return program ?? null
}

export async function getPdtpSheetView(year: number, sheetCode: PdtpSheetCode, worksiteId?: string): Promise<PdtpSheetView | null> {
  const [program] = await db.select().from(pdtpPrograms)
    .where(eq(pdtpPrograms.year, year))
    .orderBy(desc(pdtpPrograms.version))
    .limit(1)

  if (!program) return null

  const [sheet] = await db.select().from(pdtpSheets).where(eq(pdtpSheets.code, sheetCode)).limit(1)
  if (!sheet) return null

  const memberships = await db.select().from(pdtpSheetActivities)
    .where(eq(pdtpSheetActivities.sheetCode, sheetCode))
    .orderBy(pdtpSheetActivities.displayOrder)

  if (memberships.length === 0) {
    return {
      program,
      sheet,
      activities: [],
      monthlyTotals: emptyMonthlyTotals(),
    }
  }

  const activityIds = memberships.map((membership) => membership.activityId)
  const [activityRows, scheduleRows, executionRows] = await Promise.all([
    db.select().from(pdtpActivities).where(inArray(pdtpActivities.id, activityIds)),
    db.select().from(pdtpActivitySchedule).where(inArray(pdtpActivitySchedule.activityId, activityIds)),
    worksiteId
      ? db.select().from(pdtpExecutions).where(
          and(
            inArray(pdtpExecutions.activityId, activityIds),
            eq(pdtpExecutions.worksiteId, worksiteId),
            eq(pdtpExecutions.year, year),
          ),
        )
      : Promise.resolve([] as Array<typeof pdtpExecutions.$inferSelect>),
  ])

  const activityById = new Map(activityRows.map((activity) => [activity.id, activity]))
  const scheduleByActivity = new Map<string, Array<typeof pdtpActivitySchedule.$inferSelect>>()
  for (const schedule of scheduleRows) {
    const current = scheduleByActivity.get(schedule.activityId) ?? []
    current.push(schedule)
    scheduleByActivity.set(schedule.activityId, current)
  }
  const executionsByActivity = new Map<string, Array<typeof pdtpExecutions.$inferSelect>>()
  for (const execution of executionRows) {
    const current = executionsByActivity.get(execution.activityId) ?? []
    current.push(execution)
    executionsByActivity.set(execution.activityId, current)
  }

  const monthlyTotals = emptyMonthlyTotals()
  const activities = memberships.map((membership) => {
    const activity = activityById.get(membership.activityId)
    if (!activity) throw new Error(`Membresia PDTP referencia actividad inexistente: ${membership.activityId}.`)

    const schedule = (scheduleByActivity.get(activity.id) ?? [])
      .sort((a, b) => a.month - b.month || a.week - b.week)
    const monthlyPlanned = Array.from({ length: 12 }, () => 0)
    const monthlyExecuted = Array.from({ length: 12 }, () => 0)

    for (const cell of schedule) {
      monthlyPlanned[cell.month - 1] = (monthlyPlanned[cell.month - 1] ?? 0) + cell.plannedQuantity
      monthlyTotals[cell.month - 1]!.planned += cell.plannedQuantity
    }
    for (const execution of executionsByActivity.get(activity.id) ?? []) {
      monthlyExecuted[execution.month - 1] = (monthlyExecuted[execution.month - 1] ?? 0) + execution.executedQuantity
      monthlyTotals[execution.month - 1]!.executed += execution.executedQuantity
    }

    return {
      ...activity,
      schedule,
      monthlyPlanned,
      monthlyExecuted,
      totalPlanned: monthlyPlanned.reduce((sum, value) => sum + value, 0),
      totalExecuted: monthlyExecuted.reduce((sum, value) => sum + value, 0),
    }
  })

  for (const month of monthlyTotals) {
    month.percent = month.planned > 0 ? Math.round((month.executed / month.planned) * 100) : null
  }

  return {
    program,
    sheet,
    activities,
    monthlyTotals,
  }
}

export async function markPdtpExecution(input: unknown, userId: string, scope: WorksiteScope) {
  const data = pdtpExecutionSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)

  const now = new Date().toISOString()
  const id = pdtpExecutionId(data.activityId, data.worksiteId, data.year, data.month, data.week)

  const [row] = await db.insert(pdtpExecutions)
    .values({
      id,
      activityId: data.activityId,
      worksiteId: data.worksiteId,
      year: data.year,
      month: data.month,
      week: data.week,
      executedQuantity: data.executedQuantity,
      status: "submitted",
      evidenceText: data.evidenceText || null,
      evidenceUrl: data.evidenceUrl || null,
      evidencePhotos: data.evidencePhotos,
      executedByUserId: userId,
      executedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [pdtpExecutions.activityId, pdtpExecutions.worksiteId, pdtpExecutions.year, pdtpExecutions.month, pdtpExecutions.week],
      set: {
        executedQuantity: data.executedQuantity,
        status: "submitted",
        evidenceText: data.evidenceText || null,
        evidenceUrl: data.evidenceUrl || null,
        evidencePhotos: data.evidencePhotos,
        executedByUserId: userId,
        executedAt: now,
        updatedAt: now,
      },
    })
    .returning()

  if (!row) throw new Error("No se pudo registrar la ejecucion PDTP.")
  return row
}

export async function buildPdtpExport({
  year,
  sheetCode,
  worksiteId,
}: {
  year: number
  sheetCode: PdtpSheetCode
  worksiteId?: string
}): Promise<ReportData> {
  const view = await getPdtpSheetView(year, sheetCode, worksiteId)
  if (!view) {
    return {
      filenameBase: `pdtp-sg-sst-${year}-${sheetCode}`,
      worksheetName: SHEET_EXPORT_NAMES[sheetCode],
      headers: [],
      rows: [],
    }
  }

  const monthHeaders = MONTH_LABELS.flatMap((month) => [`${month} P`, `${month} E`])
  const headers = ["N°", "Objetivo", "Actividad", "Programa", "Responsables", ...monthHeaders, "Plan anual", "Ejecutado anual", "%"]
  const rows: ReportCell[][] = view.activities.map((activity) => {
    const monthly = MONTH_LABELS.flatMap((_, index) => [
      activity.monthlyPlanned[index] ?? 0,
      activity.monthlyExecuted[index] ?? 0,
    ])
    const percent = activity.totalPlanned > 0 ? Math.round((activity.totalExecuted / activity.totalPlanned) * 100) : null
    return [
      activity.n,
      activity.objective,
      activity.activity,
      activity.program,
      activity.responsibleDisplay,
      ...monthly,
      activity.totalPlanned,
      activity.totalExecuted,
      percent,
    ]
  })

  return {
    filenameBase: `pdtp-sg-sst-${year}-${sheetCode}`,
    worksheetName: SHEET_EXPORT_NAMES[sheetCode],
    headers,
    rows,
  }
}

export function assertWorksiteAccess(worksiteId: string, scope: WorksiteScope): void {
  if (scope === "all") return
  if (!scope.includes(worksiteId)) {
    throw new Error("Actividad PDTP no encontrada o sin acceso a la faena.")
  }
}

function emptyMonthlyTotals() {
  return Array.from({ length: 12 }, (_, index) => ({ month: index + 1, planned: 0, executed: 0, percent: null as number | null }))
}

function collectResponsibleCatalog(catalog: PdtpCatalog) {
  const bySlug = new Map<string, { slug: string; displayName: string; roleName: string | null; kind: string; notes: string | null }>()

  for (const activity of catalog.activities) {
    for (const slug of activity.responsibleSlugs) {
      if (bySlug.has(slug)) continue

      bySlug.set(slug, {
        slug,
        displayName: displayNameForSlug(slug, activity.responsibleDisplay),
        roleName: ROLE_RESPONSIBLE_SLUGS.get(slug) ?? null,
        kind: ROLE_RESPONSIBLE_SLUGS.has(slug) ? "rbac_role" : "worker_group",
        notes: "Responsable extraido desde PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx.",
      })
    }
  }

  return [...bySlug.values()]
}

function displayNameForSlug(slug: string, fallback: string) {
  if (slug === "conductores_operadores_choferes") return "Conductores, operadores y choferes"
  if (slug === "admin_contrato") return "Administración de contrato"
  if (slug === "subgerente_operaciones") return "Subgerencia de operaciones"
  if (slug === "gerente_legal_rrhh") return "Gerencia Legal y Recursos Humanos"
  if (slug === "jdpr") return "Jefatura del Departamento de Prevención de Riesgos"
  if (slug === "prf") return "Prevencionista de riesgos en faena"
  if (slug === "sup") return "Supervisión de faena"
  if (slug === "jt") return "Jefatura de terreno"
  if (slug === "cphs") return "Comité Paritario de Higiene y Seguridad"
  if (slug === "jm") return "Jefatura de mantenimiento"
  return fallback
}

function displayNameForActivity(slugs: string[], fallback: string) {
  if (slugs.length === 0) return fallback
  return slugs.map((slug) => displayNameForSlug(slug, slug.replace(/_/g, " "))).join(", ")
}

function pdtpProgramId(year: number, version: number) {
  return `pdtp-${year}-v${version}`
}

function pdtpActivityId(programId: string, activityNumber: number) {
  return `${programId}-a-${String(activityNumber).padStart(3, "0")}`
}

function pdtpScheduleId(activityId: string, year: number, month: number, week: number) {
  return `${activityId}-s-${year}-${String(month).padStart(2, "0")}-${week}`
}

function pdtpSheetActivityId(programId: string, sheetCode: PdtpSheetCode, activityNumber: number) {
  return `${programId}-${sheetCode}-a-${String(activityNumber).padStart(3, "0")}`
}

function pdtpExecutionId(activityId: string, worksiteId: string, year: number, month: number, week: number) {
  return `${activityId}-e-${worksiteId}-${year}-${String(month).padStart(2, "0")}-${week}`
}
