import { and, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { pdtpActivities, pdtpActivitySchedule, pdtpChangeLog, pdtpExecutions, pdtpSheets } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { ROLE_RESPONSIBLE_SLUGS } from "./constants"
import { applyOverridesToSchedule, loadPdtpOverrides } from "./overrides"

export type WorksiteScope = string[] | "all"

/** Código de error Postgres 23505 = unique_violation (driver `postgres`). */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "23505"
}

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

/**
 * Resuelve la hoja PDTP (template o program-scoped) para un código dado.
 * Un código puede tener dos filas: una plantilla global (`program_id
 * NULL`, del seed) y una program-scoped (`program_id = programId`, creada
 * por `createPdtpProgram`/`importPdtpFromExcel`). Sin este orden explícito,
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
  const [scheduleRows, executionRows, overrideRows] = await Promise.all([
    db.select().from(pdtpActivitySchedule).where(inArray(pdtpActivitySchedule.activityId, activityIds)),
    worksiteId
      ? db.select().from(pdtpExecutions).where(and(inArray(pdtpExecutions.activityId, activityIds), eq(pdtpExecutions.worksiteId, worksiteId), eq(pdtpExecutions.year, year)))
      : Promise.resolve([] as Array<typeof pdtpExecutions.$inferSelect>),
    worksiteId
      ? loadPdtpOverrides(activityIds, year, worksiteId)
      : Promise.resolve([] as Awaited<ReturnType<typeof loadPdtpOverrides>>),
  ])
  const effectiveSchedule = worksiteId
    ? applyOverridesToSchedule(scheduleRows, overrideRows)
    : scheduleRows
  return { scheduleRows: effectiveSchedule, executionRows }
}
