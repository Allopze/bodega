import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { db } from "@/db"
import { nanoid } from "@/lib/id"
import {
  pdtpActivities,
  pdtpActivitySchedule,
  pdtpPrograms,
  pdtpResponsibleCatalog,
  pdtpSheetActivities,
  pdtpSheets,
  preventionPdtpSourceLinks,
  users as schemaUsers,
} from "@/db/schema"
import { SHEET_META } from "./constants"
import { addPdtpChangeLogEntry, displayNameForSlug, collectResponsibleCatalog, isUniqueViolation, pdtpActivityId, pdtpProgramId, pdtpScheduleId, pdtpSheetActivityId } from "./helpers"
import type { PdtpSheetCode, PdtpWorkbook } from "@/lib/services/prevention-pdtp-catalog"
import { extractPdtpCatalogFromWorkbook } from "@/lib/services/prevention-pdtp-catalog"

export type PdtpProgramCreateInput = {
  year: number; title: string; userId: string; copySheetsFromProgramId?: string
}

export type PdtpProgramImportInput = {
  programId: string; workbook: PdtpWorkbook; userId: string
}

export async function createPdtpProgram(input: PdtpProgramCreateInput) {
  const now = new Date().toISOString()

  try {
    return await db.transaction(async (tx) => {
      const existingVersion = await tx.select({ version: pdtpPrograms.version })
        .from(pdtpPrograms)
        .where(eq(pdtpPrograms.year, input.year))
        .orderBy(desc(pdtpPrograms.version)).limit(1)
      const version = (existingVersion[0]?.version ?? 0) + 1
      const programId = pdtpProgramId(input.year, version)

      const [elaborator] = await tx
        .select({ name: schemaUsers.name })
        .from(schemaUsers)
        .where(eq(schemaUsers.id, input.userId))
        .limit(1)
      const elaboratedByName = elaborator?.name?.trim() || "Equipo de Prevención"
      const elaboratedByTitle = elaborator?.name?.trim() ? "Prevencionista" : "Sistema"

      const [program] = await tx.insert(pdtpPrograms).values({
        id: programId, year: input.year, version, status: "draft", title: input.title,
        elaboratedByUserId: input.userId, elaboratedByName, elaboratedByTitle,
        createdAt: now, updatedAt: now,
      }).returning()
      if (!program) throw new Error("No se pudo crear el programa PDTP.")

      if (input.copySheetsFromProgramId) {
        const sourceSheets = await tx.select().from(pdtpSheets)
          .where(and(
            or(isNull(pdtpSheets.programId), eq(pdtpSheets.programId, input.copySheetsFromProgramId)),
          ))
        if (sourceSheets.length > 0) {
          await tx.insert(pdtpSheets).values(sourceSheets.map((sheet) => ({
            id: `${programId}-${sheet.code}`,
            code: sheet.code,
            programId,
            label: sheet.label,
            area: sheet.area,
            defaultScopeRoles: sheet.defaultScopeRoles,
          }))).onConflictDoNothing()
        }

        // "Duplicar programa" es estructura completa, no solo hojas: copia
        // actividades + planificación + a qué hoja pertenece cada una. La
        // planificación se reancla al año del programa nuevo (`input.year`),
        // no al del programa origen.
        const sourceActivities = await tx.select().from(pdtpActivities)
          .where(eq(pdtpActivities.programId, input.copySheetsFromProgramId))
          .orderBy(pdtpActivities.n)
        const activityIdMap = new Map<string, string>()
        const activityNMap = new Map<string, number>()
        const copiedActivities: Array<typeof pdtpActivities.$inferInsert> = []

        for (const activity of sourceActivities) {
          const newActivityId = pdtpActivityId(programId, activity.n)
          activityIdMap.set(activity.id, newActivityId)
          activityNMap.set(activity.id, activity.n)
          copiedActivities.push({
            id: newActivityId, programId, n: activity.n, objectiveOrder: activity.objectiveOrder,
            objective: activity.objective, activity: activity.activity, program: activity.program,
            responsibleSlugs: activity.responsibleSlugs, responsibleDisplay: activity.responsibleDisplay,
            sourceSheetRow: activity.sourceSheetRow, notes: activity.notes, createdAt: now, updatedAt: now,
          })
        }
        if (copiedActivities.length > 0) await tx.insert(pdtpActivities).values(copiedActivities)

        if (activityIdMap.size > 0) {
          const sourceActivityIds = [...activityIdMap.keys()]
          const [scheduleRows, membershipRows, sourceLinks] = await Promise.all([
            tx.select().from(pdtpActivitySchedule).where(inArray(pdtpActivitySchedule.activityId, sourceActivityIds)),
            tx.select().from(pdtpSheetActivities).where(inArray(pdtpSheetActivities.activityId, sourceActivityIds)),
            tx.select().from(preventionPdtpSourceLinks).where(and(inArray(preventionPdtpSourceLinks.activityId, sourceActivityIds), eq(preventionPdtpSourceLinks.isActive, true))),
          ])
          const copiedSchedule: Array<typeof pdtpActivitySchedule.$inferInsert> = []
          for (const cell of scheduleRows) {
            const newActivityId = activityIdMap.get(cell.activityId)!
            copiedSchedule.push({
              id: pdtpScheduleId(newActivityId, input.year, cell.month, cell.week), activityId: newActivityId,
              year: input.year, month: cell.month, week: cell.week, plannedQuantity: cell.plannedQuantity, sourceColumn: cell.sourceColumn,
            })
          }
          if (copiedSchedule.length > 0) await tx.insert(pdtpActivitySchedule).values(copiedSchedule).onConflictDoNothing()

          const copiedMemberships: Array<typeof pdtpSheetActivities.$inferInsert> = []
          for (const membership of membershipRows) {
            const newActivityId = activityIdMap.get(membership.activityId)!
            const activityN = activityNMap.get(membership.activityId)!
            const newSheetId = `${programId}-${membership.sheetCode}`
            copiedMemberships.push({
              id: pdtpSheetActivityId(programId, membership.sheetCode, activityN),
              sheetId: newSheetId, sheetCode: membership.sheetCode, activityId: newActivityId,
              sheetRow: membership.sheetRow, displayOrder: membership.displayOrder,
            })
          }
          if (copiedMemberships.length > 0) await tx.insert(pdtpSheetActivities).values(copiedMemberships).onConflictDoNothing()

          if (sourceLinks.length > 0) {
            await tx.insert(preventionPdtpSourceLinks).values(sourceLinks.map((link) => ({
              id: `pdtpsource-${nanoid()}`,
              activityId: activityIdMap.get(link.activityId)!,
              worksiteId: link.worksiteId,
              sourceType: link.sourceType,
              sourceId: link.sourceId,
              sourceVersionSnapshot: link.sourceVersionSnapshot,
              justification: `Copiado desde ${input.copySheetsFromProgramId}: ${link.justification}`,
              createdByUserId: input.userId,
              createdAt: now,
            }))).onConflictDoNothing()
          }
        }
      } else {
        await tx.insert(pdtpSheets).values((Object.entries(SHEET_META) as Array<[PdtpSheetCode, typeof SHEET_META[PdtpSheetCode]]>).map(([code, meta]) => ({
            id: `${programId}-${code}`,
            code,
            programId,
            label: meta.label,
            area: meta.area,
            defaultScopeRoles: meta.defaultScopeRoles,
          })))
      }

      await addPdtpChangeLogEntry(programId, version, input.userId, "lifecycle", null, { status: "draft" }, "Programa creado.", tx)
      return program
    })
  } catch (e) {
    // Violación de unique(year, version): otra creación concurrente para
    // el mismo año ganó la carrera del número de versión. Mensaje
    // amistoso en vez del error crudo de Postgres.
    if (isUniqueViolation(e)) {
      throw new Error(`Ya se creó otra versión del programa ${input.year} al mismo tiempo. Intenta de nuevo.`)
    }
    throw e
  }
}

export async function updatePdtpProgram(programId: string, input: { title?: string; complianceTarget?: number }, userId: string) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.status !== "draft") throw new Error("Solo se pueden editar programas en estado borrador (draft).")

  const now = new Date().toISOString()
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  const updates: Partial<typeof pdtpPrograms.$inferInsert> = { updatedAt: now }

  if (input.title !== undefined && input.title !== program.title) {
    before.title = program.title; after.title = input.title; updates.title = input.title
  }
  if (input.complianceTarget !== undefined && input.complianceTarget !== program.complianceTarget) {
    before.complianceTarget = program.complianceTarget; after.complianceTarget = input.complianceTarget
    updates.complianceTarget = input.complianceTarget
  }

  const [updated] = await db.update(pdtpPrograms).set(updates).where(eq(pdtpPrograms.id, programId)).returning()
  if (!updated) throw new Error("No se pudo actualizar el programa PDTP.")

  if (Object.keys(after).length > 0) {
    await addPdtpChangeLogEntry(programId, program.version, userId, "metadata", before, after, "Metadatos actualizados.")
  }
  return updated
}

export async function listPdtpPrograms(opts?: { status?: string; year?: number }) {
  const conditions = []
  if (opts?.status) conditions.push(eq(pdtpPrograms.status, opts.status))
  if (opts?.year) conditions.push(eq(pdtpPrograms.year, opts.year))
  return db.select().from(pdtpPrograms).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(desc(pdtpPrograms.year), desc(pdtpPrograms.version))
}

export async function getPdtpProgram(programId: string) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  return program ?? null
}

export async function deletePdtpProgram(programId: string) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.status !== "draft") throw new Error("Solo se pueden eliminar programas en estado borrador (draft).")

  // El delete cascadea a hojas/actividades/schedule/ejecuciones/overrides/
  // change_log (FK ON DELETE CASCADE). No escribimos un changelog "programa
  // eliminado" después: el programa ya no existe, y la fila violaría su
  // propia FK (además, el cascade ya borró el historial previo).
  await db.delete(pdtpPrograms).where(eq(pdtpPrograms.id, programId))
}

export async function importPdtpFromExcel(input: PdtpProgramImportInput) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, input.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.status !== "draft") throw new Error("Solo se pueden importar actividades a programas en estado borrador (draft).")

  const catalog = extractPdtpCatalogFromWorkbook(input.workbook)
  const now = new Date().toISOString()

  return db.transaction(async (tx) => {
    let sheetCount = 0
    let activityCount = 0

    // Re-import es reemplazo total, no acumulación: antes un segundo import
    // solo agregaba actividades nuevas cuyo membership chocaba (mismo id
    // por `activityNumber` original) y quedaba sin hoja asociada —
    // duplicación silenciosa. Partir de cero evita eso; el cascade de
    // `pdtp_activities` limpia schedule + sheet_activities.
    await tx.delete(pdtpActivities).where(eq(pdtpActivities.programId, input.programId))

    // Sync responsible catalog in one statement. `excluded` keeps every row's
    // own values during a bulk upsert instead of reusing the first item.
    const responsibleRows = collectResponsibleCatalog(catalog)
    if (responsibleRows.length > 0) {
      await tx.insert(pdtpResponsibleCatalog).values(responsibleRows).onConflictDoUpdate({
        target: pdtpResponsibleCatalog.slug,
        set: {
          displayName: sql`excluded.display_name`,
          roleName: sql`excluded.role_name`,
          kind: sql`excluded.kind`,
          notes: sql`excluded.notes`,
        },
      })
    }

    // Import sheet-scoped copies
    const sheetRows: Array<typeof pdtpSheets.$inferInsert> = []
    for (const [code, meta] of Object.entries(SHEET_META) as Array<[PdtpSheetCode, typeof SHEET_META[PdtpSheetCode]]>) {
      if (catalog.sheetActivities[code]) {
        sheetRows.push({
          id: `${input.programId}-${code}`,
          code,
          programId: input.programId,
          label: meta.label,
          area: meta.area,
          defaultScopeRoles: meta.defaultScopeRoles,
        })
      }
    }
    sheetCount = sheetRows.length
    if (sheetRows.length > 0) {
      await tx.insert(pdtpSheets).values(sheetRows).onConflictDoUpdate({
          target: [pdtpSheets.id],
          set: {
            code: sql`excluded.code`,
            label: sql`excluded.label`,
            area: sql`excluded.area`,
            defaultScopeRoles: sql`excluded.default_scope_roles`,
          },
        })
    }

    const activityIdByNumber = new Map<number, string>()
    const activityRows: Array<typeof pdtpActivities.$inferInsert> = []
    const scheduleRows: Array<typeof pdtpActivitySchedule.$inferInsert> = []

    for (const activity of catalog.activities) {
      const newN = activityCount + 1
      const activityId = pdtpActivityId(input.programId, newN)
      activityIdByNumber.set(activity.n, activityId)
      activityCount++

      activityRows.push({
        id: activityId, programId: input.programId, n: newN, objectiveOrder: activity.objectiveOrder,
        objective: activity.objective, activity: activity.activity, program: activity.program,
        responsibleSlugs: activity.responsibleSlugs,
        responsibleDisplay: activity.responsibleSlugs.map((s) => displayNameForSlug(s, s)).join(", "),
        sourceSheetRow: activity.sourceSheetRow, notes: null, createdAt: now, updatedAt: now,
      })

      for (const cell of activity.schedule) {
        scheduleRows.push({
          id: pdtpScheduleId(activityId, program.year, cell.month, cell.week), activityId,
          year: program.year, month: cell.month, week: cell.week, plannedQuantity: cell.plannedQuantity, sourceColumn: cell.sourceColumn,
        })
      }
    }
    if (activityRows.length > 0) await tx.insert(pdtpActivities).values(activityRows)
    if (scheduleRows.length > 0) await tx.insert(pdtpActivitySchedule).values(scheduleRows).onConflictDoNothing()

    const membershipRows: Array<typeof pdtpSheetActivities.$inferInsert> = []
    for (const [sheetCode, activityNumbers] of Object.entries(catalog.sheetActivities) as Array<[PdtpSheetCode, number[]]>) {
      const sheetId = `${input.programId}-${sheetCode}`
      let row = 0
      for (const activityNumber of activityNumbers) {
        const activityId = activityIdByNumber.get(activityNumber)
        if (activityId) {
          row++
          membershipRows.push({
            id: pdtpSheetActivityId(input.programId, sheetCode, activityNumber),
            sheetId, sheetCode, activityId,
            sheetRow: row, displayOrder: row,
          })
        }
      }
    }
    if (membershipRows.length > 0) await tx.insert(pdtpSheetActivities).values(membershipRows).onConflictDoNothing()

    await addPdtpChangeLogEntry(input.programId, program.version, input.userId, "import:excel", null, { sheetCount, activityCount }, `${activityCount} actividades importadas desde Excel en ${sheetCount} hojas.`, tx)

    return { sheetCount, activityCount }
  })
}
