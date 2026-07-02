import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivitySchedule, pdtpChangeLog, pdtpExecutions } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { ROLE_RESPONSIBLE_SLUGS } from "./constants"

export type WorksiteScope = string[] | "all"

export function assertWorksiteAccess(worksiteId: string, scope: WorksiteScope): void {
  if (scope === "all") return
  if (!scope.includes(worksiteId)) {
    throw new Error("Actividad PDTP no encontrada o sin acceso a la faena.")
  }
}

export function emptyMonthlyTotals() {
  return Array.from({ length: 12 }, (_, index) => ({ month: index + 1, planned: 0, executed: 0, percent: null as number | null }))
}

export function displayNameForSlug(slug: string, fallback: string) {
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

export function displayNameForActivity(slugs: string[], fallback: string) {
  if (slugs.length === 0) return fallback
  return slugs.map((slug) => displayNameForSlug(slug, slug.replace(/_/g, " "))).join(", ")
}

export function pdtpProgramId(year: number, version: number) {
  return `pdtp-${year}-v${version}`
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

export async function addPdtpChangeLogEntry(
  programId: string, version: number, userId: string | null,
  section: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, note: string,
) {
  const now = new Date().toISOString()
  await db.insert(pdtpChangeLog).values({
    id: nanoid(), programId, version, changedByUserId: userId,
    changedAt: now, section, before, after, note,
  })
}

export function collectResponsibleCatalog(catalog: { activities: Array<{ responsibleSlugs: string[]; responsibleDisplay: string }> }) {
  const bySlug = new Map<string, { slug: string; displayName: string; roleName: string | null; kind: string; notes: string | null }>()
  for (const activity of catalog.activities) {
    for (const slug of activity.responsibleSlugs) {
      if (bySlug.has(slug)) continue
      bySlug.set(slug, {
        slug, displayName: displayNameForSlug(slug, activity.responsibleDisplay),
        roleName: ROLE_RESPONSIBLE_SLUGS.get(slug) ?? null,
        kind: ROLE_RESPONSIBLE_SLUGS.has(slug) ? "rbac_role" : "worker_group",
        notes: "Responsable extraido desde PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx.",
      })
    }
  }
  return [...bySlug.values()]
}

export async function loadProgramScheduleAndExecutions(activityIds: string[], year: number, worksiteId?: string) {
  const [scheduleRows, executionRows] = await Promise.all([
    db.select().from(pdtpActivitySchedule).where(inArray(pdtpActivitySchedule.activityId, activityIds)),
    worksiteId
      ? db.select().from(pdtpExecutions).where(and(inArray(pdtpExecutions.activityId, activityIds), eq(pdtpExecutions.worksiteId, worksiteId), eq(pdtpExecutions.year, year)))
      : Promise.resolve([] as Array<typeof pdtpExecutions.$inferSelect>),
  ])
  return { scheduleRows, executionRows }
}
