import { createHash } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelTaeEvidence, fuelTaeImportBatches, fuelTaeLoadingPoints, fuelTaeSubmissions } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit, recordStatusChanges } from "@/lib/audit"
import { parseTaeLegacyExcel, type ParsedTaeLegacyRow } from "./tae-import"
import { buildTaeImportReport, type TaeImportReportData } from "./tae-import-report"

type Catalogs = {
  worksites: Array<{ id: string; name: string }>
  vehicles: Array<{ id: string; code: string | null; plate: string; worksiteName: string }>
  workers: Array<{ id: string; name: string; worksiteId: string; worksiteName: string }>
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
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null
  } catch { return null }
}

export function buildTaeImportPlan(rows: ParsedTaeLegacyRow[], report: TaeImportReportData, allowedWorksiteIds?: ReadonlySet<string>) {
  const worksites = new Map(report.worksites.map((item) => [item.legacyName, item]))
  const equipment = new Map(report.equipment.map((item) => [item.legacyCode, item]))
  const drivers = new Map(report.drivers.map((item) => [item.legacyName, item]))
  const supervisors = new Map(report.supervisors.map((item) => [item.legacyName, item]))
  const sealRows = new Set(report.sealObservations.flatMap((item) => [item.previousRowIndex, item.nextRowIndex]))
  const planned: TaeImportPlanRow[] = []
  const rejected: Array<{ rowIndex: number; message: string }> = []

  for (const row of rows) {
    const worksite = worksites.get(row.worksiteName)
    if (!worksite?.worksiteId || (allowedWorksiteIds && !allowedWorksiteIds.has(worksite.worksiteId))) {
      rejected.push({ rowIndex: row.rowIndex, message: allowedWorksiteIds && worksite?.worksiteId ? "Faena fuera del alcance autorizado" : "Faena sin correspondencia en el catálogo" })
      continue
    }
    const vehicle = equipment.get(row.equipmentCode)
    const driver = drivers.get(row.driverName)
    const supervisor = supervisors.get(row.supervisorName)
    const safeVehicle = Boolean(vehicle?.matchedVehicleId && ["exacta", "probable"].includes(vehicle.confidence) && vehicle.matchedWorksite === worksite.resolvedName)
    const safeDriver = Boolean(driver?.matchedWorkerId && ["exacta", "probable"].includes(driver.confidence) && driver.sameWorksite)
    const safeSupervisor = Boolean(supervisor?.matchedWorkerId && ["exacta", "probable"].includes(supervisor.confidence) && supervisor.sameWorksite)
    const observations = [
      !safeVehicle && "Equipo sin match confiable en la misma faena",
      !safeDriver && "Conductor conservado como texto histórico",
      !safeSupervisor && "Supervisor conservado como texto histórico",
      row.meterReading == null && "Lectura no numérica o ausente",
      (!row.removedSealNumber || !row.installedSealNumber) && "Sello faltante",
      sealRows.has(row.rowIndex) && "Quiebre de continuidad de sello",
    ].filter((item): item is string => Boolean(item))
    planned.push({
      row,
      worksiteId: worksite.worksiteId,
      resolvedWorksiteName: worksite.resolvedName,
      vehicleId: safeVehicle ? vehicle!.matchedVehicleId : null,
      driverWorkerId: safeDriver ? driver!.matchedWorkerId : null,
      supervisorWorkerId: safeSupervisor ? supervisor!.matchedWorkerId : null,
      status: observations.length === 0 ? "validated" : "observed",
      observations,
    })
  }
  return { planned, rejected }
}

export async function importTaeLegacyWorkbook(input: { buffer: Buffer; fileName: string; userId: string; allowedWorksiteIds?: ReadonlySet<string> }) {
  const fileHash = createHash("sha256").update(input.buffer).digest("hex")
  const parsed = await parseTaeLegacyExcel(input.buffer)
  if (parsed.rows.length === 0) throw new Error(parsed.errors[0]?.message ?? "El archivo no contiene filas válidas")

  const [worksitesList, vehiclesList, workersList] = await Promise.all([
    db.query.worksites.findMany({ columns: { id: true, name: true } }),
    db.query.fuelVehicles.findMany({ columns: { id: true, code: true, plate: true }, with: { worksite: { columns: { name: true } } } }),
    db.query.workers.findMany({ where: (worker, { eq: equals }) => equals(worker.isActive, true), columns: { id: true, firstName: true, lastName: true, worksiteId: true }, with: { worksite: { columns: { name: true } } } }),
  ])
  const catalogs: Catalogs = {
    worksites: worksitesList,
    vehicles: vehiclesList.map((item) => ({ id: item.id, code: item.code, plate: item.plate, worksiteName: item.worksite?.name ?? "" })),
    workers: workersList.map((item) => ({ id: item.id, name: `${item.firstName} ${item.lastName}`, worksiteId: item.worksiteId, worksiteName: item.worksite?.name ?? "" })),
  }
  const report = buildTaeImportReport({ rows: parsed.rows, errors: parsed.errors, ...catalogs })
  const plan = buildTaeImportPlan(parsed.rows, report, input.allowedWorksiteIds)
  if (plan.planned.length === 0) throw new Error("Ninguna fila válida corresponde a una faena autorizada y existente")

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${fileHash}))`)
    const existing = await tx.query.fuelTaeImportBatches.findFirst({ where: and(eq(fuelTaeImportBatches.fileHash, fileHash), eq(fuelTaeImportBatches.status, "imported")) })
    if (existing) throw new Error(`Este archivo ya fue importado el ${new Date(existing.createdAt).toLocaleString("es-CL")}`)

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
    await recordStatusChanges(submissions.map((item) => ({ entityType: "fuel_tae_submission", entityId: item.id, fromStatus: null, toStatus: item.status, changedBy: input.userId, reason: item.reviewNote ?? undefined })), tx)
    await recordAudit({ userId: input.userId, action: "create", entityType: "fuel_tae_import_batch", entityId: batchId, newState: { fileHash, importedRows: submissions.length, observedRows, invalidRows: parsed.errors.length + plan.rejected.length, totalLiters } }, tx)
    return { batchId, importedRows: submissions.length, observedRows, validatedRows: submissions.length - observedRows, invalidRows: parsed.errors.length + plan.rejected.length, totalLiters }
  })
  return result
}
