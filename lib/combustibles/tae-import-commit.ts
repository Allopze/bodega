import { createHash } from "node:crypto"
import { and, eq, inArray, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { fuelTaeEvidence, fuelTaeImportBatches, fuelTaeImportRejections, fuelTaeLoadingPoints, fuelTaeSubmissions, fuelTaeVehicleMappings, fuelTaeWorkerMappings } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit, recordStatusChanges } from "@/lib/audit"
import { parseTaeLegacyExcel, parseTaeLegacyRecord, type ParsedTaeLegacyRow } from "./tae-import"
import { buildTaeImportReport } from "./tae-import-report"
import { FUEL_PRODUCT_IDS } from "./fuel-products"
import { auditResetDecisions } from "./projection-audit"
import { projectTaeSubmissions } from "./control/projection"
import {
  buildTaeImportPlan,
  safeTaeEvidenceUrl,
  vehicleMappingKey,
  workerMappingKey,
  type TaeImportCatalogs,
  type TaeImportMappingDecision,
  type TaeImportMappings,
  type TaeImportPlanRow,
} from "./tae-import-plan"

const loadingPointKey = (worksiteId: string, name: string) => `${worksiteId}:${name.trim().toLocaleUpperCase("es-CL")}`

/** Resuelve (y crea los que falten) los puntos de carga que nombra el histórico. */
async function ensureLoadingPoints(tx: Tx, planned: TaeImportPlanRow[]): Promise<Map<string, string>> {
  const existingPoints = await tx.query.fuelTaeLoadingPoints.findMany()
  const pointByKey = new Map(existingPoints.map((point) => [loadingPointKey(point.worksiteId, point.name), point.id]))
  const newPoints: Array<typeof fuelTaeLoadingPoints.$inferInsert> = []
  for (const item of planned) {
    const key = loadingPointKey(item.worksiteId, item.row.loadingPointName)
    if (!pointByKey.has(key)) {
      const id = nanoid()
      pointByKey.set(key, id)
      newPoints.push({ id, worksiteId: item.worksiteId, name: item.row.loadingPointName, type: "tae", importAliases: [item.row.loadingPointName] })
    }
  }
  if (newPoints.length > 0) {
    await tx.insert(fuelTaeLoadingPoints).values(newPoints).onConflictDoNothing()
    const persistedPoints = await tx.query.fuelTaeLoadingPoints.findMany()
    pointByKey.clear()
    for (const point of persistedPoints) pointByKey.set(loadingPointKey(point.worksiteId, point.name), point.id)
  }
  return pointByKey
}

/** Fila de `fuel_tae_submissions` de una carga histórica. La hora viene de la planilla (`loaded_at_source = 'import'`). */
function buildSubmissionRows(input: {
  planned: TaeImportPlanRow[]
  pointByKey: Map<string, string>
  batchId: string
  fileHash: string
  userId: string
  now: string
  fallbackReviewNote: string
}) {
  return input.planned.map((item) => ({
    id: nanoid(),
    clientSubmissionId: `legacy:${input.fileHash}:${item.row.legacySourceId}`,
    importBatchId: input.batchId,
    source: "legacy_xlsx",
    legacySourceId: item.row.legacySourceId,
    publicResultToken: nanoid(32),
    worksiteId: item.worksiteId,
    loadingPointId: input.pointByKey.get(loadingPointKey(item.worksiteId, item.row.loadingPointName))!,
    vehicleId: item.vehicleId,
    productId: FUEL_PRODUCT_IDS.historicalUnspecified,
    equipmentCodeSnapshot: item.row.equipmentCode,
    loadedAt: item.row.loadedAt,
    loadedAtSource: "import",
    submittedAt: item.row.loadedAt,
    driverWorkerId: item.driverWorkerId,
    driverNameSnapshot: item.row.driverName,
    supervisorWorkerId: item.supervisorWorkerId,
    supervisorNameSnapshot: item.row.supervisorName,
    manualIdentity: !item.driverWorkerId || !item.supervisorWorkerId,
    meterType: "odometer",
    meterReading: item.row.meterReading,
    meterReadingSource: item.row.meterReading == null ? null : "import",
    meterUnavailableReason: item.row.meterReading == null ? (item.row.meterRaw ? `Valor histórico: ${item.row.meterRaw}` : "Sin lectura en archivo histórico") : null,
    liters: item.row.liters,
    removedSealNumber: item.row.removedSealNumber,
    installedSealNumber: item.row.installedSealNumber,
    noSealReason: !item.row.removedSealNumber || !item.row.installedSealNumber ? "Información de sello incompleta en archivo histórico" : null,
    notes: item.row.notes,
    status: item.status,
    reviewNote: item.observations.length ? item.observations.join("; ") : input.fallbackReviewNote,
    reviewedBy: input.userId,
    reviewedAt: input.now,
    rawRow: item.row.rawRow,
  }))
}

function buildEvidenceRows(planned: TaeImportPlanRow[], submissions: Array<{ id: string }>) {
  return planned.flatMap((item, itemIndex) => Object.entries(item.row.evidenceUrls).flatMap(([kind, rawUrl]) => {
    const externalUrl = safeTaeEvidenceUrl(rawUrl)
    if (!externalUrl) return []
    return [{ id: nanoid(), submissionId: submissions[itemIndex]!.id, kind, fileName: `evidencia-historica-${kind}`, externalUrl, capturedAt: item.row.loadedAt }]
  }))
}

/** Lleva las cargas importadas a la serie canónica del control de combustible. */
async function projectInChunks(tx: Tx, ids: string[], userId: string) {
  for (let index = 0; index < ids.length; index += 500) {
    const projection = await projectTaeSubmissions(tx, ids.slice(index, index + 500))
    await auditResetDecisions(tx, projection.resetLoadIds, { userId }, null)
  }
}

export async function importTaeLegacyWorkbook(input: { buffer: Buffer; fileName: string; userId: string; allowedWorksiteIds?: ReadonlySet<string>; manualMappings?: TaeImportMappingDecision[] }) {
  const fileHash = createHash("sha256").update(input.buffer).digest("hex")
  const parsed = await parseTaeLegacyExcel(input.buffer)
  if (parsed.rows.length === 0) throw new Error(parsed.errors[0]?.message ?? "El archivo no contiene filas válidas")

  const [worksitesList, vehiclesList, workersList, vehicleMappings, workerMappings] = await Promise.all([
    db.query.worksites.findMany({ columns: { id: true, name: true } }),
    db.query.fuelVehicles.findMany({ columns: { id: true, code: true, plate: true, worksiteId: true }, with: { worksite: { columns: { name: true } } } }),
    db.query.workers.findMany({ where: (worker, { eq: equals }) => equals(worker.isActive, true), columns: { id: true, firstName: true, lastName: true, worksiteId: true }, with: { worksite: { columns: { name: true } } } }),
    db.query.fuelTaeVehicleMappings.findMany({ columns: { worksiteId: true, legacyCode: true, vehicleId: true } }),
    db.query.fuelTaeWorkerMappings.findMany({ columns: { worksiteId: true, role: true, legacyName: true, workerId: true } }),
  ])
  const catalogs: TaeImportCatalogs = {
    worksites: worksitesList,
    vehicles: vehiclesList.map((item) => ({ id: item.id, code: item.code, plate: item.plate, worksiteId: item.worksiteId, worksiteName: item.worksite?.name ?? "" })),
    workers: workersList.map((item) => ({ id: item.id, name: `${item.firstName} ${item.lastName}`, worksiteId: item.worksiteId, worksiteName: item.worksite?.name ?? "" })),
  }
  const mappings: TaeImportMappings = {
    vehicles: new Map(vehicleMappings.map((row) => [vehicleMappingKey(row.worksiteId, row.legacyCode), row.vehicleId])),
    drivers: new Map(workerMappings.filter((row) => row.role === "driver").map((row) => [workerMappingKey(row.worksiteId, row.legacyName), row.workerId])),
    supervisors: new Map(workerMappings.filter((row) => row.role === "supervisor").map((row) => [workerMappingKey(row.worksiteId, row.legacyName), row.workerId])),
  }
  const catalogWorksiteById = new Map(catalogs.worksites.map((worksite) => [worksite.id, worksite]))
  for (const decision of input.manualMappings ?? []) {
    if (!catalogWorksiteById.has(decision.worksiteId) || (input.allowedWorksiteIds && !input.allowedWorksiteIds.has(decision.worksiteId))) {
      throw new Error("Una decisión de mapeo apunta a una faena no autorizada")
    }
    if (!decision.legacyValue.trim()) throw new Error("Una decisión de mapeo no tiene identidad histórica")
    if (decision.targetId) {
      const validTarget = decision.kind === "vehicle"
        ? catalogs.vehicles.some((vehicle) => vehicle.id === decision.targetId && vehicle.worksiteId === decision.worksiteId)
        : catalogs.workers.some((worker) => worker.id === decision.targetId && worker.worksiteId === decision.worksiteId)
      if (!validTarget) throw new Error("Una decisión de mapeo apunta a un catálogo de otra faena")
    }
    if (decision.kind === "vehicle") mappings.vehicles.set(vehicleMappingKey(decision.worksiteId, decision.legacyValue), decision.targetId)
    else if (decision.kind === "driver") mappings.drivers.set(workerMappingKey(decision.worksiteId, decision.legacyValue), decision.targetId)
    else mappings.supervisors.set(workerMappingKey(decision.worksiteId, decision.legacyValue), decision.targetId)
  }
  const report = buildTaeImportReport({ rows: parsed.rows, errors: parsed.errors, ...catalogs })
  const plan = buildTaeImportPlan(parsed.rows, report, input.allowedWorksiteIds, mappings)
  if (plan.planned.length === 0) throw new Error("Ninguna fila válida corresponde a una faena autorizada y existente")

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${fileHash}))`)
    const existing = await tx.query.fuelTaeImportBatches.findFirst({ where: and(eq(fuelTaeImportBatches.fileHash, fileHash), eq(fuelTaeImportBatches.status, "imported")) })
    if (existing) throw new Error(`Este archivo ya fue importado el ${new Date(existing.createdAt).toLocaleString("es-CL")}`)

    for (const decision of input.manualMappings ?? []) {
      if (decision.kind === "vehicle") {
        await tx.insert(fuelTaeVehicleMappings).values({ id: nanoid(), worksiteId: decision.worksiteId, legacyCode: decision.legacyValue.trim(), vehicleId: decision.targetId, decidedBy: input.userId }).onConflictDoUpdate({ target: [fuelTaeVehicleMappings.worksiteId, fuelTaeVehicleMappings.legacyCode], set: { vehicleId: decision.targetId, decidedBy: input.userId, decidedAt: new Date().toISOString() } })
      } else {
        await tx.insert(fuelTaeWorkerMappings).values({ id: nanoid(), worksiteId: decision.worksiteId, role: decision.kind, legacyName: decision.legacyValue.trim(), workerId: decision.targetId, decidedBy: input.userId }).onConflictDoUpdate({ target: [fuelTaeWorkerMappings.worksiteId, fuelTaeWorkerMappings.role, fuelTaeWorkerMappings.legacyName], set: { workerId: decision.targetId, decidedBy: input.userId, decidedAt: new Date().toISOString() } })
      }
      await recordAudit({ userId: input.userId, action: "update", entityType: `fuel_tae_${decision.kind}_mapping`, entityId: `${decision.worksiteId}:${decision.legacyValue}`, newState: { targetId: decision.targetId }, reason: "Decisión confirmada antes de importar histórico TAE" }, tx)
    }

    const batchId = nanoid()
    const pointByKey = await ensureLoadingPoints(tx, plan.planned)

    const now = new Date().toISOString()
    const submissions = buildSubmissionRows({
      planned: plan.planned,
      pointByKey,
      batchId,
      fileHash,
      userId: input.userId,
      now,
      fallbackReviewNote: "Mapeo histórico validado automáticamente por coincidencias confiables",
    })
    const observedRows = submissions.filter((item) => item.status === "observed").length
    const totalLiters = submissions.reduce((sum, item) => sum + item.liters, 0)
    await tx.insert(fuelTaeImportBatches).values({
      id: batchId,
      fileName: input.fileName.slice(0, 255),
      fileHash,
      totalRows: parsed.rows.length + parsed.errors.length,
      validRows: submissions.length,
      observedRows,
      invalidRows: parsed.errors.length + plan.rejected.length,
      totalLiters,
      importedBy: input.userId,
      notes: plan.rejected.length ? `${plan.rejected.length} filas válidas no fueron importadas por faena sin match o fuera de alcance.` : null,
    })
    for (let index = 0; index < submissions.length; index += 200) await tx.insert(fuelTaeSubmissions).values(submissions.slice(index, index + 200))
    const evidence = buildEvidenceRows(plan.planned, submissions)
    for (let index = 0; index < evidence.length; index += 500) await tx.insert(fuelTaeEvidence).values(evidence.slice(index, index + 500))
    await projectInChunks(tx, submissions.map((item) => item.id), input.userId)
    // Antes sólo se contaban (`invalidRows`); persistirlas permite ver el motivo
    // exacto por fila y, más adelante, reprocesarlas tras corregir catálogos.
    const rejections = [
      ...parsed.errors.map((error) => ({ id: nanoid(), batchId, rowIndex: error.rowIndex, stage: "parse" as const, field: error.field, message: error.message, legacySourceId: null, rawRow: null })),
      ...plan.rejected.map((item) => ({ id: nanoid(), batchId, rowIndex: item.rowIndex, stage: "worksite" as const, field: null, message: item.message, legacySourceId: item.legacySourceId, rawRow: item.rawRow })),
    ]
    if (rejections.length) await tx.insert(fuelTaeImportRejections).values(rejections)
    await recordStatusChanges(submissions.map((item) => ({ entityType: "fuel_tae_submission", entityId: item.id, fromStatus: null, toStatus: item.status, changedBy: input.userId, reason: item.reviewNote ?? undefined })), tx)
    await recordAudit({ userId: input.userId, action: "create", entityType: "fuel_tae_import_batch", entityId: batchId, newState: { fileHash, importedRows: submissions.length, observedRows, invalidRows: parsed.errors.length + plan.rejected.length, totalLiters } }, tx)
    return { batchId, importedRows: submissions.length, observedRows, validatedRows: submissions.length - observedRows, invalidRows: parsed.errors.length + plan.rejected.length, totalLiters }
  })
  return result
}

/**
 * Reintenta únicamente las filas rechazadas que conservan `rawRow`. Esto
 * permite aplicar mapeos corregidos sin volver a subir el Excel ni duplicar el
 * lote original. Las filas que fallan por formato siguen requiriendo una
 * corrección del archivo fuente.
 */
export async function reprocessTaeImportRejectedRows(input: { batchId: string; userId: string; allowedWorksiteIds?: ReadonlySet<string> }) {
  return db.transaction(async (tx) => {
    // Reversa y reproceso serializan sobre la misma fila padre. Bloquear sólo
    // las cargas existentes no evita phantoms: un reproceso podría insertar
    // una nueva carga después de que la reversa enumeró las suyas.
    const [batch] = await tx.select().from(fuelTaeImportBatches)
      .where(eq(fuelTaeImportBatches.id, input.batchId))
      .for("update")
      .limit(1)
    if (!batch) throw new Error("Lote no encontrado")
    if (batch.status !== "imported") throw new Error("No se puede reprocesar un lote revertido")

    const rejectionRows = await tx.query.fuelTaeImportRejections.findMany({ where: eq(fuelTaeImportRejections.batchId, input.batchId) })
    const candidates = rejectionRows.filter((item) => item.stage === "worksite" && item.rawRow && typeof item.rawRow === "object")
    if (candidates.length === 0) return { reprocessedRows: 0, remainingRows: rejectionRows.length, observedRows: 0, totalLiters: 0 }

    const parsedRows: ParsedTaeLegacyRow[] = []
    for (const candidate of candidates) {
      const parsed = parseTaeLegacyRecord(candidate.rawRow as Record<string, unknown>, candidate.rowIndex)
      if (parsed.row) parsedRows.push(parsed.row)
    }
    if (parsedRows.length === 0) return { reprocessedRows: 0, remainingRows: rejectionRows.length, observedRows: 0, totalLiters: 0 }

    const [worksitesList, vehiclesList, workersList, vehicleMappings, workerMappings] = await Promise.all([
      tx.query.worksites.findMany({ columns: { id: true, name: true } }),
      tx.query.fuelVehicles.findMany({ columns: { id: true, code: true, plate: true, worksiteId: true }, with: { worksite: { columns: { name: true } } } }),
      tx.query.workers.findMany({ where: (worker, { eq: equals }) => equals(worker.isActive, true), columns: { id: true, firstName: true, lastName: true, worksiteId: true }, with: { worksite: { columns: { name: true } } } }),
      tx.query.fuelTaeVehicleMappings.findMany({ columns: { worksiteId: true, legacyCode: true, vehicleId: true } }),
      tx.query.fuelTaeWorkerMappings.findMany({ columns: { worksiteId: true, role: true, legacyName: true, workerId: true } }),
    ])
    const catalogs: TaeImportCatalogs = {
      worksites: worksitesList,
      vehicles: vehiclesList.map((item) => ({ id: item.id, code: item.code, plate: item.plate, worksiteId: item.worksiteId, worksiteName: item.worksite?.name ?? "" })),
      workers: workersList.map((item) => ({ id: item.id, name: `${item.firstName} ${item.lastName}`, worksiteId: item.worksiteId, worksiteName: item.worksite?.name ?? "" })),
    }
    const mappings: TaeImportMappings = {
      vehicles: new Map(vehicleMappings.map((row) => [vehicleMappingKey(row.worksiteId, row.legacyCode), row.vehicleId])),
      drivers: new Map(workerMappings.filter((row) => row.role === "driver").map((row) => [workerMappingKey(row.worksiteId, row.legacyName), row.workerId])),
      supervisors: new Map(workerMappings.filter((row) => row.role === "supervisor").map((row) => [workerMappingKey(row.worksiteId, row.legacyName), row.workerId])),
    }
    const report = buildTaeImportReport({ rows: parsedRows, errors: [], worksites: worksitesList, vehicles: catalogs.vehicles, workers: catalogs.workers })
    const plan = buildTaeImportPlan(parsedRows, report, input.allowedWorksiteIds, mappings)
    if (plan.planned.length === 0) return { reprocessedRows: 0, remainingRows: rejectionRows.length, observedRows: 0, totalLiters: 0 }

    const pointByKey = await ensureLoadingPoints(tx, plan.planned)

    const now = new Date().toISOString()
    const submissions = buildSubmissionRows({
      planned: plan.planned,
      pointByKey,
      batchId: batch.id,
      fileHash: batch.fileHash,
      userId: input.userId,
      now,
      fallbackReviewNote: "Fila reprocesada después de corregir el catálogo",
    })
    await tx.insert(fuelTaeSubmissions).values(submissions)
    const evidence = buildEvidenceRows(plan.planned, submissions)
    if (evidence.length) await tx.insert(fuelTaeEvidence).values(evidence)
    await projectInChunks(tx, submissions.map((item) => item.id), input.userId)

    const importedSourceIds = new Set(plan.planned.map((item) => item.row.legacySourceId))
    const removedRejectionIds = candidates.filter((item) => item.legacySourceId && importedSourceIds.has(item.legacySourceId)).map((item) => item.id)
    if (removedRejectionIds.length) await tx.delete(fuelTaeImportRejections).where(inArray(fuelTaeImportRejections.id, removedRejectionIds))
    const observedRows = submissions.filter((item) => item.status === "observed").length
    const totalLiters = submissions.reduce((sum, item) => sum + item.liters, 0)
    const [updatedBatch] = await tx.update(fuelTaeImportBatches)
      .set({ validRows: batch.validRows + submissions.length, observedRows: batch.observedRows + observedRows, invalidRows: Math.max(0, batch.invalidRows - submissions.length), totalLiters: Number(batch.totalLiters) + totalLiters, updatedAt: now })
      .where(and(eq(fuelTaeImportBatches.id, batch.id), eq(fuelTaeImportBatches.status, "imported")))
      .returning({ id: fuelTaeImportBatches.id })
    if (!updatedBatch) throw new Error("El lote cambió de estado durante el reproceso")
    await recordStatusChanges(submissions.map((item) => ({ entityType: "fuel_tae_submission", entityId: item.id, fromStatus: null, toStatus: item.status, changedBy: input.userId, reason: item.reviewNote ?? undefined })), tx)
    await recordAudit({ userId: input.userId, action: "update", entityType: "fuel_tae_import_batch", entityId: batch.id, oldState: { invalidRows: batch.invalidRows }, newState: { reprocessedRows: submissions.length, remainingInvalidRows: Math.max(0, batch.invalidRows - submissions.length) }, reason: "Reproceso de filas rechazadas después de corregir catálogos" }, tx)
    return { reprocessedRows: submissions.length, remainingRows: rejectionRows.length - removedRejectionIds.length, observedRows, totalLiters }
  })
}
