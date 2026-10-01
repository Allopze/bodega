import { and, asc, eq, gt, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { preventionPdtpSourceLinks, preventionRiskControls, preventionRiskEntries, preventionRiskFactors, preventionRiskMapMarkers, preventionRiskMatrices } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { cleanMiperName } from "@/lib/prevention/miper/names"
import { miperControlRefSchema, miperControlSaveSchema, miperEntryRefSchema, miperEntrySaveSchema, type MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { resolveDictionaryId } from "./dictionaries"
import { notifyMiperRowIntolerable } from "./notifications"
import { assertActiveUsers, assertEditable, type Client, lockMatrix, type MiperAccess, miperHistory, nowIso, requireAccess, userNames } from "./shared"

const STALE_ENTRY = "La fila cambió mientras la editabas. Recarga la matriz para ver el cambio de la otra persona."
const STALE_CONTROL = "La medida cambió mientras la editabas. Recarga la matriz."
const EDIT = "prevention:risk:edit"

export type SavedEntry = { id: string; version: number; rowNumber: number; magnitude: number | null; classification: string | null }

function saved(row: typeof preventionRiskEntries.$inferSelect): SavedEntry {
  return { id: row.id, version: row.version, rowNumber: row.rowNumber ?? 0, magnitude: row.magnitude, classification: row.classification }
}

async function touchMatrix(client: Client, matrixId: string, now: string) {
  // Sin tocar `version`: ese es el candado del encabezado y del flujo. Sí
  // `updated_at`, que la bandeja usa para detectar "cambios sin enviar".
  await client.update(preventionRiskMatrices).set({ updatedAt: now }).where(eq(preventionRiskMatrices.id, matrixId))
}

async function activePdtpLink(client: Client, controlIds: string[]) {
  if (controlIds.length === 0) return false
  const [link] = await client.select({ id: preventionPdtpSourceLinks.id }).from(preventionPdtpSourceLinks)
    .where(and(eq(preventionPdtpSourceLinks.sourceType, "risk_control"), inArray(preventionPdtpSourceLinks.sourceId, controlIds), eq(preventionPdtpSourceLinks.isActive, true))).limit(1)
  return Boolean(link)
}

async function toColumns(client: Client, worksiteId: string, values: MiperEntryValues): Promise<Partial<typeof preventionRiskEntries.$inferInsert>> {
  const out: Partial<typeof preventionRiskEntries.$inferInsert> = {}
  if ("activity" in values) out.processId = await resolveDictionaryId(client, "activity", worksiteId, values.activity)
  if ("task" in values) out.taskId = await resolveDictionaryId(client, "task", worksiteId, values.task)
  if ("position" in values) out.positionId = await resolveDictionaryId(client, "position", worksiteId, values.position)
  if ("location" in values) out.locationId = await resolveDictionaryId(client, "location", worksiteId, values.location)
  if ("hazard" in values) out.hazard = cleanMiperName(values.hazard)
  if ("risk" in values) out.risk = cleanMiperName(values.risk)
  if ("probableDamage" in values) out.probableDamage = cleanMiperName(values.probableDamage)
  if (values.exposedFemale !== undefined) out.exposedFemale = values.exposedFemale
  if (values.exposedMale !== undefined) out.exposedMale = values.exposedMale
  if (values.exposedOther !== undefined) out.exposedOther = values.exposedOther
  if ("isRoutine" in values) out.isRoutine = values.isRoutine ?? null
  if ("probability" in values) out.probability = values.probability ?? null
  if ("consequence" in values) out.consequence = values.consequence ?? null
  if ("controlledStatus" in values) out.controlledStatus = values.controlledStatus ?? null
  if ("riskFactorId" in values) {
    if (values.riskFactorId) {
      const [factor] = await client.select({ isActive: preventionRiskFactors.isActive }).from(preventionRiskFactors).where(eq(preventionRiskFactors.id, values.riskFactorId)).limit(1)
      if (!factor || !factor.isActive) throw new RiskLegalDomainError("El factor de riesgo no existe o está desactivado en el catálogo.")
    }
    out.riskFactorId = values.riskFactorId ?? null
  }
  return out
}

export async function saveMiperEntry(input: unknown, access: MiperAccess): Promise<SavedEntry> {
  const data = miperEntrySaveSchema.parse(input)
  /* Enganche de «fila pasa a Intolerable» (§9.1). La clasificación es una
   * columna generada, así que no hay evento de base que escuchar: el único punto
   * donde se escribe de verdad es acá (y la importación RE-04, que entra por
   * `notifyMiperRowIntolerable`). La transacción devuelve si hubo cruce, y el
   * aviso sale DESPUÉS de que resolvió —nunca dentro del callback—: sus
   * destinatarios se resuelven con `getUserIdsWithPermissionForWorksite`, que usa
   * la conexión global `db`. */
  const result = await db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    const columns = await toColumns(tx, matrix.worksiteId, data.values)
    const now = nowIso()
    const crossed = (before: string | null, after: string | null) => after === "intolerable" && before !== "intolerable"
    if (!data.entryId) {
      const [row] = await tx.select({ maxRow: sql<number>`coalesce(max(${preventionRiskEntries.rowNumber}), 0)::int` }).from(preventionRiskEntries).where(eq(preventionRiskEntries.matrixId, matrix.id))
      const maxRow = row?.maxRow ?? 0
      const after = Math.min(data.insertAfterRowNumber ?? maxRow, maxRow)
      if (after < maxRow) {
        await tx.update(preventionRiskEntries).set({ rowNumber: sql`${preventionRiskEntries.rowNumber} + 1` })
          .where(and(eq(preventionRiskEntries.matrixId, matrix.id), gt(preventionRiskEntries.rowNumber, after)))
      }
      const [created] = await tx.insert(preventionRiskEntries).values({
        id: `riskentry-${nanoid()}`, matrixId: matrix.id, rowNumber: after + 1, hazardCode: `R-${nanoid(8)}`, ...columns, createdAt: now, updatedAt: now,
      }).returning()
      await touchMatrix(tx, matrix.id, now)
      await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "entry", objectId: created!.id, changeType: "entry_created", after: data.values, actorUserId: access.userId, actingAs: EDIT })
      return { entry: saved(created!), notified: crossed(null, created!.classification), worksiteId: matrix.worksiteId, matrixTitle: matrix.title }
    }
    const [current] = await tx.select().from(preventionRiskEntries).where(and(eq(preventionRiskEntries.id, data.entryId), eq(preventionRiskEntries.matrixId, matrix.id))).limit(1)
    if (!current) throw new RiskLegalDomainError("La fila no existe en esta MIPER; recarga la matriz.")
    if (current.version !== data.expectedVersion) throw new RiskLegalDomainError(STALE_ENTRY)
    const [updated] = await tx.update(preventionRiskEntries).set({ ...columns, version: current.version + 1, updatedAt: now })
      .where(and(eq(preventionRiskEntries.id, current.id), eq(preventionRiskEntries.version, current.version))).returning()
    if (!updated) throw new RiskLegalDomainError(STALE_ENTRY)
    await touchMatrix(tx, matrix.id, now)
    await miperHistory(tx, {
      matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "entry", objectId: current.id, changeType: "entry_updated",
      before: Object.fromEntries(Object.keys(columns).map((key) => [key, current[key as keyof typeof current]])), after: columns,
      actorUserId: access.userId, actingAs: EDIT,
    })
    return { entry: saved(updated), notified: crossed(current.classification, updated.classification), worksiteId: matrix.worksiteId, matrixTitle: matrix.title }
  })

  if (result.notified) {
    notifyMiperRowIntolerable({
      matrixId: data.matrixId, worksiteId: result.worksiteId, matrixTitle: result.matrixTitle,
      entryId: result.entry.id, rowNumber: result.entry.rowNumber, actorUserId: access.userId,
    })
  }
  return result.entry
}

const duplicateSchema = z.object({ matrixId: z.string().min(1), entryId: z.string().min(1) })

export async function duplicateMiperEntry(input: unknown, access: MiperAccess): Promise<SavedEntry> {
  const data = duplicateSchema.parse(input)
  return db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    const [source] = await tx.select().from(preventionRiskEntries).where(and(eq(preventionRiskEntries.id, data.entryId), eq(preventionRiskEntries.matrixId, matrix.id))).limit(1)
    if (!source) throw new RiskLegalDomainError("La fila no existe en esta MIPER; recarga la matriz.")
    const after = source.rowNumber ?? 0
    await tx.update(preventionRiskEntries).set({ rowNumber: sql`${preventionRiskEntries.rowNumber} + 1` })
      .where(and(eq(preventionRiskEntries.matrixId, matrix.id), gt(preventionRiskEntries.rowNumber, after)))
    const now = nowIso()
    const { magnitude: _m, classification: _c, ...copy } = source
    const [created] = await tx.insert(preventionRiskEntries).values({ ...copy, id: `riskentry-${nanoid()}`, rowNumber: after + 1, hazardCode: `R-${nanoid(8)}`, version: 1, createdAt: now, updatedAt: now }).returning()
    const controls = await tx.select().from(preventionRiskControls).where(eq(preventionRiskControls.riskEntryId, source.id)).orderBy(asc(preventionRiskControls.createdAt))
    if (controls.length > 0) {
      await tx.insert(preventionRiskControls).values(controls.map((control) => ({
        ...control, id: `riskcontrol-${nanoid()}`, riskEntryId: created!.id, status: "proposed", effectivenessStatus: "not_assessed",
        lastVerifiedAt: null, lastVerifiedByUserId: null, version: 1, createdAt: now, updatedAt: now,
      })))
    }
    await touchMatrix(tx, matrix.id, now)
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "entry", objectId: created!.id, changeType: "entry_duplicated", after: { sourceEntryId: source.id }, actorUserId: access.userId, actingAs: EDIT })
    return saved(created!)
  })
}

export async function deleteMiperEntry(input: unknown, access: MiperAccess) {
  const data = miperEntryRefSchema.parse(input)
  await db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    const [entry] = await tx.select().from(preventionRiskEntries).where(and(eq(preventionRiskEntries.id, data.entryId), eq(preventionRiskEntries.matrixId, matrix.id))).limit(1)
    if (!entry) throw new RiskLegalDomainError("La fila no existe en esta MIPER; recarga la matriz.")
    if (data.expectedVersion !== undefined && entry.version !== data.expectedVersion) throw new RiskLegalDomainError(STALE_ENTRY)
    const [marker] = await tx.select({ id: preventionRiskMapMarkers.id }).from(preventionRiskMapMarkers).where(eq(preventionRiskMapMarkers.riskEntryId, entry.id)).limit(1)
    if (marker) throw new RiskLegalDomainError("La fila está ubicada en el mapa de riesgos (CGRD): retira el marcador antes de eliminarla.")
    const controls = await tx.select().from(preventionRiskControls).where(eq(preventionRiskControls.riskEntryId, entry.id))
    if (await activePdtpLink(tx, controls.map((control) => control.id))) {
      throw new RiskLegalDomainError("Una medida de esta fila cubre una actividad del PDTP: retira ese vínculo de cobertura antes de eliminarla.")
    }
    await tx.delete(preventionRiskEntries).where(eq(preventionRiskEntries.id, entry.id))
    await tx.update(preventionRiskEntries).set({ rowNumber: sql`${preventionRiskEntries.rowNumber} - 1` })
      .where(and(eq(preventionRiskEntries.matrixId, matrix.id), gt(preventionRiskEntries.rowNumber, entry.rowNumber ?? 0)))
    const now = nowIso()
    await touchMatrix(tx, matrix.id, now)
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "entry", objectId: entry.id, changeType: "entry_deleted", before: { entry, controls }, actorUserId: access.userId, actingAs: EDIT })
  })
}

export async function saveMiperControl(input: unknown, access: MiperAccess) {
  const data = miperControlSaveSchema.parse(input)
  return db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    const [entry] = await tx.select({ id: preventionRiskEntries.id }).from(preventionRiskEntries).where(and(eq(preventionRiskEntries.id, data.entryId), eq(preventionRiskEntries.matrixId, matrix.id))).limit(1)
    if (!entry) throw new RiskLegalDomainError("La fila no existe en esta MIPER; recarga la matriz.")
    const responsibleUserId = data.values.responsibleUserId ?? null
    await assertActiveUsers(tx, [responsibleUserId])
    const responsibleSnapshot = responsibleUserId ? (await userNames(tx, [responsibleUserId])).get(responsibleUserId) ?? null : cleanMiperName(data.values.responsibleName)
    const values = { hierarchy: data.values.hierarchy, description: data.values.description, responsibleUserId, responsibleSnapshot, dueDate: data.values.dueDate ?? null }
    const now = nowIso()
    if (!data.controlId) {
      const [created] = await tx.insert(preventionRiskControls).values({ id: `riskcontrol-${nanoid()}`, riskEntryId: entry.id, ...values, status: "proposed", createdAt: now, updatedAt: now })
        .returning({ id: preventionRiskControls.id, version: preventionRiskControls.version })
      await touchMatrix(tx, matrix.id, now)
      await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "control", objectId: created!.id, changeType: "control_created", after: { entryId: entry.id, ...values }, actorUserId: access.userId, actingAs: EDIT })
      return created!
    }
    const [current] = await tx.select().from(preventionRiskControls).where(and(eq(preventionRiskControls.id, data.controlId), eq(preventionRiskControls.riskEntryId, entry.id))).limit(1)
    if (!current) throw new RiskLegalDomainError("La medida no existe en esta fila; recarga la matriz.")
    if (current.version !== data.expectedVersion) throw new RiskLegalDomainError(STALE_CONTROL)
    const [updated] = await tx.update(preventionRiskControls).set({ ...values, version: current.version + 1, updatedAt: now })
      .where(and(eq(preventionRiskControls.id, current.id), eq(preventionRiskControls.version, current.version)))
      .returning({ id: preventionRiskControls.id, version: preventionRiskControls.version })
    if (!updated) throw new RiskLegalDomainError(STALE_CONTROL)
    await touchMatrix(tx, matrix.id, now)
    await miperHistory(tx, {
      matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "control", objectId: current.id, changeType: "control_updated",
      before: { hierarchy: current.hierarchy, description: current.description, responsibleUserId: current.responsibleUserId, responsibleSnapshot: current.responsibleSnapshot, dueDate: current.dueDate },
      after: values, actorUserId: access.userId, actingAs: EDIT,
    })
    return updated
  })
}

export async function deleteMiperControl(input: unknown, access: MiperAccess) {
  const data = miperControlRefSchema.parse(input)
  await db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    const [row] = await tx.select({ control: preventionRiskControls }).from(preventionRiskControls)
      .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId))
      .where(and(eq(preventionRiskControls.id, data.controlId), eq(preventionRiskEntries.matrixId, matrix.id))).limit(1)
    if (!row) throw new RiskLegalDomainError("La medida no existe en esta MIPER; recarga la matriz.")
    if (row.control.version !== data.expectedVersion) throw new RiskLegalDomainError(STALE_CONTROL)
    if (await activePdtpLink(tx, [row.control.id])) throw new RiskLegalDomainError("Esta medida cubre una actividad del PDTP: retira ese vínculo de cobertura antes de eliminarla.")
    await tx.delete(preventionRiskControls).where(eq(preventionRiskControls.id, row.control.id))
    const now = nowIso()
    await touchMatrix(tx, matrix.id, now)
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "control", objectId: row.control.id, changeType: "control_deleted", before: row.control, actorUserId: access.userId, actingAs: EDIT })
  })
}
