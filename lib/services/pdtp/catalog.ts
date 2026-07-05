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
import { SHEET_META } from "./constants"
import { collectResponsibleCatalog, displayNameForActivity, pdtpActivityId, pdtpProgramId, pdtpScheduleId, pdtpSheetActivityId } from "./helpers"
import type { PdtpCatalog, PdtpSheetCode } from "@/lib/services/prevention-pdtp-catalog"

type LoadPdtpCatalogInput = {
  year: number; version: number; title: string; catalog: PdtpCatalog; userId: string
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
    elaboratedByUserId: input.userId, elaboratedByName,
    elaboratedByTitle, createdAt: now, updatedAt: now,
  }).onConflictDoUpdate({
    target: [pdtpPrograms.year, pdtpPrograms.version],
    set: {
      title: input.title,
      elaboratedByUserId: input.userId,
      elaboratedByName,
      elaboratedByTitle,
      updatedAt: now,
    },
  }).returning()
  if (!program) throw new Error("No se pudo cargar el programa PDTP.")

  for (const responsible of collectResponsibleCatalog(input.catalog)) {
    await database.insert(pdtpResponsibleCatalog).values(responsible).onConflictDoUpdate({
      target: pdtpResponsibleCatalog.slug,
      set: { displayName: responsible.displayName, roleName: responsible.roleName, kind: responsible.kind, notes: responsible.notes },
    })
  }

  for (const [code, meta] of Object.entries(SHEET_META) as Array<[PdtpSheetCode, typeof SHEET_META[PdtpSheetCode]]>) {
    await database.insert(pdtpSheets).values({ code, label: meta.label, area: meta.area, defaultScopeRoles: meta.defaultScopeRoles }).onConflictDoUpdate({
      target: pdtpSheets.code,
      set: { label: meta.label, area: meta.area, defaultScopeRoles: meta.defaultScopeRoles },
    })
  }

  const activityIdByNumber = new Map<number, string>()

  for (const activity of input.catalog.activities) {
    const activityId = pdtpActivityId(program.id, activity.n)
    activityIdByNumber.set(activity.n, activityId)

    await database.insert(pdtpActivities).values({
      id: activityId, programId: program.id, n: activity.n, objectiveOrder: activity.objectiveOrder,
      objective: activity.objective, activity: activity.activity, program: activity.program,
      responsibleSlugs: activity.responsibleSlugs,
      responsibleDisplay: displayNameForActivity(activity.responsibleSlugs, activity.responsibleDisplay),
      sourceSheetRow: activity.sourceSheetRow, createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({
      target: [pdtpActivities.programId, pdtpActivities.n],
      set: {
        objectiveOrder: activity.objectiveOrder, objective: activity.objective,
        activity: activity.activity, program: activity.program, responsibleSlugs: activity.responsibleSlugs,
        responsibleDisplay: displayNameForActivity(activity.responsibleSlugs, activity.responsibleDisplay),
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
      await database.insert(pdtpSheetActivities).values({
        id: pdtpSheetActivityId(program.id, sheetCode, activityNumber), sheetCode, activityId,
        sheetRow: index + 1, displayOrder: index + 1,
      }).onConflictDoUpdate({
        target: [pdtpSheetActivities.sheetCode, pdtpSheetActivities.activityId],
        set: { sheetRow: index + 1, displayOrder: index + 1 },
      })
    }
  }

  return { program }
}
