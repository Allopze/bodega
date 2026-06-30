/**
 * lib/services/prevention-pdtp.ts
 * Programa de Trabajo Preventivo SG-SST: carga de catálogo y base del cronograma.
 */

import { and, desc, eq, inArray } from "drizzle-orm"
import { db, type DB } from "@/db"
import {
  pdtpActivities,
  pdtpActivitySchedule,
  pdtpChangeLog,
  pdtpExecutions,
  pdtpPrograms,
  pdtpResponsibleCatalog,
  pdtpSheetActivities,
  pdtpSheets,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
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
  const [activityRows, { scheduleRows, executionRows }] = await Promise.all([
    db.select().from(pdtpActivities).where(inArray(pdtpActivities.id, activityIds)),
    loadProgramScheduleAndExecutions(activityIds, year, worksiteId),
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

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function addPdtpChangeLogEntry(
  programId: string,
  version: number,
  userId: string | null,
  section: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  note: string,
) {
  const now = new Date().toISOString()
  await db.insert(pdtpChangeLog).values({
    id: nanoid(),
    programId,
    version,
    changedByUserId: userId,
    changedAt: now,
    section,
    before,
    after,
    note,
  })
}

async function loadProgramScheduleAndExecutions(
  activityIds: string[],
  year: number,
  worksiteId?: string,
) {
  const [scheduleRows, executionRows] = await Promise.all([
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
  return { scheduleRows, executionRows }
}

// ---------------------------------------------------------------------------
// WS1 — Compliance indicators
// ---------------------------------------------------------------------------

export type PdtpComplianceMonth = {
  month: number    // 1..12
  planned: number  // count of distinct activities with plannedQuantity > 0 in this month
  executed: number // count of distinct activities with executedQuantity > 0 (status submitted OR approved) in this month
  percent: number | null
}

export type PdtpComplianceIndicators = {
  programId: string
  year: number
  target: number          // complianceTarget from pdtp_programs (default 0.9)
  monthly: PdtpComplianceMonth[]   // length 12
  quarterly: Array<{ quarter: number; planned: number; executed: number; percent: number | null }>  // length 4
  annual: { planned: number; executed: number; percent: number | null }
}

export async function getPdtpComplianceIndicators(
  year: number,
  worksiteId?: string,
): Promise<PdtpComplianceIndicators | null> {
  // 1. Find the program for this year (latest version, prefer active)
  const [program] = await db.select().from(pdtpPrograms)
    .where(eq(pdtpPrograms.year, year))
    .orderBy(desc(pdtpPrograms.version))
    .limit(1)
  if (!program) return null

  // 2. Get ALL activity IDs for this program (across all sheets = pdtp_general)
  const activityRows = await db.select({ id: pdtpActivities.id })
    .from(pdtpActivities)
    .where(eq(pdtpActivities.programId, program.id))

  if (activityRows.length === 0) {
    return {
      programId: program.id,
      year,
      target: program.complianceTarget,
      monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, planned: 0, executed: 0, percent: null })),
      quarterly: Array.from({ length: 4 }, (_, i) => ({ quarter: i + 1, planned: 0, executed: 0, percent: null })),
      annual: { planned: 0, executed: 0, percent: null },
    }
  }

  const allActivityIds = activityRows.map((row) => row.id)
  const { scheduleRows, executionRows } = await loadProgramScheduleAndExecutions(allActivityIds, year, worksiteId)

  // 3. Count planned activities per month (distinct activityId where plannedQuantity > 0)
  const plannedByMonth = new Array<Set<string>>(12).fill(null as unknown as Set<string>)
    .map(() => new Set<string>())
  for (const row of scheduleRows) {
    if (row.plannedQuantity > 0) {
      plannedByMonth[row.month - 1]!.add(row.activityId)
    }
  }

  // 4. Count executed activities per month (distinct activityId where executedQuantity > 0)
  const executedByMonth = new Array<Set<string>>(12).fill(null as unknown as Set<string>)
    .map(() => new Set<string>())
  for (const row of executionRows) {
    if (row.executedQuantity > 0) {
      executedByMonth[row.month - 1]!.add(row.activityId)
    }
  }

  // 5. Build monthly array
  const monthly: PdtpComplianceMonth[] = Array.from({ length: 12 }, (_, i) => {
    const planned = plannedByMonth[i]!.size
    const executed = executedByMonth[i]!.size
    const percent = planned > 0 ? Math.round((executed / planned) * 100) / 100 : null  // 0..1 ratio
    return { month: i + 1, planned, executed, percent }
  })

  // 6. Build quarterly
  const quarterly = Array.from({ length: 4 }, (_, q) => {
    const months = monthly.slice(q * 3, q * 3 + 3)
    const planned = months.reduce((s, m) => s + m.planned, 0)
    const executed = months.reduce((s, m) => s + m.executed, 0)
    const percent = planned > 0 ? Math.round((executed / planned) * 100) / 100 : null
    return { quarter: q + 1, planned, executed, percent }
  })

  // 7. Annual
  const annualPlanned = monthly.reduce((s, m) => s + m.planned, 0)
  const annualExecuted = monthly.reduce((s, m) => s + m.executed, 0)
  const annual = {
    planned: annualPlanned,
    executed: annualExecuted,
    percent: annualPlanned > 0 ? Math.round((annualExecuted / annualPlanned) * 100) / 100 : null,
  }

  return {
    programId: program.id,
    year,
    target: program.complianceTarget,
    monthly,
    quarterly,
    annual,
  }
}

// ---------------------------------------------------------------------------
// WS2 — Lifecycle transitions
// ---------------------------------------------------------------------------

export async function approvePdtpProgramJdpr(programId: string, userId: string) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.approvedByJdprUserId) throw new Error("El programa ya fue aprobado por JDPR.")

  const now = new Date().toISOString()
  const [updated] = await db.update(pdtpPrograms)
    .set({ approvedByJdprUserId: userId, approvedByJdprAt: now, updatedAt: now })
    .where(eq(pdtpPrograms.id, programId))
    .returning()
  if (!updated) throw new Error("No se pudo registrar la aprobación JDPR.")

  await addPdtpChangeLogEntry(programId, program.version, userId, "lifecycle", { approvedByJdprUserId: null }, { approvedByJdprUserId: userId }, "Aprobado por JDPR.")
  return updated
}

export async function signPdtpProgramLegal(programId: string, userId: string) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.approvedByLegalUserId) throw new Error("El programa ya fue firmado por Gerencia Legal.")

  const now = new Date().toISOString()
  const [updated] = await db.update(pdtpPrograms)
    .set({ approvedByLegalUserId: userId, approvedByLegalAt: now, updatedAt: now })
    .where(eq(pdtpPrograms.id, programId))
    .returning()
  if (!updated) throw new Error("No se pudo registrar la firma de Gerencia Legal.")

  await addPdtpChangeLogEntry(programId, program.version, userId, "lifecycle", { approvedByLegalUserId: null }, { approvedByLegalUserId: userId }, "Firmado por Gerencia Legal y RRHH.")
  return updated
}

export async function activatePdtpProgram(programId: string, userId: string) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.status === "active") throw new Error("El programa ya está activo.")
  if (!program.approvedByJdprUserId) throw new Error("El programa debe ser aprobado por JDPR antes de activarse.")
  if (!program.approvedByLegalUserId) throw new Error("El programa debe ser firmado por Gerencia Legal antes de activarse.")

  const now = new Date().toISOString()

  // Degrade any other active version for the same year to draft
  await db.update(pdtpPrograms)
    .set({ status: "draft", updatedAt: now })
    .where(and(eq(pdtpPrograms.year, program.year), eq(pdtpPrograms.status, "active")))

  const [updated] = await db.update(pdtpPrograms)
    .set({ status: "active", updatedAt: now })
    .where(eq(pdtpPrograms.id, programId))
    .returning()
  if (!updated) throw new Error("No se pudo activar el programa PDTP.")

  await addPdtpChangeLogEntry(programId, program.version, userId, "lifecycle", { status: "draft" }, { status: "active" }, "Programa activado.")
  return updated
}

// ---------------------------------------------------------------------------
// WS3 — Execution approval
// ---------------------------------------------------------------------------

export async function approvePdtpExecution(
  executionId: string,
  userId: string,
  scope: WorksiteScope,
) {
  const [execution] = await db.select().from(pdtpExecutions).where(eq(pdtpExecutions.id, executionId)).limit(1)
  if (!execution) throw new Error("Ejecución PDTP no encontrada.")
  if (execution.status === "approved") throw new Error("La ejecución ya fue aprobada.")
  if (execution.status !== "submitted") throw new Error("Solo se pueden aprobar ejecuciones en estado 'submitted'.")

  assertWorksiteAccess(execution.worksiteId, scope)

  const now = new Date().toISOString()
  const [updated] = await db.update(pdtpExecutions)
    .set({ status: "approved", approvedByUserId: userId, approvedAt: now, updatedAt: now })
    .where(eq(pdtpExecutions.id, executionId))
    .returning()
  if (!updated) throw new Error("No se pudo aprobar la ejecución PDTP.")
  return updated
}

// ---------------------------------------------------------------------------
// WS4 — Activity edit and add
// ---------------------------------------------------------------------------

export type PdtpActivityUpdateInput = {
  activityId: string
  // Fields are all optional; only truthy values are applied
  activity?: string     // max 200
  program?: string      // max 200 (the "Programa"/método column)
  notes?: string        // max 2000
  responsibleSlugs?: string[]
  responsibleDisplay?: string  // max 160
  // Schedule overrides: replace specific cells (month 1-12, week 1-4)
  scheduleOverrides?: Array<{
    month: number   // 1..12
    week: number    // 1..4
    plannedQuantity: number  // >=0
  }>
}

export async function updatePdtpActivity(
  input: PdtpActivityUpdateInput,
  userId: string,
): Promise<typeof pdtpActivities.$inferSelect> {
  const [activity] = await db.select().from(pdtpActivities)
    .where(eq(pdtpActivities.id, input.activityId))
    .limit(1)
  if (!activity) throw new Error("Actividad PDTP no encontrada.")

  const [program] = await db.select().from(pdtpPrograms)
    .where(eq(pdtpPrograms.id, activity.programId))
    .limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.status !== "draft") throw new Error("Solo se pueden editar actividades de programas en estado borrador (draft).")

  const now = new Date().toISOString()
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}

  const updates: Partial<typeof pdtpActivities.$inferInsert> = { updatedAt: now }

  if (input.activity !== undefined && input.activity !== activity.activity) {
    before.activity = activity.activity
    after.activity = input.activity
    updates.activity = input.activity
  }
  if (input.program !== undefined && input.program !== activity.program) {
    before.program = activity.program
    after.program = input.program
    updates.program = input.program
  }
  if (input.notes !== undefined && input.notes !== activity.notes) {
    before.notes = activity.notes
    after.notes = input.notes
    updates.notes = input.notes
  }
  if (input.responsibleSlugs !== undefined) {
    before.responsibleSlugs = activity.responsibleSlugs
    after.responsibleSlugs = input.responsibleSlugs
    updates.responsibleSlugs = input.responsibleSlugs
  }
  if (input.responsibleDisplay !== undefined && input.responsibleDisplay !== activity.responsibleDisplay) {
    before.responsibleDisplay = activity.responsibleDisplay
    after.responsibleDisplay = input.responsibleDisplay
    updates.responsibleDisplay = input.responsibleDisplay
  }

  const [updated] = await db.update(pdtpActivities)
    .set(updates)
    .where(eq(pdtpActivities.id, input.activityId))
    .returning()
  if (!updated) throw new Error("No se pudo actualizar la actividad PDTP.")

  // Apply schedule overrides
  if (input.scheduleOverrides && input.scheduleOverrides.length > 0) {
    before.scheduleOverrides = "see after"
    after.scheduleOverrides = input.scheduleOverrides

    for (const cell of input.scheduleOverrides) {
      const schedId = pdtpScheduleId(input.activityId, program.year, cell.month, cell.week)
      // Use the pdtpActivitySchedule year from the program
      await db.insert(pdtpActivitySchedule)
        .values({
          id: schedId,
          activityId: input.activityId,
          year: program.year,
          month: cell.month,
          week: cell.week,
          plannedQuantity: cell.plannedQuantity,
          sourceColumn: "manual",
        })
        .onConflictDoUpdate({
          target: [
            pdtpActivitySchedule.activityId,
            pdtpActivitySchedule.year,
            pdtpActivitySchedule.month,
            pdtpActivitySchedule.week,
          ],
          set: { plannedQuantity: cell.plannedQuantity, sourceColumn: "manual" },
        })
    }
  }

  if (Object.keys(after).length > 0) {
    await addPdtpChangeLogEntry(
      activity.programId,
      program.version,
      userId,
      `activity:${activity.n}`,
      before,
      after,
      `Actividad ${activity.n} actualizada.`,
    )
  }

  return updated
}

export type PdtpActivityAddInput = {
  programId: string
  objectiveOrder: number  // must match an existing objective (1..8)
  objective: string       // text of the objective
  activity: string        // max 200
  program: string         // max 200
  responsibleSlugs: string[]
  responsibleDisplay: string  // max 160
  notes?: string
  // Which sheet codes this activity belongs to
  sheetCodes: string[]   // at least 1; must be valid PdtpSheetCode values
  // Initial planned schedule (optional)
  schedule?: Array<{
    month: number   // 1..12
    week: number    // 1..4
    plannedQuantity: number  // >=0
  }>
}

export async function addPdtpActivity(
  input: PdtpActivityAddInput,
  userId: string,
): Promise<typeof pdtpActivities.$inferSelect> {
  const [program] = await db.select().from(pdtpPrograms)
    .where(eq(pdtpPrograms.id, input.programId))
    .limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.status !== "draft") throw new Error("Solo se pueden agregar actividades a programas en estado borrador (draft).")

  // Get the current max n for this program
  const existingActivities = await db.select({ n: pdtpActivities.n })
    .from(pdtpActivities)
    .where(eq(pdtpActivities.programId, input.programId))
  const maxN = existingActivities.reduce((m, row) => Math.max(m, row.n), 0)
  const newN = maxN + 1

  const now = new Date().toISOString()
  const activityId = pdtpActivityId(input.programId, newN)

  const [created] = await db.insert(pdtpActivities)
    .values({
      id: activityId,
      programId: input.programId,
      n: newN,
      objectiveOrder: input.objectiveOrder,
      objective: input.objective,
      activity: input.activity,
      program: input.program,
      responsibleSlugs: input.responsibleSlugs,
      responsibleDisplay: input.responsibleDisplay,
      sourceSheetRow: 0,  // manual entry
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  if (!created) throw new Error("No se pudo crear la actividad PDTP.")

  // Add schedule cells
  if (input.schedule && input.schedule.length > 0) {
    for (const cell of input.schedule) {
      await db.insert(pdtpActivitySchedule).values({
        id: pdtpScheduleId(activityId, program.year, cell.month, cell.week),
        activityId,
        year: program.year,
        month: cell.month,
        week: cell.week,
        plannedQuantity: cell.plannedQuantity,
        sourceColumn: "manual",
      })
    }
  }

  // Add sheet memberships
  for (const sheetCode of input.sheetCodes) {
    await db.insert(pdtpSheetActivities)
      .values({
        id: pdtpSheetActivityId(input.programId, sheetCode as PdtpSheetCode, newN),
        sheetCode,
        activityId,
        sheetRow: 0,
        displayOrder: newN,
      })
      .onConflictDoNothing()
  }

  await addPdtpChangeLogEntry(
    input.programId,
    program.version,
    userId,
    `activity:${newN}`,
    null,
    { n: newN, activity: input.activity, sheetCodes: input.sheetCodes },
    `Actividad ${newN} agregada manualmente.`,
  )

  return created
}
