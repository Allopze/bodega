import { createHash } from "node:crypto"
import ExcelJS from "exceljs"
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpActivityChecklists,
  pdtpActivitySchedule,
  pdtpChangeLog,
  pdtpDocumentHistory,
  pdtpExecutions,
  pdtpExecutionChecklists,
  pdtpImportBatches,
  pdtpImportRows,
  pdtpPrograms,
  pdtpResponsibleCatalog,
  pdtpRoleLegendEntries,
  pdtpSheetActivities,
  pdtpSheets,
  preventionPdtpSourceLinks,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import {
  extractPdtpCatalogFromWorkbook,
  type PdtpCatalog,
  type PdtpImportedExecutionCell,
} from "@/lib/services/prevention-pdtp-catalog"
import { SHEET_META } from "@/lib/services/pdtp-adapters/sheet-meta-2026"
import { PDTP_2026_GENERAL_SHEET_NAME } from "@/lib/services/prevention-pdtp-catalog"
import { PDTP_2026_PROGRAM_SOURCE } from "@/lib/services/pdtp-adapters/contract-2026"
import { collectResponsibleCatalog, displayNameForActivity } from "@/lib/services/pdtp-adapters/responsible-catalog-2026"
import { writePdtpActivityContent } from "./activity-content"
import {
  addPdtpChangeLogEntry,
  assertPdtpProgramEditableState,
  assertWorksiteAccess,
  isActivePdtpWorksite,
  pdtpActivityId,
  pdtpExecutionId,
  pdtpScheduleId,
  pdtpSheetActivityId,
  type WorksiteScope,
} from "./helpers"
import { validateLoadedWorkbook, validateXlsxEnvelope } from "@/lib/services/xlsx-security"

type ImportSnapshot = {
  program: Record<string, unknown>
  activities: Array<typeof pdtpActivities.$inferSelect>
  schedules: Array<typeof pdtpActivitySchedule.$inferSelect>
  memberships: Array<typeof pdtpSheetActivities.$inferSelect>
  sheets: Array<typeof pdtpSheets.$inferSelect>
  importedActivityIds: string[]
  newlyCreatedActivityIds: string[]
}

export type PdtpImportPreview = {
  batchId: string
  status: string
  source: { fileName: string; checksumSha256: string; sizeBytes: number }
  counts: {
    activities: number
    plannedCells: number
    plannedQuantity: number
    executedCells: number
    executedQuantity: number
    views: number
    creates: number
    updates: number
    unchanged: number
    existingExtraActivitiesPreserved: number
    calendarCellsAdded: number
    calendarCellsUpdated: number
    calendarCellsRemoved: number
    scheduleRowsReplaced: number
    viewMembershipsAdded: number
    viewMembershipsRemoved: number
    viewMembershipRowsReplaced: number
    checklistBindingsPreserved: number
    sourceLinksPreserved: number
    checklistBindingsLost: number
    sourceLinksLost: number
    scheduleClassificationsPending: number
  }
  calendarChanges: Array<{ activityNumber: number; added: number; updated: number; removed: number }>
  executions: PdtpImportedExecutionCell[]
  metadata: PdtpCatalog["metadata"]
  warnings: string[]
  blockingErrors: string[]
}

type StoredPreview = { catalog: PdtpCatalog; summary: PdtpImportPreview }

function buildImportedDocumentHistory(
  metadata: NonNullable<PdtpCatalog["metadata"]>,
  programId: string,
  batchId: string,
  now: string,
): Array<typeof pdtpDocumentHistory.$inferInsert> {
  const rows: Array<typeof pdtpDocumentHistory.$inferInsert> = []
  if (metadata.elaboratedByName || metadata.elaboratedByTitle || metadata.elaboratedAt) {
    rows.push({
      id: `${batchId}-document-elaboration`, programId, entryKind: "elaboration", stableKey: "elaboration", sequence: 1,
      declaredActorName: metadata.elaboratedByName, declaredActorTitle: metadata.elaboratedByTitle,
      declaredAtText: metadata.elaboratedAt, description: "Declaracion de elaboracion conservada desde el documento fuente.",
      sourceImportBatchId: batchId, sourceMetadataJson: { nameCell: "C113", dateCell: "C115", titleCell: "C116" },
      createdAt: now, updatedAt: now,
    })
  }
  if (metadata.approvedByName || metadata.approvedByTitle || metadata.approvedAt) {
    rows.push({
      id: `${batchId}-document-approval`, programId, entryKind: "approval", stableKey: "approval", sequence: 1,
      declaredActorName: metadata.approvedByName, declaredActorTitle: metadata.approvedByTitle,
      declaredAtText: metadata.approvedAt, description: "Declaracion de aprobacion conservada desde el documento fuente; no reemplaza la aprobacion nativa de Chome.",
      sourceImportBatchId: batchId, sourceMetadataJson: { nameCell: "E113", dateCell: "E115", titleCell: "E116" },
      createdAt: now, updatedAt: now,
    })
  }
  metadata.changeControl.forEach((change, index) => rows.push({
    id: `${batchId}-document-change-${index + 1}`, programId, entryKind: "change_control",
    stableKey: `change_control:${index + 1}`, sequence: index + 1, declaredAtText: change.date,
    description: change.description, sourceImportBatchId: batchId,
    sourceMetadataJson: { dateCell: "C119", descriptionCell: "D119", sourceSequence: index + 1 },
    createdAt: now, updatedAt: now,
  }))
  return rows
}

type BootstrapArtifacts = {
  checklistIdsCreated: string[]
  templateIdCreated?: string
  templateVersionIdCreated?: string
}

function activityComparable(activity: Pick<typeof pdtpActivities.$inferSelect,
  "activity" | "program" | "responsibleSlugs" | "sourceSheetRow"
>) {
  return {
    activity: activity.activity,
    program: activity.program,
    responsibleSlugs: activity.responsibleSlugs,
    sourceSheetRow: activity.sourceSheetRow,
  }
}

function catalogActivityComparable(activity: PdtpCatalog["activities"][number]) {
  return activityComparable(activity)
}

export async function stagePdtpXlsxImport(input: {
  programId: string
  bytes: Uint8Array
  fileName: string
  mimeType: string
  userId: string
}): Promise<{ batch: typeof pdtpImportBatches.$inferSelect; preview: PdtpImportPreview }> {
  const buffer = Buffer.from(input.bytes)
  validateXlsxEnvelope({
    name: input.fileName,
    type: input.mimeType,
    size: buffer.length,
    buffer,
  })
  const checksumSha256 = createHash("sha256").update(input.bytes).digest("hex")
  const [existingBatch] = await db.select().from(pdtpImportBatches)
    .where(and(
      eq(pdtpImportBatches.programId, input.programId),
      eq(pdtpImportBatches.sourceChecksumSha256, checksumSha256),
      ne(pdtpImportBatches.status, "cancelled"),
    ))
    .limit(1)
  if (existingBatch) {
    const stored = existingBatch.previewJson as StoredPreview
    return { batch: existingBatch, preview: { ...stored.summary, status: existingBatch.status } }
  }

  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, input.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  assertPdtpProgramEditableState(program)

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(input.bytes as never)
  validateLoadedWorkbook(workbook)
  const catalog = extractPdtpCatalogFromWorkbook(workbook)
  const existingActivities = await db.select().from(pdtpActivities).where(eq(pdtpActivities.programId, input.programId))
  const existingByNumber = new Map(existingActivities.map((activity) => [activity.n, activity]))
  const importedExistingIds = existingActivities
    .filter((activity) => catalog.activities.some((candidate) => candidate.n === activity.n))
    .map((activity) => activity.id)
  const [existingSchedules, existingMemberships, existingChecklists, existingSourceLinks] = await Promise.all([
    importedExistingIds.length ? db.select().from(pdtpActivitySchedule).where(inArray(pdtpActivitySchedule.activityId, importedExistingIds)) : [],
    importedExistingIds.length ? db.select().from(pdtpSheetActivities).where(inArray(pdtpSheetActivities.activityId, importedExistingIds)) : [],
    importedExistingIds.length ? db.select().from(pdtpActivityChecklists).where(inArray(pdtpActivityChecklists.activityId, importedExistingIds)) : [],
    importedExistingIds.length ? db.select().from(preventionPdtpSourceLinks).where(inArray(preventionPdtpSourceLinks.activityId, importedExistingIds)) : [],
  ])
  const activityNumberById = new Map(existingActivities.map((activity) => [activity.id, activity.n]))
  const schedulesByNumber = new Map<number, typeof existingSchedules>()
  for (const row of existingSchedules) {
    const activityNumber = activityNumberById.get(row.activityId)
    if (activityNumber === undefined) continue
    const rows = schedulesByNumber.get(activityNumber) ?? []
    rows.push(row)
    schedulesByNumber.set(activityNumber, rows)
  }
  let creates = 0
  let updates = 0
  let unchanged = 0
  for (const activity of catalog.activities) {
    const current = existingByNumber.get(activity.n)
    if (!current) creates += 1
    else if (JSON.stringify(activityComparable(current)) === JSON.stringify(catalogActivityComparable(activity))) unchanged += 1
    else updates += 1
  }
  const calendarChanges = catalog.activities.flatMap((activity) => {
    const current = new Map((schedulesByNumber.get(activity.n) ?? []).map((cell) => [`${cell.month}:${cell.week}`, cell]))
    const incoming = new Map(activity.schedule.map((cell) => [`${cell.month}:${cell.week}`, cell]))
    let added = 0
    let updated = 0
    let removed = 0
    for (const [key, cell] of incoming) {
      const prior = current.get(key)
      if (!prior) added += 1
      else if (prior.plannedQuantity !== cell.plannedQuantity || prior.sourceColumn !== cell.sourceColumn) updated += 1
    }
    for (const key of current.keys()) if (!incoming.has(key)) removed += 1
    return added || updated || removed ? [{ activityNumber: activity.n, added, updated, removed }] : []
  })
  const incomingMembershipKeys = new Set(Object.entries(catalog.sheetActivities)
    .flatMap(([sheetCode, numbers]) => numbers.map((activityNumber) => `${activityNumber}:${sheetCode}`)))
  const existingMembershipKeys = new Set(existingMemberships.flatMap((membership) => {
    const activityNumber = activityNumberById.get(membership.activityId)
    return activityNumber === undefined ? [] : [`${activityNumber}:${membership.sheetCode}`]
  }))
  const viewMembershipsAdded = [...incomingMembershipKeys].filter((key) => !existingMembershipKeys.has(key)).length
  const viewMembershipsRemoved = [...existingMembershipKeys].filter((key) => !incomingMembershipKeys.has(key)).length
  const plannedCells = catalog.activities.flatMap((activity) => activity.schedule)
  const executions = catalog.importedExecutions ?? []
  const scheduleClassificationsPending = catalog.activities.filter((activity) => activity.schedule.length === 0).length
  const warnings = [...(catalog.warnings ?? [])]
  const blockingErrors: string[] = []
  const extraActivities = existingActivities.filter((activity) => !catalog.activities.some((candidate) => candidate.n === activity.n))
  if (extraActivities.length > 0) {
    blockingErrors.push(
      `General es autoritativa: el programa contiene actividades ajenas al archivo (${extraActivities.map((activity) => activity.n).join(", ")}). ` +
      "La importación se bloqueó para no conservarlas ni borrarlas sin revisar su historial.",
    )
  }
  const retiredActivities = existingActivities.filter((activity) =>
    activity.status === "retired" && catalog.activities.some((candidate) => candidate.n === activity.n))
  if (retiredActivities.length > 0) {
    blockingErrors.push(
      `La importación no puede reactivar actividades retiradas (${retiredActivities.map((activity) => activity.n).join(", ")}). ` +
      "Publica la corrección como una nueva revisión controlada.",
    )
  }
  if (scheduleClassificationsPending > 0) {
    warnings.push(
      `${scheduleClassificationsPending} actividad(es) no tienen planificación P. ` +
      "Quedarán pendientes de clasificar; no se asumirá automáticamente que son a demanda.",
    )
  }
  if (executions.length > 0) warnings.push(`${executions.length} celda(s) E requieren seleccionar una faena y aceptar su migración sin evidencia adjunta.`)
  const batchId = `pdtp-import-${nanoid()}`
  const summary: PdtpImportPreview = {
    batchId,
    status: "staged",
    source: { fileName: input.fileName, checksumSha256, sizeBytes: input.bytes.byteLength },
    counts: {
      activities: catalog.activities.length,
      plannedCells: plannedCells.length,
      plannedQuantity: plannedCells.reduce((sum, cell) => sum + cell.plannedQuantity, 0),
      executedCells: executions.length,
      executedQuantity: executions.reduce((sum, cell) => sum + cell.executedQuantity, 0),
      views: Object.keys(catalog.sheetActivities).length,
      creates,
      updates,
      unchanged,
      existingExtraActivitiesPreserved: existingActivities.filter((activity) => !catalog.activities.some((candidate) => candidate.n === activity.n)).length,
      calendarCellsAdded: calendarChanges.reduce((sum, change) => sum + change.added, 0),
      calendarCellsUpdated: calendarChanges.reduce((sum, change) => sum + change.updated, 0),
      calendarCellsRemoved: calendarChanges.reduce((sum, change) => sum + change.removed, 0),
      scheduleRowsReplaced: existingSchedules.length,
      viewMembershipsAdded,
      viewMembershipsRemoved,
      viewMembershipRowsReplaced: existingMemberships.length,
      checklistBindingsPreserved: existingChecklists.length,
      sourceLinksPreserved: existingSourceLinks.length,
      checklistBindingsLost: 0,
      sourceLinksLost: 0,
      scheduleClassificationsPending,
    },
    calendarChanges,
    executions,
    metadata: catalog.metadata,
    warnings,
    blockingErrors,
  }
  const now = new Date().toISOString()
  const [batch] = await db.transaction(async (tx) => {
    const [created] = await tx.insert(pdtpImportBatches).values({
      id: batchId,
      programId: input.programId,
      status: "staged",
      sourceFileName: input.fileName,
      sourceMimeType: input.mimeType,
      sourceSizeBytes: input.bytes.byteLength,
      sourceChecksumSha256: checksumSha256,
      previewJson: { catalog, summary } satisfies StoredPreview,
      metadataJson: catalog.metadata ?? {},
      warningsJson: warnings,
      requestedByUserId: input.userId,
      createdAt: now,
      updatedAt: now,
    }).returning()
    if (!created) throw new Error("No se pudo crear el lote de importación.")
    const rows: Array<typeof pdtpImportRows.$inferInsert> = [
      ...catalog.activities.map((activity) => ({
        id: `${batchId}-activity-${activity.n}`,
        batchId,
        rowKind: "activity",
        stableKey: `activity:${activity.n}`,
        severity: "info",
        sourceSheet: PDTP_2026_GENERAL_SHEET_NAME,
        sourceRow: activity.sourceSheetRow,
        activityNumber: activity.n,
        payloadJson: activity,
        createdAt: now,
      })),
      ...executions.map((execution) => ({
        id: `${batchId}-execution-${execution.activityNumber}-${execution.sourceCell}`,
        batchId,
        rowKind: "execution",
        stableKey: `execution:${execution.activityNumber}:${execution.sourceCell}`,
        severity: "warning",
        sourceSheet: execution.sourceSheet,
        sourceCell: execution.sourceCell,
        sourceRow: execution.sourceRow,
        activityNumber: execution.activityNumber,
        payloadJson: execution,
        createdAt: now,
      })),
      {
        id: `${batchId}-metadata`, batchId, rowKind: "metadata", stableKey: "metadata:workbook", severity: "info",
        sourceSheet: PDTP_2026_GENERAL_SHEET_NAME, payloadJson: catalog.metadata ?? {}, createdAt: now,
      },
      ...warnings.map((warning, index) => ({
        id: `${batchId}-warning-${index + 1}`, batchId, rowKind: "warning", stableKey: `warning:${index + 1}`,
        severity: "warning", payloadJson: { message: warning }, createdAt: now,
      })),
    ]
    await tx.insert(pdtpImportRows).values(rows)
    await addPdtpChangeLogEntry(input.programId, program.version, input.userId, "import:stage", null, {
      batchId, checksumSha256, counts: summary.counts,
    }, "Archivo Excel analizado y guardado en staging; el programa no fue modificado.", tx)
    return [created]
  })
  return { batch: batch!, preview: summary }
}

function storedPreview(batch: typeof pdtpImportBatches.$inferSelect): StoredPreview {
  const stored = batch.previewJson as StoredPreview
  if (!stored?.catalog?.activities || !stored.summary) throw new Error("El lote no contiene un preview aplicable.")
  return stored
}

async function captureImportSnapshot(client: Tx | typeof db, programId: string, activityNumbers: number[]): Promise<ImportSnapshot> {
  const [program] = await client.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  const activities = await client.select().from(pdtpActivities)
    .where(and(eq(pdtpActivities.programId, programId), inArray(pdtpActivities.n, activityNumbers)))
  const ids = activities.map((activity) => activity.id)
  const [schedules, memberships, sheets] = await Promise.all([
    ids.length ? client.select().from(pdtpActivitySchedule).where(inArray(pdtpActivitySchedule.activityId, ids)) : [],
    ids.length ? client.select().from(pdtpSheetActivities).where(inArray(pdtpSheetActivities.activityId, ids)) : [],
    client.select().from(pdtpSheets).where(eq(pdtpSheets.programId, programId)),
  ])
  return {
    program,
    activities,
    schedules,
    memberships,
    sheets,
    importedActivityIds: ids,
    newlyCreatedActivityIds: [],
  }
}

export async function applyPdtpImportBatch(input: {
  batchId: string
  userId: string
  worksiteId?: string
  acceptMissingEvidence?: boolean
  acceptanceReason?: string
  scope: WorksiteScope
}) {
  const [batch] = await db.select().from(pdtpImportBatches).where(eq(pdtpImportBatches.id, input.batchId)).limit(1)
  if (!batch) throw new Error("Lote de importación no encontrado.")
  if (batch.status === "applied") return batch.applyResultJson as Record<string, unknown>
  if (batch.status !== "staged" && batch.status !== "rolled_back") throw new Error("El lote no está disponible para aplicar.")
  const stored = storedPreview(batch)
  const executions = stored.catalog.importedExecutions ?? []
  if (input.worksiteId) {
    if (input.scope !== "all" && !input.scope.includes(input.worksiteId)) {
      throw new Error("No tienes esa faena autorizada. Elige una de tus faenas asignadas.")
    }
    assertWorksiteAccess(input.worksiteId, input.scope)
    if (!await isActivePdtpWorksite(input.worksiteId)) throw new Error("La faena seleccionada no existe o está inactiva.")
  }
  if (executions.length > 0) {
    if (!input.worksiteId) throw new Error("Selecciona la faena a la que corresponden las cantidades ejecutadas del archivo.")
    // Mensaje propio: el genérico de `assertWorksiteAccess` ("Actividad PDTP no
    // encontrada o sin acceso a la faena") es deliberadamente ambiguo para no
    // filtrar existencia, pero acá el usuario eligió de su propia lista de
    // faenas y no explicar que el problema es de alcance solo desconcierta.
    if (!input.acceptMissingEvidence || (input.acceptanceReason?.trim().length ?? 0) < 10) {
      throw new Error("Acepta explícitamente la migración sin evidencia adjunta e indica un motivo de al menos 10 caracteres.")
    }
  }
  if (stored.summary.blockingErrors.length > 0) {
    throw new Error(`El lote tiene errores bloqueantes: ${stored.summary.blockingErrors.join(" ")}`)
  }

  const now = new Date().toISOString()

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${pdtpImportBatches} WHERE id = ${input.batchId} FOR UPDATE`)
    const [lockedBatch] = await tx.select().from(pdtpImportBatches).where(eq(pdtpImportBatches.id, input.batchId)).limit(1)
    if (!lockedBatch) throw new Error("Lote de importación no encontrado.")
    if (lockedBatch.status === "applied") return lockedBatch.applyResultJson as Record<string, unknown>
    if (lockedBatch.status !== "staged" && lockedBatch.status !== "rolled_back") throw new Error("El lote no está disponible para aplicar.")
    const batch = lockedBatch
    const stored = storedPreview(batch)
    if (stored.summary.blockingErrors.length > 0) {
      throw new Error(`El lote tiene errores bloqueantes: ${stored.summary.blockingErrors.join(" ")}`)
    }

    await tx.execute(sql`SELECT id FROM ${pdtpPrograms} WHERE id = ${batch.programId} FOR UPDATE`)
    const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, batch.programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    assertPdtpProgramEditableState(program)
    const activityNumbers = stored.catalog.activities.map((activity) => activity.n)
    const snapshot = await captureImportSnapshot(tx, batch.programId, activityNumbers)
    const existingByNumber = new Map(snapshot.activities.map((activity) => [activity.n, activity]))
    const allProgramActivities = await tx.select({
      id: pdtpActivities.id,
      n: pdtpActivities.n,
      status: pdtpActivities.status,
    }).from(pdtpActivities).where(eq(pdtpActivities.programId, batch.programId))
    const incomingNumbers = new Set(activityNumbers)
    const unexpected = allProgramActivities.filter((activity) => !incomingNumbers.has(activity.n))
    if (unexpected.length > 0) {
      throw new Error(`General es autoritativa y el programa contiene actividades ajenas (${unexpected.map((activity) => activity.n).join(", ")}).`)
    }
    const retired = allProgramActivities.filter((activity) => activity.status === "retired" && incomingNumbers.has(activity.n))
    if (retired.length > 0) {
      throw new Error(`La importación no puede reactivar actividades retiradas (${retired.map((activity) => activity.n).join(", ")}).`)
    }
    const allProgramIds = new Set(allProgramActivities.map((row) => row.id))
    const activityIdByNumber = new Map<number, string>()
    const createdIds: string[] = []
    const responsibleRows = collectResponsibleCatalog(stored.catalog)
    if (responsibleRows.length > 0) await tx.insert(pdtpResponsibleCatalog).values(responsibleRows).onConflictDoUpdate({
      target: pdtpResponsibleCatalog.slug,
      set: {
        displayName: sql`excluded.display_name`, roleName: sql`excluded.role_name`,
        kind: sql`excluded.kind`, notes: sql`excluded.notes`,
      },
    })

    for (const [code, meta] of Object.entries(SHEET_META)) {
      if (!(code in stored.catalog.sheetActivities)) continue
      await tx.insert(pdtpSheets).values({
        id: `${batch.programId}-${code}`, code, programId: batch.programId,
        label: meta.label, area: meta.area, defaultScopeRoles: meta.defaultScopeRoles,
      }).onConflictDoUpdate({
        target: pdtpSheets.id,
        set: { label: meta.label, area: meta.area, defaultScopeRoles: meta.defaultScopeRoles, isActive: true },
      })
    }

    for (const activity of stored.catalog.activities) {
      const existing = existingByNumber.get(activity.n)
      let activityId = existing?.id ?? pdtpActivityId(batch.programId, activity.n)
      if (!existing && allProgramIds.has(activityId)) activityId = `${pdtpActivityId(batch.programId, activity.n)}-${nanoid(6)}`
      activityIdByNumber.set(activity.n, activityId)
      const values = {
        displayOrder: activity.n,
        status: "active",
        retiredReason: null,
        retiredEffectiveFrom: null,
        retiredByUserId: null,
        retiredAt: null,
        ...writePdtpActivityContent({
          activityDescription: activity.activity,
          executionGuidance: activity.program,
        }),
        responsibleSlugs: activity.responsibleSlugs,
        // La planilla trae la abreviatura ("PRF", "Sup, JT"); se expande al cargo
        // igual que en el bootstrap (catalog.ts), o la UI muestra la sigla cruda.
        responsibleDisplay: displayNameForActivity(activity.responsibleSlugs, activity.responsibleDisplay),
        scheduleMode: activity.schedule.length > 0 ? "scheduled" : "on_demand",
        scheduleClassificationStatus: activity.schedule.length > 0 ? "confirmed" : "needs_review",
        recurrenceRule: null,
        indicatorMode: activity.schedule.length > 0 ? "planned_vs_completed" : "closed_on_time",
        sourceSheetRow: activity.sourceSheetRow,
        updatedAt: now,
      } as const
      if (existing) await tx.update(pdtpActivities).set(values).where(eq(pdtpActivities.id, existing.id))
      else {
        await tx.insert(pdtpActivities).values({
          id: activityId, programId: batch.programId, n: activity.n, ...values,
          audienceRoles: [],
          createdAt: now, notes: null,
        })
        createdIds.push(activityId)
      }
    }
    snapshot.newlyCreatedActivityIds = createdIds
    const importedIds = [...activityIdByNumber.values()]
    if (importedIds.length > 0) {
      await tx.delete(pdtpActivitySchedule).where(inArray(pdtpActivitySchedule.activityId, importedIds))
      await tx.delete(pdtpSheetActivities).where(inArray(pdtpSheetActivities.activityId, importedIds))
    }
    const scheduleRows = stored.catalog.activities.flatMap((activity) => {
      const activityId = activityIdByNumber.get(activity.n)!
      return activity.schedule.map((cell) => ({
        id: pdtpScheduleId(activityId, program.year, cell.month, cell.week), activityId,
        year: program.year, month: cell.month, week: cell.week,
        plannedQuantity: cell.plannedQuantity, sourceColumn: cell.sourceColumn,
      }))
    })
    if (scheduleRows.length > 0) await tx.insert(pdtpActivitySchedule).values(scheduleRows)

    const membershipRows = Object.entries(stored.catalog.sheetActivities).flatMap(([sheetCode, numbers]) => numbers.flatMap((activityNumber, index) => {
      const activityId = activityIdByNumber.get(activityNumber)
      return activityId ? [{
        id: pdtpSheetActivityId(batch.programId, sheetCode, activityNumber),
        sheetId: `${batch.programId}-${sheetCode}`, sheetCode, activityId,
        sheetRow: index + 1, displayOrder: index + 1,
      }] : []
    }))
    if (membershipRows.length > 0) await tx.insert(pdtpSheetActivities).values(membershipRows)

    let executionCount = 0
    for (const execution of executions) {
      const activityId = activityIdByNumber.get(execution.activityNumber)
      if (!activityId || !input.worksiteId) continue
      const [conflict] = await tx.select().from(pdtpExecutions).where(and(
        eq(pdtpExecutions.activityId, activityId), eq(pdtpExecutions.worksiteId, input.worksiteId),
        eq(pdtpExecutions.year, program.year), eq(pdtpExecutions.month, execution.month), eq(pdtpExecutions.week, execution.week),
        isNull(pdtpExecutions.obligationId),
        ne(pdtpExecutions.origin, "integration"),
      )).limit(1)
      const idempotencyKey = `pdtp-xlsx:${batch.sourceChecksumSha256}:${execution.sourceSheet}:${execution.sourceCell}:${execution.activityNumber}:${input.worksiteId}`
      if (conflict && conflict.idempotencyKey !== idempotencyKey) {
        throw new Error(`La ejecución ${execution.sourceCell} entra en conflicto con un registro existente de la actividad ${execution.activityNumber}.`)
      }
      if (!conflict) {
        await tx.insert(pdtpExecutions).values({
          id: pdtpExecutionId(activityId, input.worksiteId, program.year, execution.month, execution.week),
          activityId, worksiteId: input.worksiteId, year: program.year, month: execution.month, week: execution.week,
          executedQuantity: execution.executedQuantity, status: "submitted",
          evidenceText: `Migrado desde ${batch.sourceFileName}, celda ${execution.sourceCell}; sin evidencia adjunta.`,
          executedByUserId: input.userId, executedAt: now,
          origin: "xlsx_import", sourceType: "pdtp_xlsx_cell", sourceId: `${execution.sourceSheet}!${execution.sourceCell}`,
          idempotencyKey, importBatchId: batch.id, sourceMetadataJson: execution,
          evidenceStatus: "migrated_without_attachment", createdAt: now, updatedAt: now,
        })
        executionCount += 1
      }
    }

    const metadata = stored.catalog.metadata
    if (metadata) {
      const documentHistory = buildImportedDocumentHistory(metadata, batch.programId, batch.id, now)
      if (documentHistory.length > 0) await tx.insert(pdtpDocumentHistory).values(documentHistory).onConflictDoNothing()
      if (metadata.roleLegend.length > 0) {
        await tx.insert(pdtpRoleLegendEntries).values(metadata.roleLegend.map((entry, index) => ({
          id: `${batch.id}-role-${index + 1}`,
          programId: batch.programId,
          code: entry.code,
          label: entry.label,
          sourceImportBatchId: batch.id,
          createdAt: now,
        }))).onConflictDoNothing()
      }
    }
    const isOfficialBase2026 = program.year === 2026
      && batch.sourceChecksumSha256 === PDTP_2026_PROGRAM_SOURCE.sha256
    await tx.update(pdtpPrograms).set({
      creationMode: isOfficialBase2026 ? "base_2026" : "xlsx_import",
      sourceProgramId: null,
      sourceContentVersion: null,
      sourceTemplateVersionId: null,
      documentCode: metadata?.documentCode ?? null,
      indicatorName: metadata?.indicatorObjective ?? null,
      indicatorType: metadata?.indicatorType ?? null,
      indicatorFormula: metadata?.indicatorFormula ?? null,
      complianceTarget: metadata?.indicatorTarget ?? program.complianceTarget,
      indicatorPeriodicity: metadata?.indicatorPeriodicity ?? null,
      measurementOwner: metadata?.measurementOwner ?? null,
      sourceMetadataJson: {
        ...(metadata ?? {}),
        source: {
          fileName: batch.sourceFileName,
          sizeBytes: batch.sourceSizeBytes,
          checksumSha256: batch.sourceChecksumSha256,
          adapterCode: batch.adapterCode,
        },
      },
      updatedAt: now,
    }).where(eq(pdtpPrograms.id, batch.programId))

    const applyResult = {
      batchId: batch.id,
      activityCount: stored.catalog.activities.length,
      sheetCount: Object.keys(stored.catalog.sheetActivities).length,
      plannedCellCount: scheduleRows.length,
      importedExecutionCount: executionCount,
      preservedExtraActivities: stored.summary.counts.existingExtraActivitiesPreserved,
    }
    await tx.update(pdtpImportBatches).set({
      status: "applied",
      preApplySnapshotJson: { ...snapshot, newlyCreatedActivityIds: createdIds },
      applyResultJson: applyResult,
      targetWorksiteId: input.worksiteId ?? null,
      acceptedMissingEvidence: input.acceptMissingEvidence ?? false,
      acceptanceReason: input.acceptanceReason?.trim() || null,
      appliedByUserId: input.userId,
      appliedAt: now,
      updatedAt: now,
    }).where(and(eq(pdtpImportBatches.id, batch.id), ne(pdtpImportBatches.status, "applied")))
    await addPdtpChangeLogEntry(batch.programId, program.version, input.userId, "import:apply", null, applyResult, "Lote Excel aplicado atómicamente desde staging.", tx)
    return applyResult
  })
  return result
}

export async function finalizePdtpImportBootstrap(input: {
  batchId: string
  userId: string
  checklistIdsCreated: string[]
  templateIdCreated?: string
  templateVersionIdCreated?: string
}) {
  const [batch] = await db.select().from(pdtpImportBatches).where(eq(pdtpImportBatches.id, input.batchId)).limit(1)
  if (!batch || batch.status !== "applied") throw new Error("El lote debe estar aplicado antes de registrar el postproceso.")
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, batch.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  const priorResult = (batch.applyResultJson ?? {}) as Record<string, unknown>
  const priorArtifacts = (priorResult.bootstrapArtifacts ?? {}) as Partial<BootstrapArtifacts>
  const artifacts: BootstrapArtifacts = {
    checklistIdsCreated: [...new Set([...(priorArtifacts.checklistIdsCreated ?? []), ...input.checklistIdsCreated])],
    templateIdCreated: priorArtifacts.templateIdCreated ?? input.templateIdCreated,
    templateVersionIdCreated: priorArtifacts.templateVersionIdCreated ?? input.templateVersionIdCreated,
  }
  const applyResult = { ...priorResult, bootstrapArtifacts: artifacts }
  const now = new Date().toISOString()
  await db.transaction(async (tx) => {
    await tx.update(pdtpImportBatches).set({ applyResultJson: applyResult, updatedAt: now })
      .where(eq(pdtpImportBatches.id, batch.id))
    await addPdtpChangeLogEntry(batch.programId, program.version, input.userId, "import:bootstrap", priorArtifacts, {
      batchId: batch.id,
      ...artifacts,
    }, "Postproceso idempotente del bootstrap 2026 registrado.", tx)
  })
  return artifacts
}

export async function rollbackPdtpImportBatch(input: { batchId: string; userId: string; reason: string; scope: WorksiteScope }) {
  if (input.reason.trim().length < 10) throw new Error("Indica un motivo de rollback de al menos 10 caracteres.")
  const now = new Date().toISOString()
  // Todo dentro de la transacción y con los mismos locks que `applyPdtpImportBatch`
  // (batch y luego programa, en ese orden para no invertir el orden de bloqueo):
  // la guarda de "cambios posteriores" se evaluaba fuera, así que entre ella y
  // el restore alguien podía editar una actividad y el rollback la pisaba sin
  // dejar rastro. Dos rollbacks concurrentes también entraban ambos.
  await db.transaction(async (tx) => {
    const [batch] = await tx.select().from(pdtpImportBatches)
      .where(eq(pdtpImportBatches.id, input.batchId)).for("update").limit(1)
    if (!batch || batch.status !== "applied" || !batch.appliedAt || !batch.preApplySnapshotJson) throw new Error("El lote no está aplicado o no tiene snapshot de rollback.")
    if (batch.targetWorksiteId) assertWorksiteAccess(batch.targetWorksiteId, input.scope)
    await tx.select({ id: pdtpPrograms.id }).from(pdtpPrograms)
      .where(eq(pdtpPrograms.id, batch.programId)).for("update").limit(1)

    const applyResult = (batch.applyResultJson ?? {}) as Record<string, unknown>
    const artifacts = (applyResult.bootstrapArtifacts ?? {}) as Partial<BootstrapArtifacts>
    const laterChanges = await tx.select({
      id: pdtpChangeLog.id,
      changedAt: pdtpChangeLog.changedAt,
      section: pdtpChangeLog.section,
      after: pdtpChangeLog.after,
    }).from(pdtpChangeLog).where(and(
      eq(pdtpChangeLog.programId, batch.programId),
      ne(pdtpChangeLog.section, "import:apply"),
    ))
    const appliedMs = new Date(batch.appliedAt).getTime()
    const hasLaterChange = laterChanges.some((change) => {
      if (new Date(change.changedAt).getTime() <= appliedMs) return false
      const after = (change.after ?? {}) as Record<string, unknown>
      if (change.section === "import:bootstrap" && after.batchId === batch.id) return false
      if (change.section === "template:publish" && artifacts.templateVersionIdCreated
        && after.templateVersionId === artifacts.templateVersionIdCreated) return false
      return true
    })
    if (hasLaterChange) throw new Error("No se puede revertir: el programa tiene cambios posteriores al lote.")

    const snapshot = batch.preApplySnapshotJson as ImportSnapshot
    const checklistIds = artifacts.checklistIdsCreated ?? []
    if (checklistIds.length > 0) {
      const instances = await tx.select({ id: pdtpExecutionChecklists.id }).from(pdtpExecutionChecklists)
        .where(inArray(pdtpExecutionChecklists.checklistId, checklistIds))
      if (instances.length > 0) throw new Error("No se puede revertir: un checklist creado por el lote ya tiene respuestas operacionales.")
      await tx.delete(pdtpActivityChecklists).where(inArray(pdtpActivityChecklists.id, checklistIds))
    }
    await tx.delete(pdtpDocumentHistory).where(eq(pdtpDocumentHistory.sourceImportBatchId, batch.id))
    await tx.delete(pdtpRoleLegendEntries).where(eq(pdtpRoleLegendEntries.sourceImportBatchId, batch.id))
    await tx.delete(pdtpExecutions).where(eq(pdtpExecutions.importBatchId, batch.id))
    const currentImportedIds = [...new Set([
      ...snapshot.importedActivityIds,
      ...snapshot.newlyCreatedActivityIds,
      ...snapshot.activities.map((activity) => activity.id),
    ])]
    if (currentImportedIds.length > 0) {
      await tx.delete(pdtpSheetActivities).where(inArray(pdtpSheetActivities.activityId, currentImportedIds))
      await tx.delete(pdtpActivitySchedule).where(inArray(pdtpActivitySchedule.activityId, currentImportedIds))
    }
    if (snapshot.newlyCreatedActivityIds.length > 0) await tx.delete(pdtpActivities).where(inArray(pdtpActivities.id, snapshot.newlyCreatedActivityIds))
    for (const activity of snapshot.activities) await tx.update(pdtpActivities).set(activity).where(eq(pdtpActivities.id, activity.id))
    if (snapshot.schedules.length > 0) await tx.insert(pdtpActivitySchedule).values(snapshot.schedules)
    if (snapshot.memberships.length > 0) await tx.insert(pdtpSheetActivities).values(snapshot.memberships)
    const previousSheetIds = new Set(snapshot.sheets.map((sheet) => sheet.id))
    const currentSheets = await tx.select().from(pdtpSheets).where(eq(pdtpSheets.programId, batch.programId))
    const createdSheetIds = currentSheets.filter((sheet) => !previousSheetIds.has(sheet.id)).map((sheet) => sheet.id)
    if (createdSheetIds.length > 0) await tx.delete(pdtpSheets).where(inArray(pdtpSheets.id, createdSheetIds))
    for (const sheet of snapshot.sheets) await tx.insert(pdtpSheets).values(sheet).onConflictDoUpdate({ target: pdtpSheets.id, set: sheet })
    await tx.update(pdtpPrograms).set({ ...(snapshot.program as Partial<typeof pdtpPrograms.$inferInsert>), updatedAt: now }).where(eq(pdtpPrograms.id, batch.programId))
    await tx.update(pdtpImportBatches).set({ status: "rolled_back", rolledBackByUserId: input.userId, rolledBackAt: now, updatedAt: now }).where(eq(pdtpImportBatches.id, batch.id))
    await addPdtpChangeLogEntry(
      batch.programId,
      Number(snapshot.program.version ?? 1),
      input.userId,
      "import:rollback",
      batch.applyResultJson as Record<string, unknown>,
      { reason: input.reason, immutableTemplateVersionRetained: artifacts.templateVersionIdCreated ?? null },
      "Lote Excel revertido desde su snapshot previo; las revisiones de Base ya publicadas permanecen inmutables.",
      tx,
    )
  })
  return { rolledBack: true }
}

export async function cancelPdtpImportBatch(input: { batchId: string; userId: string; reason: string }) {
  const reason = input.reason.trim()
  if (reason.length < 10) throw new Error("Indica un motivo de cancelación de al menos 10 caracteres.")
  const [batch] = await db.select().from(pdtpImportBatches).where(eq(pdtpImportBatches.id, input.batchId)).limit(1)
  if (!batch) throw new Error("Lote de importación no encontrado.")
  if (batch.status === "cancelled") return { cancelled: true, batchId: batch.id }
  if (batch.status !== "staged") throw new Error("Solo se puede cancelar un lote que aún está en preview.")
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, batch.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  const now = new Date().toISOString()
  await db.transaction(async (tx) => {
    const [updated] = await tx.update(pdtpImportBatches).set({
      status: "cancelled",
      cancelledByUserId: input.userId,
      cancelledAt: now,
      cancellationReason: reason,
      updatedAt: now,
    }).where(and(eq(pdtpImportBatches.id, batch.id), eq(pdtpImportBatches.status, "staged"))).returning({ id: pdtpImportBatches.id })
    if (!updated) throw new Error("El lote cambió de estado antes de poder cancelarlo.")
    await addPdtpChangeLogEntry(batch.programId, program.version, input.userId, "import:cancel", null, {
      batchId: batch.id,
      reason,
      checksumSha256: batch.sourceChecksumSha256,
    }, "Preview Excel cancelado sin modificar el programa.", tx)
  })
  return { cancelled: true, batchId: batch.id }
}

export async function getPdtpImportBatch(batchId: string) {
  const [batch] = await db.select().from(pdtpImportBatches).where(eq(pdtpImportBatches.id, batchId)).limit(1)
  if (!batch) return null
  return { batch, preview: storedPreview(batch).summary }
}
