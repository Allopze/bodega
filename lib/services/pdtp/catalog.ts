import { eq } from "drizzle-orm"
import { db, type DB } from "@/db"
import {
  pdtpActivities,
  pdtpActivitySchedule,
  pdtpPrograms,
  pdtpResponsibleCatalog,
  pdtpSheetActivities,
  pdtpSheets,
  users as schemaUsers,
} from "@/db/schema"
import { SHEET_META } from "@/lib/services/pdtp-adapters/sheet-meta-2026"
import { collectResponsibleCatalog, displayNameForActivity } from "@/lib/services/pdtp-adapters/responsible-catalog-2026"
import { pdtpActivityId, pdtpProgramId, pdtpScheduleId, pdtpSheetActivityId } from "./helpers"
import type { PdtpCatalog, PdtpSheetCode } from "@/lib/services/prevention-pdtp-catalog"
import { ensureDefaultPdtpApprovalSteps } from "./approval-flow"

type LoadPdtpCatalogInput = {
  year: number; version: number; title: string; catalog: PdtpCatalog; userId: string
}

/** Catálogo global de responsables (roles RBAC + grupos de trabajadores),
 * usado para poblar el select de "responsables" al agregar una actividad
 * manualmente en vez de escribir el slug a mano. */
export async function listPdtpResponsibleCatalog() {
  return db.select().from(pdtpResponsibleCatalog).orderBy(pdtpResponsibleCatalog.displayName)
}

export async function loadPdtpCatalog(input: LoadPdtpCatalogInput, database: DB = db) {
  const now = new Date().toISOString()
  const programId = pdtpProgramId(input.year, input.version)

  // H-B13: derivar `elaboratedByName`/`elaboratedByTitle` del usuario
  // que invoca el seed en lugar de hardcodear. Si el usuario no
  // existe en DB (caso raro de tests), cae a un placeholder genérico.
  const [elaborator] = await database
    .select({ name: schemaUsers.name })
    .from(schemaUsers)
    .where(eq(schemaUsers.id, input.userId))
    .limit(1)
  const elaboratedByName = elaborator?.name?.trim() || "Equipo de Prevención"
  const elaboratedByTitle = elaborator?.name?.trim() ? "Prevencionista" : "Sistema"

  const [program] = await database.insert(pdtpPrograms).values({
    id: programId, year: input.year, version: input.version, status: "draft", title: input.title,
    creationMode: input.year === 2026 ? "base_2026" : "xlsx_import",
    periodStart: `${input.year}-01-01`,
    periodEnd: `${input.year}-12-31`,
    elaboratedByUserId: input.userId, elaboratedByName,
    elaboratedByTitle, createdAt: now, updatedAt: now,
  }).onConflictDoUpdate({
    target: [pdtpPrograms.year, pdtpPrograms.version],
    set: {
      title: input.title,
      creationMode: input.year === 2026 ? "base_2026" : "xlsx_import",
      elaboratedByUserId: input.userId,
      elaboratedByName,
      elaboratedByTitle,
      updatedAt: now,
    },
  }).returning()
  if (!program) throw new Error("No se pudo cargar el programa PDTP.")
  await ensureDefaultPdtpApprovalSteps(program.id, database)

  for (const responsible of collectResponsibleCatalog(input.catalog)) {
    await database.insert(pdtpResponsibleCatalog).values(responsible).onConflictDoUpdate({
      target: pdtpResponsibleCatalog.slug,
      set: { displayName: responsible.displayName, roleName: responsible.roleName, kind: responsible.kind, notes: responsible.notes },
    })
  }

  for (const [code, meta] of Object.entries(SHEET_META) as Array<[PdtpSheetCode, typeof SHEET_META[PdtpSheetCode]]>) {
    const sheetId = `${program.id}-${code}`
    await database.insert(pdtpSheets).values({ id: sheetId, programId: program.id, code, label: meta.label, area: meta.area, defaultScopeRoles: meta.defaultScopeRoles }).onConflictDoUpdate({
      target: [pdtpSheets.id],
      set: { programId: program.id, code, label: meta.label, area: meta.area, defaultScopeRoles: meta.defaultScopeRoles },
    })
  }

  const activityIdByNumber = new Map<number, string>()

  for (const activity of input.catalog.activities) {
    const activityId = pdtpActivityId(program.id, activity.n)
    activityIdByNumber.set(activity.n, activityId)

    await database.insert(pdtpActivities).values({
      id: activityId, programId: program.id, n: activity.n, displayOrder: activity.n,
      activity: activity.activity, program: activity.program,
      responsibleSlugs: activity.responsibleSlugs,
      responsibleDisplay: displayNameForActivity(activity.responsibleSlugs, activity.responsibleDisplay),
      scheduleMode: activity.schedule.length > 0 ? "scheduled" : "on_demand",
      indicatorMode: activity.schedule.length > 0 ? "planned_vs_completed" : "closed_on_time",
      sourceSheetRow: activity.sourceSheetRow, createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({
      target: [pdtpActivities.programId, pdtpActivities.n],
      set: {
        displayOrder: activity.n, status: "active", retiredReason: null, retiredEffectiveFrom: null,
        retiredByUserId: null, retiredAt: null, activity: activity.activity, program: activity.program, responsibleSlugs: activity.responsibleSlugs,
        responsibleDisplay: displayNameForActivity(activity.responsibleSlugs, activity.responsibleDisplay),
        scheduleMode: activity.schedule.length > 0 ? "scheduled" : "on_demand",
        scheduleClassificationStatus: activity.schedule.length > 0 ? "confirmed" : "needs_review",
        indicatorMode: activity.schedule.length > 0 ? "planned_vs_completed" : "closed_on_time",
        sourceSheetRow: activity.sourceSheetRow, updatedAt: now,
      },
    })

    for (const cell of activity.schedule) {
      await database.insert(pdtpActivitySchedule).values({
        id: pdtpScheduleId(activityId, input.year, cell.month, cell.week), activityId,
        year: input.year, month: cell.month, week: cell.week, plannedQuantity: cell.plannedQuantity, sourceColumn: cell.sourceColumn,
      }).onConflictDoUpdate({
        target: [pdtpActivitySchedule.activityId, pdtpActivitySchedule.year, pdtpActivitySchedule.month, pdtpActivitySchedule.week],
        set: { plannedQuantity: cell.plannedQuantity, sourceColumn: cell.sourceColumn },
      })
    }
  }

  for (const [sheetCode, activityNumbers] of Object.entries(input.catalog.sheetActivities) as Array<[PdtpSheetCode, number[]]>) {
    for (const [index, activityNumber] of activityNumbers.entries()) {
      const activityId = activityIdByNumber.get(activityNumber)
      if (!activityId) throw new Error(`La hoja ${sheetCode} referencia actividad PDTP inexistente: ${activityNumber}.`)
      const sheetId = `${program.id}-${sheetCode}`
      await database.insert(pdtpSheetActivities).values({
        id: pdtpSheetActivityId(program.id, sheetCode, activityNumber), sheetId, sheetCode, activityId,
        sheetRow: index + 1, displayOrder: index + 1,
      }).onConflictDoUpdate({
        target: [pdtpSheetActivities.sheetId, pdtpSheetActivities.activityId],
        set: { sheetRow: index + 1, displayOrder: index + 1, sheetCode },
      })
    }
  }

  return { program }
}
