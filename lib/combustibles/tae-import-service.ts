import { createHash } from "node:crypto"
import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelTaeEvidence, fuelTaeImportBatches, fuelTaeImportRejections, fuelTaeLoadingPoints, fuelTaeSubmissions, fuelTaeVehicleMappings, fuelTaeWorkerMappings } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit, recordStatusChanges } from "@/lib/audit"
import { parseTaeLegacyExcel, parseTaeLegacyRecord, type ParsedTaeLegacyRow } from "./tae-import"
import { buildTaeImportReport, normalizeCode, normalizeName, type TaeImportReportData } from "./tae-import-report"
import { FUEL_PRODUCT_IDS } from "./fuel-products"
import { isAllowedTaeEvidenceHost } from "./tae-evidence-hosts"

export type TaeImportCatalogs = {
  worksites: Array<{ id: string; name: string }>
  vehicles: Array<{ id: string; code: string | null; plate: string; worksiteId: string; worksiteName: string }>
  workers: Array<{ id: string; name: string; worksiteId: string; worksiteName: string }>
}

/**
 * Decisiones manuales guardadas por un humano para identidades históricas
 * ambiguas: `null` significa "revisado, sin equivalente en el catálogo" — se
 * distingue de "todavía no revisado" (ausencia de la llave en el mapa), para no
 * volver a marcar como ambiguo un código ya descartado a propósito.
 */
export interface TaeImportMappings {
  vehicles: Map<string, string | null>
  drivers: Map<string, string | null>
  supervisors: Map<string, string | null>
}

export type TaeImportMappingKind = "vehicle" | "driver" | "supervisor"

export interface TaeImportMappingDecision {
  kind: TaeImportMappingKind
  worksiteId: string
  legacyValue: string
  targetId: string | null
}

export interface TaeImportReviewItem {
  key: string
  kind: TaeImportMappingKind
  worksiteId: string
  worksiteName: string
  legacyValue: string
  occurrences: number
  suggestedId: string | null
  suggestedLabel: string | null
  confidence: "exacta" | "probable" | "posible" | "sin_match"
  options: Array<{ id: string; label: string }>
}

export interface TaeImportPreview {
  summary: TaeImportReportData["summary"]
  planned: { validatedRows: number; observedRows: number; rejectedRows: number; totalLiters: number }
  reviewItems: TaeImportReviewItem[]
  parseErrors: TaeImportReportData["errors"]
  sealObservations: number
  missingReadingRows: number
  missingSealRows: number
}

export function vehicleMappingKey(worksiteId: string, legacyCode: string) { return `${worksiteId}:${normalizeCode(legacyCode)}` }
export function workerMappingKey(worksiteId: string, legacyName: string) { return `${worksiteId}:${normalizeName(legacyName)}` }

function reviewMappingKey(kind: TaeImportMappingKind, worksiteId: string, legacyValue: string) {
  return `${kind}:${worksiteId}:${kind === "vehicle" ? normalizeCode(legacyValue) : normalizeName(legacyValue)}`
}

function catalogLabel(item: { code?: string | null; plate?: string; name?: string }) {
  if (item.name) return item.name
  return [item.code, item.plate].filter(Boolean).join(" · ")
}

export interface TaeImportPlanRow {
  row: ParsedTaeLegacyRow
  worksiteId: string
  resolvedWorksiteName: string
  vehicleId: string | null
  driverWorkerId: string | null
  supervisorWorkerId: string | null
  status: "validated" | "observed"
  observations: string[]
}

export function safeTaeEvidenceUrl(value: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    // Host fuera del allowlist: no se persiste como evidencia válida — evita
    // que una URL de un host no confiable entre por importación o reproceso
    // y sólo se descubra al servirla (CO-040).
    return isAllowedTaeEvidenceHost(url) ? url.toString() : null
  } catch { return null }
}

export function buildTaeImportPlan(rows: ParsedTaeLegacyRow[], report: TaeImportReportData, allowedWorksiteIds?: ReadonlySet<string>, mappings?: TaeImportMappings) {
  const worksites = new Map(report.worksites.map((item) => [item.legacyName, item]))
  const equipment = new Map(report.equipment.map((item) => [item.legacyCode, item]))
  const drivers = new Map(report.drivers.map((item) => [item.legacyName, item]))
  const supervisors = new Map(report.supervisors.map((item) => [item.legacyName, item]))
  const sealRows = new Set(report.sealObservations.flatMap((item) => [item.previousRowIndex, item.nextRowIndex]))
  const planned: TaeImportPlanRow[] = []
  const rejected: Array<{ rowIndex: number; message: string; legacySourceId: string; rawRow: Record<string, unknown> }> = []

  for (const row of rows) {
    const worksite = worksites.get(row.worksiteName)
    if (!worksite?.worksiteId || (allowedWorksiteIds && !allowedWorksiteIds.has(worksite.worksiteId))) {
      rejected.push({ rowIndex: row.rowIndex, message: allowedWorksiteIds && worksite?.worksiteId ? "Faena fuera del alcance autorizado" : "Faena sin correspondencia en el catálogo", legacySourceId: row.legacySourceId, rawRow: row.rawRow })
      continue
    }
    const vehicle = equipment.get(row.equipmentCode)
    const driver = drivers.get(row.driverName)
    const supervisor = supervisors.get(row.supervisorName)

    // Una decisión manual guardada (aunque sea "sin equivalente") tiene prioridad
    // sobre el fuzzy-match: un humano ya revisó esta identidad para esta faena.
    const vehicleDecision = mappings?.vehicles.get(vehicleMappingKey(worksite.worksiteId, row.equipmentCode))
    const driverDecision = mappings?.drivers.get(workerMappingKey(worksite.worksiteId, row.driverName))
    const supervisorDecision = mappings?.supervisors.get(workerMappingKey(worksite.worksiteId, row.supervisorName))
    const hasVehicleDecision = vehicleDecision !== undefined
    const hasDriverDecision = driverDecision !== undefined
    const hasSupervisorDecision = supervisorDecision !== undefined

    const safeVehicle = hasVehicleDecision ? vehicleDecision != null : Boolean(vehicle?.matchedVehicleId && ["exacta", "probable"].includes(vehicle.confidence) && vehicle.matchedWorksite === worksite.resolvedName)
    const safeDriver = hasDriverDecision ? driverDecision != null : Boolean(driver?.matchedWorkerId && ["exacta", "probable"].includes(driver.confidence) && driver.sameWorksite)
    const safeSupervisor = hasSupervisorDecision ? supervisorDecision != null : Boolean(supervisor?.matchedWorkerId && ["exacta", "probable"].includes(supervisor.confidence) && supervisor.sameWorksite)
    const observations = [
      !safeVehicle && (hasVehicleDecision ? "Equipo sin equivalente (decisión manual confirmada)" : "Equipo sin match confiable en la misma faena"),
      !safeDriver && (hasDriverDecision ? "Conductor sin equivalente (decisión manual confirmada)" : "Conductor conservado como texto histórico"),
      !safeSupervisor && (hasSupervisorDecision ? "Supervisor sin equivalente (decisión manual confirmada)" : "Supervisor conservado como texto histórico"),
      row.meterReading == null && "Lectura no numérica o ausente",
      (!row.removedSealNumber || !row.installedSealNumber) && "Sello faltante",
      sealRows.has(row.rowIndex) && "Quiebre de continuidad de sello",
    ].filter((item): item is string => Boolean(item))
    planned.push({
      row,
      worksiteId: worksite.worksiteId,
      resolvedWorksiteName: worksite.resolvedName,
      vehicleId: hasVehicleDecision ? vehicleDecision : (safeVehicle ? vehicle!.matchedVehicleId : null),
      driverWorkerId: hasDriverDecision ? driverDecision : (safeDriver ? driver!.matchedWorkerId : null),
      supervisorWorkerId: hasSupervisorDecision ? supervisorDecision : (safeSupervisor ? supervisor!.matchedWorkerId : null),
      status: observations.length === 0 ? "validated" : "observed",
      observations,
    })
  }
  return { planned, rejected }
}

/**
 * Construye la revisión previa por identidad y faena. El dry-run no propone
 * decisiones inseguras: sólo muestra la sugerencia y exige que el operador
 * elija explícitamente un catálogo o "sin equivalente" antes de importar.
 */
export function buildTaeImportReview(input: {
  rows: ParsedTaeLegacyRow[]
  report: TaeImportReportData
  catalogs: TaeImportCatalogs
  allowedWorksiteIds?: ReadonlySet<string>
  mappings?: TaeImportMappings
}): TaeImportPreview {
  const { rows, report, catalogs, allowedWorksiteIds, mappings } = input
  const worksites = new Map(report.worksites.map((item) => [item.legacyName, item]))
  const equipment = new Map(report.equipment.map((item) => [item.legacyCode, item]))
  const drivers = new Map(report.drivers.map((item) => [item.legacyName, item]))
  const supervisors = new Map(report.supervisors.map((item) => [item.legacyName, item]))
  const counts = new Map<string, { kind: TaeImportMappingKind; worksiteId: string; worksiteName: string; legacyValue: string; occurrences: number }>()

  function add(kind: TaeImportMappingKind, worksiteId: string, worksiteName: string, legacyValue: string) {
    const key = reviewMappingKey(kind, worksiteId, legacyValue)
    const current = counts.get(key)
    if (current) current.occurrences++
    else counts.set(key, { kind, worksiteId, worksiteName, legacyValue, occurrences: 1 })
  }

  for (const row of rows) {
    const worksite = worksites.get(row.worksiteName)
    if (!worksite?.worksiteId || (allowedWorksiteIds && !allowedWorksiteIds.has(worksite.worksiteId))) continue
    add("vehicle", worksite.worksiteId, worksite.resolvedName, row.equipmentCode)
    add("driver", worksite.worksiteId, worksite.resolvedName, row.driverName)
    add("supervisor", worksite.worksiteId, worksite.resolvedName, row.supervisorName)
  }

  const reviewItems: TaeImportReviewItem[] = []
  for (const item of counts.values()) {
    const reportMatch = item.kind === "vehicle" ? equipment.get(item.legacyValue) : item.kind === "driver" ? drivers.get(item.legacyValue) : supervisors.get(item.legacyValue)
    const savedId = item.kind === "vehicle"
      ? mappings?.vehicles.get(vehicleMappingKey(item.worksiteId, item.legacyValue))
      : item.kind === "driver"
        ? mappings?.drivers.get(workerMappingKey(item.worksiteId, item.legacyValue))
        : mappings?.supervisors.get(workerMappingKey(item.worksiteId, item.legacyValue))
    if (savedId !== undefined) continue

    const safeSuggestion = Boolean(reportMatch && ["exacta", "probable"].includes(reportMatch.confidence) && (
      item.kind === "vehicle"
        ? "matchedWorksite" in reportMatch && reportMatch.matchedWorksite === item.worksiteName
        : "sameWorksite" in reportMatch && reportMatch.sameWorksite
    ))
    const options = item.kind === "vehicle"
      ? catalogs.vehicles.filter((vehicle) => vehicle.worksiteId === item.worksiteId).map((vehicle) => ({ id: vehicle.id, label: catalogLabel(vehicle) }))
      : catalogs.workers.filter((worker) => worker.worksiteId === item.worksiteId).map((worker) => ({ id: worker.id, label: catalogLabel(worker) }))
    // Exact/probable same-faena matches are already safe for the automatic
    // plan. Only ambiguous rows require an explicit pre-import decision.
    if (safeSuggestion) continue
    reviewItems.push({
      key: `${item.kind}:${item.worksiteId}:${item.legacyValue}`,
      kind: item.kind,
      worksiteId: item.worksiteId,
      worksiteName: item.worksiteName,
      legacyValue: item.legacyValue,
      occurrences: item.occurrences,
      suggestedId: reportMatch && "matchedWorkerId" in reportMatch ? reportMatch.matchedWorkerId : reportMatch && "matchedVehicleId" in reportMatch ? reportMatch.matchedVehicleId : null,
      suggestedLabel: reportMatch && "matchedName" in reportMatch ? reportMatch.matchedName : reportMatch && "matchedCode" in reportMatch ? ([reportMatch.matchedCode, reportMatch.matchedPlate].filter(Boolean).join(" · ") || null) : null,
      confidence: reportMatch?.confidence ?? "sin_match",
      options,
    })
  }

  const plan = buildTaeImportPlan(rows, report, allowedWorksiteIds, mappings)
  return {
    summary: report.summary,
    planned: {
      validatedRows: plan.planned.filter((row) => row.status === "validated").length,
      observedRows: plan.planned.filter((row) => row.status === "observed").length,
      rejectedRows: plan.rejected.length + report.errors.length,
      totalLiters: plan.planned.reduce((sum, row) => sum + row.row.liters, 0),
    },
    reviewItems,
    parseErrors: report.errors,
    sealObservations: report.sealObservations.length,
    missingReadingRows: report.missingReadingRows.length,
    missingSealRows: report.missingSealRows.length,
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
    const existingPoints = await tx.query.fuelTaeLoadingPoints.findMany()
    const pointByKey = new Map(existingPoints.map((point) => [`${point.worksiteId}:${point.name.trim().toLocaleUpperCase("es-CL")}`, point.id]))
    const newPoints: Array<typeof fuelTaeLoadingPoints.$inferInsert> = []
    for (const item of plan.planned) {
      const key = `${item.worksiteId}:${item.row.loadingPointName.trim().toLocaleUpperCase("es-CL")}`
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
      for (const point of persistedPoints) pointByKey.set(`${point.worksiteId}:${point.name.trim().toLocaleUpperCase("es-CL")}`, point.id)
    }

    const now = new Date().toISOString()
    const submissions = plan.planned.map((item) => ({
      id: nanoid(),
      clientSubmissionId: `legacy:${fileHash}:${item.row.legacySourceId}`,
      importBatchId: batchId,
      source: "legacy_xlsx",
      legacySourceId: item.row.legacySourceId,
      publicResultToken: nanoid(32),
      worksiteId: item.worksiteId,
      loadingPointId: pointByKey.get(`${item.worksiteId}:${item.row.loadingPointName.trim().toLocaleUpperCase("es-CL")}`)!,
      vehicleId: item.vehicleId,
      productId: FUEL_PRODUCT_IDS.historicalUnspecified,
      equipmentCodeSnapshot: item.row.equipmentCode,
      loadedAt: item.row.loadedAt,
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
      reviewNote: item.observations.length ? item.observations.join("; ") : "Mapeo histórico validado automáticamente por coincidencias confiables",
      reviewedBy: input.userId,
      reviewedAt: now,
      rawRow: item.row.rawRow,
    }))
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
    const evidence = plan.planned.flatMap((item, itemIndex) => Object.entries(item.row.evidenceUrls).flatMap(([kind, rawUrl]) => {
      const externalUrl = safeTaeEvidenceUrl(rawUrl)
      if (!externalUrl) return []
      return [{ id: nanoid(), submissionId: submissions[itemIndex]!.id, kind, fileName: `evidencia-historica-${kind}`, externalUrl, capturedAt: item.row.loadedAt }]
    }))
    for (let index = 0; index < evidence.length; index += 500) await tx.insert(fuelTaeEvidence).values(evidence.slice(index, index + 500))
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

    const existingPoints = await tx.query.fuelTaeLoadingPoints.findMany()
    const pointByKey = new Map(existingPoints.map((point) => [`${point.worksiteId}:${point.name.trim().toLocaleUpperCase("es-CL")}`, point.id]))
    const newPoints: Array<typeof fuelTaeLoadingPoints.$inferInsert> = []
    for (const item of plan.planned) {
      const key = `${item.worksiteId}:${item.row.loadingPointName.trim().toLocaleUpperCase("es-CL")}`
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
      for (const point of persistedPoints) pointByKey.set(`${point.worksiteId}:${point.name.trim().toLocaleUpperCase("es-CL")}`, point.id)
    }

    const now = new Date().toISOString()
    const submissions = plan.planned.map((item) => ({
      id: nanoid(),
      clientSubmissionId: `legacy:${batch.fileHash}:${item.row.legacySourceId}`,
      importBatchId: batch.id,
      source: "legacy_xlsx",
      legacySourceId: item.row.legacySourceId,
      publicResultToken: nanoid(32),
      worksiteId: item.worksiteId,
      loadingPointId: pointByKey.get(`${item.worksiteId}:${item.row.loadingPointName.trim().toLocaleUpperCase("es-CL")}`)!,
      vehicleId: item.vehicleId,
      productId: FUEL_PRODUCT_IDS.historicalUnspecified,
      equipmentCodeSnapshot: item.row.equipmentCode,
      loadedAt: item.row.loadedAt,
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
      reviewNote: item.observations.length ? item.observations.join("; ") : "Fila reprocesada después de corregir el catálogo",
      reviewedBy: input.userId,
      reviewedAt: now,
      rawRow: item.row.rawRow,
    }))
    await tx.insert(fuelTaeSubmissions).values(submissions)
    const evidence = plan.planned.flatMap((item, itemIndex) => Object.entries(item.row.evidenceUrls).flatMap(([kind, rawUrl]) => {
      const externalUrl = safeTaeEvidenceUrl(rawUrl)
      if (!externalUrl) return []
      return [{ id: nanoid(), submissionId: submissions[itemIndex]!.id, kind, fileName: `evidencia-historica-${kind}`, externalUrl, capturedAt: item.row.loadedAt }]
    }))
    if (evidence.length) await tx.insert(fuelTaeEvidence).values(evidence)

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
