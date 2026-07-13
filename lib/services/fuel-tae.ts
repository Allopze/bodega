import { createHash } from "node:crypto"
import path from "node:path"
import { and, asc, desc, eq, gt, inArray, lt, ne } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelTaeEvidence,
  fuelTaeLoadingPoints,
  fuelTaePublicLinks,
  fuelTaeSubmissions,
  fuelProducts,
  fuelVehicleProducts,
  fuelVehicles,
  workers,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { cleanRut } from "@/lib/rut"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { mkdirp, removeFile, writeBuffer } from "@/lib/storage/helpers"
import {
  createFuelTaeEvidencePath,
  resolveFuelTaeEvidenceDir,
} from "@/lib/storage/config"
import { isTaeReviewTransitionAllowed, type TaePublicSubmissionInput } from "@/lib/validation/fuel-tae"
import type { OcrMeterResult } from "@/lib/services/tae-ocr"
import { getUserIdsWithPermissionForWorksite, notifyAfterCommit, notifyManyUser } from "@/lib/services/notifications"

export type TaeEvidenceKind = "odometer" | "liter_meter" | "removed_seal" | "installed_seal"

export interface TaeEvidenceUpload {
  kind: TaeEvidenceKind
  fileName: string
  mimeType: string
  buffer: Buffer
}

export interface TaeAccessConfig {
  worksite: { id: string; name: string }
  loadingPoint: { id: string; name: string } | null
  vehicles: Array<{ id: string; code: string | null; plate: string; type: string; products: Array<{ id: string; name: string; unit: string }> }>
}

const MAX_SUBMISSION_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_FUTURE_SKEW_MS = 15 * 60 * 1000

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function extensionForMime(mimeType: string) {
  return mimeType === "image/png" ? "png" : "jpg"
}

async function getActiveLink(accessToken: string) {
  if (!accessToken) throw new Error("Enlace de acceso requerido")
  const link = await db.query.fuelTaePublicLinks.findFirst({
    where: eq(fuelTaePublicLinks.tokenHash, hashToken(accessToken)),
  })
  if (!link || link.revokedAt || (link.expiresAt && new Date(link.expiresAt) <= new Date())) {
    throw new Error("Este enlace TAE no está disponible")
  }
  return link
}

/** Faena fijada por un enlace TAE activo, sin cargar vehículos ni tocar `lastUsedAt`. */
export async function getTaeLinkWorksiteId(accessToken: string): Promise<string> {
  const link = await getActiveLink(accessToken)
  return link.worksiteId
}

/** Busca un trabajador activo por RUT, acotado a la faena del enlace TAE (nunca fuera de ella). */
export async function findTaeWorkerByRut(rut: string, worksiteId: string): Promise<{ id: string; firstName: string; lastName: string } | null> {
  if (!rut) return null
  const cleaned = cleanRut(rut)
  const worker = await db.query.workers.findFirst({
    where: and(eq(workers.rut, cleaned), eq(workers.worksiteId, worksiteId), eq(workers.isActive, true)),
    columns: { id: true, firstName: true, lastName: true },
  })
  return worker ?? null
}

export async function getTaeAccessConfig(accessToken: string): Promise<TaeAccessConfig> {
  const link = await getActiveLink(accessToken)
  const [worksite, point, vehicles] = await Promise.all([
    db.query.worksites.findFirst({ where: eq(worksites.id, link.worksiteId), columns: { id: true, name: true } }),
    link.loadingPointId
      ? db.query.fuelTaeLoadingPoints.findFirst({
          where: and(
            eq(fuelTaeLoadingPoints.id, link.loadingPointId),
            eq(fuelTaeLoadingPoints.worksiteId, link.worksiteId),
            eq(fuelTaeLoadingPoints.isActive, true),
          ),
          columns: { id: true, name: true },
        })
      : Promise.resolve(null),
    db.query.fuelVehicles.findMany({
      where: and(eq(fuelVehicles.worksiteId, link.worksiteId), eq(fuelVehicles.isActive, true)),
      columns: { id: true, code: true, plate: true, type: true },
      orderBy: [fuelVehicles.code, fuelVehicles.plate],
    }),
  ])
  if (!worksite || (link.loadingPointId && !point)) throw new Error("El enlace TAE está incompleto")
  const compatibility = vehicles.length === 0 ? [] : await db.select({
    vehicleId: fuelVehicleProducts.vehicleId,
    id: fuelProducts.id,
    name: fuelProducts.name,
    unit: fuelProducts.unit,
  }).from(fuelVehicleProducts)
    .innerJoin(fuelProducts, eq(fuelProducts.id, fuelVehicleProducts.productId))
    .where(and(inArray(fuelVehicleProducts.vehicleId, vehicles.map((vehicle) => vehicle.id)), eq(fuelProducts.isActive, true)))
    .orderBy(fuelProducts.name)
  const productsByVehicle = new Map<string, Array<{ id: string; name: string; unit: string }>>()
  for (const item of compatibility) {
    const current = productsByVehicle.get(item.vehicleId) ?? []
    current.push({ id: item.id, name: item.name, unit: item.unit })
    productsByVehicle.set(item.vehicleId, current)
  }
  await db.update(fuelTaePublicLinks).set({ lastUsedAt: new Date().toISOString() }).where(eq(fuelTaePublicLinks.id, link.id))
  return { worksite, loadingPoint: point ?? null, vehicles: vehicles.map((vehicle) => ({ ...vehicle, products: productsByVehicle.get(vehicle.id) ?? [] })) }
}

export async function createTaePublicLink({
  worksiteId,
  loadingPointId,
  label,
  createdBy,
}: {
  worksiteId: string
  loadingPointId: string
  label: string
  createdBy: string
}): Promise<{ id: string; accessToken: string }> {
  const worksite = await db.query.worksites.findFirst({ where: eq(worksites.id, worksiteId), columns: { id: true } })
  if (!worksite) throw new Error("Faena no encontrada")
  const point = await db.query.fuelTaeLoadingPoints.findFirst({
    where: and(
      eq(fuelTaeLoadingPoints.id, loadingPointId),
      eq(fuelTaeLoadingPoints.worksiteId, worksiteId),
      eq(fuelTaeLoadingPoints.isActive, true),
    ),
    columns: { id: true },
  })
  if (!point) throw new Error("El punto de carga no pertenece a la faena o está inactivo")
  const id = nanoid()
  const accessToken = nanoid(40)
  await db.insert(fuelTaePublicLinks).values({
    id,
    worksiteId,
    loadingPointId,
    label,
    tokenHash: hashToken(accessToken),
    createdBy,
  })
  await recordAudit({ userId: createdBy, action: "create", entityType: "fuel_tae_public_link", entityId: id, newState: { worksiteId, loadingPointId, label } })
  return { id, accessToken }
}

export async function revokeTaePublicLink(id: string, userId: string) {
  const link = await db.query.fuelTaePublicLinks.findFirst({ where: eq(fuelTaePublicLinks.id, id) })
  if (!link) throw new Error("Enlace TAE no encontrado")
  if (link.revokedAt) return
  await db.update(fuelTaePublicLinks).set({ revokedAt: new Date().toISOString() }).where(eq(fuelTaePublicLinks.id, id))
  await recordAudit({ userId, action: "update", entityType: "fuel_tae_public_link", entityId: id, oldState: { revokedAt: null }, newState: { revokedAt: new Date().toISOString() } })
}

export async function createTaeSubmission({
  accessToken,
  input,
  evidence,
  ipAddress,
  ocrResult,
}: {
  accessToken: string
  input: TaePublicSubmissionInput
  evidence: TaeEvidenceUpload[]
  ipAddress?: string
  ocrResult?: OcrMeterResult
}): Promise<{ id: string; publicResultToken: string; duplicate: boolean }> {
  const link = await getActiveLink(accessToken)
  if (input.worksiteId !== link.worksiteId) throw new Error("La faena no corresponde al enlace")
  if (!link.loadingPointId || input.loadingPointId !== link.loadingPointId) throw new Error("El punto de carga no corresponde al enlace")

  const loadedAt = new Date(input.loadedAt).getTime()
  const nowMs = Date.now()
  if (!Number.isFinite(loadedAt) || loadedAt < nowMs - MAX_SUBMISSION_AGE_MS || loadedAt > nowMs + MAX_FUTURE_SKEW_MS) {
    throw new Error("La fecha de la carga está fuera del rango permitido")
  }

  const expectedKinds: TaeEvidenceKind[] = ["odometer", "liter_meter", "removed_seal", "installed_seal"]
  const evidenceKinds = new Set(evidence.map((item) => item.kind))
  if (evidence.length !== expectedKinds.length || evidenceKinds.size !== expectedKinds.length || expectedKinds.some((kind) => !evidenceKinds.has(kind))) {
    throw new Error("Debes adjuntar las cuatro evidencias requeridas")
  }

  const existing = await db.query.fuelTaeSubmissions.findFirst({
    where: eq(fuelTaeSubmissions.clientSubmissionId, input.clientSubmissionId),
    columns: { id: true, publicResultToken: true },
  })
  if (existing) return { ...existing, duplicate: true }

  const [vehicle, productCompatibility, driver, supervisor] = await Promise.all([
    db.query.fuelVehicles.findFirst({ where: and(eq(fuelVehicles.id, input.vehicleId), eq(fuelVehicles.isActive, true)) }),
    db.query.fuelVehicleProducts.findFirst({
      where: and(eq(fuelVehicleProducts.vehicleId, input.vehicleId), eq(fuelVehicleProducts.productId, input.productId)),
      with: { product: true },
    }),
    input.driverWorkerId ? db.query.workers.findFirst({ where: and(eq(workers.id, input.driverWorkerId), eq(workers.isActive, true)) }) : Promise.resolve(null),
    input.supervisorWorkerId ? db.query.workers.findFirst({ where: and(eq(workers.id, input.supervisorWorkerId), eq(workers.isActive, true)) }) : Promise.resolve(null),
  ])
  if (!vehicle || vehicle.worksiteId !== link.worksiteId) throw new Error("El equipo no pertenece a la faena o está inactivo")
  if (!productCompatibility?.product?.isActive) throw new Error("El producto no está habilitado para este equipo")
  if (input.driverWorkerId && (!driver || driver.worksiteId !== link.worksiteId)) throw new Error("El conductor no pertenece a la faena o está inactivo")
  if (input.supervisorWorkerId && (!supervisor || supervisor.worksiteId !== link.worksiteId)) throw new Error("El supervisor no pertenece a la faena o está inactivo")

  const id = nanoid()
  const publicResultToken = nanoid(32)
  const now = new Date().toISOString()
  const storedFiles: Array<{ filePath: string; absolutePath: string; upload: TaeEvidenceUpload; sha256: string }> = []

  try {
    const evidenceDir = resolveFuelTaeEvidenceDir()
    await mkdirp(evidenceDir)
    for (const upload of evidence) {
      const storageName = `${id}-${upload.kind}-${nanoid(10)}.${extensionForMime(upload.mimeType)}`
      const absolutePath = path.join(evidenceDir, storageName)
      await writeBuffer(absolutePath, upload.buffer)
      storedFiles.push({
        filePath: createFuelTaeEvidencePath(storageName),
        absolutePath,
        upload,
        sha256: createHash("sha256").update(upload.buffer).digest("hex"),
      })
    }

    await db.transaction(async (tx) => {
      await tx.insert(fuelTaeSubmissions).values({
        id,
        clientSubmissionId: input.clientSubmissionId,
        source: "public_pwa",
        publicResultToken,
        worksiteId: link.worksiteId,
        loadingPointId: link.loadingPointId,
        vehicleId: vehicle.id,
        productId: input.productId,
        equipmentCodeSnapshot: vehicle.code ?? vehicle.plate,
        plateSnapshot: vehicle.plate,
        loadedAt: input.loadedAt,
        submittedAt: now,
        driverWorkerId: driver?.id ?? null,
        driverNameSnapshot: driver ? `${driver.firstName} ${driver.lastName}`.trim() : input.driverName,
        supervisorWorkerId: supervisor?.id ?? null,
        supervisorNameSnapshot: supervisor ? `${supervisor.firstName} ${supervisor.lastName}`.trim() : input.supervisorName,
        manualIdentity: !driver || !supervisor,
        meterType: input.meterType,
        meterReading: ocrResult?.value ?? input.meterReading ?? null,
        meterReadingSource: ocrResult?.value != null ? "ocr" : null,
        ocrConfidence: ocrResult?.value != null ? ocrResult.confidence : null,
        ocrProcessedAt: ocrResult?.value != null ? now : null,
        meterUnavailableReason: input.meterUnavailableReason || null,
        liters: input.liters,
        removedSealNumber: input.removedSealNumber || null,
        installedSealNumber: input.installedSealNumber || null,
        noSealReason: input.noSealReason || null,
        notes: input.notes || null,
        status: "submitted",
      })
      await tx.insert(fuelTaeEvidence).values(storedFiles.map((file) => ({
        id: nanoid(),
        submissionId: id,
        kind: file.upload.kind,
        fileName: path.basename(file.upload.fileName).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || `${file.upload.kind}.jpg`,
        filePath: file.filePath,
        fileSize: file.upload.buffer.length,
        mimeType: file.upload.mimeType,
        sha256: file.sha256,
      })))
    })
  } catch (error) {
    await Promise.allSettled(storedFiles.map((file) => removeFile(file.absolutePath)))
    throw error
  }

  await recordAudit({
    userId: null,
    action: "create",
    entityType: "fuel_tae_submission",
    entityId: id,
    newState: { source: "public_pwa", worksiteId: link.worksiteId, liters: input.liters },
    ipAddress,
  })
  await recordStatusChange({ entityType: "fuel_tae_submission", entityId: id, fromStatus: null, toStatus: "submitted", changedBy: null })
  const saved = await db.query.fuelTaeSubmissions.findFirst({ where: eq(fuelTaeSubmissions.id, id) })
  if (saved) {
    const { alerts } = await getTaeSubmissionContext(saved)
    if (alerts.length > 0) {
      notifyAfterCommit(async () => {
        const reviewerIds = await getUserIdsWithPermissionForWorksite("combustibles:tae_review", saved.worksiteId)
        await notifyManyUser(reviewerIds, {
          type: "system_alert",
          title: `Carga TAE con ${alerts.length} alerta${alerts.length === 1 ? "" : "s"}`,
          body: `${saved.equipmentCodeSnapshot} · ${Number(saved.liters).toLocaleString("es-CL")} L · ${alerts.map((alert) => alert.message).join("; ")}`,
          entityType: "fuel_tae_submission",
          entityId: id,
          entityHref: `/combustibles/tae/${id}`,
          dedupeKey: `tae-alert:${id}`,
        })
      })
    }
  }
  return { id, publicResultToken, duplicate: false }
}

export async function getTaeSubmissionByToken(publicResultToken: string) {
  if (!publicResultToken) return null
  const submission = await db.query.fuelTaeSubmissions.findFirst({
    where: eq(fuelTaeSubmissions.publicResultToken, publicResultToken),
    with: { worksite: { columns: { name: true } }, loadingPoint: { columns: { name: true } } },
  })
  if (!submission || submission.publicResultRevokedAt) return null
  return submission
}

export async function reviewTaeSubmission({ id, expectedStatus, status, reviewNote, userId }: { id: string; expectedStatus: "submitted" | "observed" | "validated" | "voided"; status: "observed" | "validated" | "voided"; reviewNote: string; userId: string }) {
  const current = await db.query.fuelTaeSubmissions.findFirst({ where: eq(fuelTaeSubmissions.id, id) })
  if (!current) throw new Error("Carga TAE no encontrada")
  if (current.status !== expectedStatus) throw new Error("La carga cambió mientras la revisabas. Actualiza la página e inténtalo nuevamente.")
  if (!isTaeReviewTransitionAllowed(current.status as "submitted" | "observed" | "validated" | "voided", status)) throw new Error("La transición de estado solicitada no está permitida")
  const now = new Date().toISOString()
  await db.transaction(async (tx) => {
    const updated = await tx.update(fuelTaeSubmissions)
      .set({ status, reviewNote, reviewedBy: userId, reviewedAt: now, updatedAt: now })
      .where(and(eq(fuelTaeSubmissions.id, id), eq(fuelTaeSubmissions.status, expectedStatus)))
      .returning({ id: fuelTaeSubmissions.id })
    if (updated.length === 0) throw new Error("La carga cambió mientras la revisabas. Actualiza la página e inténtalo nuevamente.")
    await recordAudit({ userId, action: "status_change", entityType: "fuel_tae_submission", entityId: id, oldState: { status: current.status }, newState: { status }, reason: reviewNote }, tx)
    await recordStatusChange({ entityType: "fuel_tae_submission", entityId: id, fromStatus: current.status, toStatus: status, changedBy: userId, reason: reviewNote }, tx)
  })
}

export type TaeSubmissionRow = typeof fuelTaeSubmissions.$inferSelect

export interface TaeAlert {
  code: "manual_identity" | "seal_mismatch" | "seal_reused" | "reading_regression" | "possible_duplicate" | "low_ocr_confidence"
  message: string
}

function computeTaeAlerts(submission: TaeSubmissionRow, previous: TaeSubmissionRow | null, hasDuplicate: boolean): TaeAlert[] {
  const alerts: TaeAlert[] = []
  if (submission.manualIdentity) {
    alerts.push({ code: "manual_identity", message: "Conductor o supervisor no verificado en catálogo (identificación manual)" })
  }
  if (previous) {
    if (previous.installedSealNumber && submission.removedSealNumber && previous.installedSealNumber !== submission.removedSealNumber) {
      alerts.push({ code: "seal_mismatch", message: `Sello retirado (${submission.removedSealNumber}) no coincide con el último sello instalado (${previous.installedSealNumber})` })
    }
    if (submission.installedSealNumber && previous.installedSealNumber && submission.installedSealNumber === previous.installedSealNumber) {
      alerts.push({ code: "seal_reused", message: "El sello instalado se repite respecto a la carga anterior" })
    }
    if (submission.meterReading != null && previous.meterReading != null && submission.meterType === previous.meterType && submission.meterReading < previous.meterReading) {
      alerts.push({ code: "reading_regression", message: `Lectura (${submission.meterReading}) menor que la carga anterior (${previous.meterReading})` })
    }
  }
  if (hasDuplicate) {
    alerts.push({ code: "possible_duplicate", message: "Otra carga del mismo equipo tiene igual fecha, litros y lectura" })
  }
  if (submission.meterReadingSource === "ocr" && submission.ocrConfidence != null && Number(submission.ocrConfidence) < 0.7) {
    alerts.push({ code: "low_ocr_confidence", message: `Lectura OCR con baja confianza (${Math.round(Number(submission.ocrConfidence) * 100)}%). Verificar manualmente.` })
  }
  return alerts
}

/**
 * Reporte de mapeo sugerido del histórico TAE (Fase 5, dry-run de solo lectura):
 * parsea el Excel legado, lo compara contra los catálogos actuales y devuelve
 * un XLSX con el detalle por faena/equipo/conductor/supervisor para revisión
 * manual. No escribe nada en la base de datos.
 */
export async function generateTaeImportDryRunReport(fileBuffer: ArrayBuffer | Buffer): Promise<Buffer> {
  const [{ parseTaeLegacyExcel }, { buildTaeImportReport, renderTaeImportReportXlsx }] = await Promise.all([
    import("@/lib/combustibles/tae-import"),
    import("@/lib/combustibles/tae-import-report"),
  ])
  const [parsed, catalogRows] = await Promise.all([
    parseTaeLegacyExcel(fileBuffer),
    Promise.all([
      db.query.worksites.findMany({ columns: { id: true, name: true } }),
      db.query.fuelVehicles.findMany({ columns: { id: true, code: true, plate: true }, with: { worksite: { columns: { name: true } } } }),
      db.query.workers.findMany({ where: eq(workers.isActive, true), columns: { id: true, firstName: true, lastName: true, worksiteId: true }, with: { worksite: { columns: { name: true } } } }),
    ]),
  ])
  const { rows, errors } = parsed
  const [worksitesList, vehiclesList, workersList] = catalogRows

  const report = buildTaeImportReport({
    rows,
    errors,
    worksites: worksitesList,
    vehicles: vehiclesList.map((vehicle) => ({ id: vehicle.id, code: vehicle.code, plate: vehicle.plate, worksiteName: vehicle.worksite?.name ?? "" })),
    workers: workersList.map((worker) => ({ id: worker.id, name: `${worker.firstName} ${worker.lastName}`, worksiteId: worker.worksiteId, worksiteName: worker.worksite?.name ?? "" })),
  })
  return renderTaeImportReportXlsx(report)
}

/** Dry-run serializable para revisar identidades ambiguas antes de escribir el lote. */
export async function generateTaeImportPreview(fileBuffer: ArrayBuffer | Buffer, allowedWorksiteIds?: ReadonlySet<string>) {
  const [{ parseTaeLegacyExcel }, { buildTaeImportReport }, { buildTaeImportReview, vehicleMappingKey, workerMappingKey }] = await Promise.all([
    import("@/lib/combustibles/tae-import"),
    import("@/lib/combustibles/tae-import-report"),
    import("@/lib/combustibles/tae-import-service"),
  ])
  const [parsed, catalogRows] = await Promise.all([
    parseTaeLegacyExcel(fileBuffer),
    Promise.all([
      db.query.worksites.findMany({ columns: { id: true, name: true } }),
      db.query.fuelVehicles.findMany({ columns: { id: true, code: true, plate: true, worksiteId: true }, with: { worksite: { columns: { name: true } } } }),
      db.query.workers.findMany({ where: eq(workers.isActive, true), columns: { id: true, firstName: true, lastName: true, worksiteId: true }, with: { worksite: { columns: { name: true } } } }),
      db.query.fuelTaeVehicleMappings.findMany({ columns: { worksiteId: true, legacyCode: true, vehicleId: true } }),
      db.query.fuelTaeWorkerMappings.findMany({ columns: { worksiteId: true, role: true, legacyName: true, workerId: true } }),
    ]),
  ])
  const { rows, errors } = parsed
  const [worksitesList, vehiclesList, workersList, vehicleMappings, workerMappings] = catalogRows
  const catalogs = {
    worksites: worksitesList,
    vehicles: vehiclesList.map((vehicle) => ({ id: vehicle.id, code: vehicle.code, plate: vehicle.plate, worksiteId: vehicle.worksiteId, worksiteName: vehicle.worksite?.name ?? "" })),
    workers: workersList.map((worker) => ({ id: worker.id, name: `${worker.firstName} ${worker.lastName}`, worksiteId: worker.worksiteId, worksiteName: worker.worksite?.name ?? "" })),
  }
  const mappings = {
    vehicles: new Map(vehicleMappings.map((row) => [vehicleMappingKey(row.worksiteId, row.legacyCode), row.vehicleId])),
    drivers: new Map(workerMappings.filter((row) => row.role === "driver").map((row) => [workerMappingKey(row.worksiteId, row.legacyName), row.workerId])),
    supervisors: new Map(workerMappings.filter((row) => row.role === "supervisor").map((row) => [workerMappingKey(row.worksiteId, row.legacyName), row.workerId])),
  }
  const report = buildTaeImportReport({
    rows,
    errors,
    worksites: worksitesList,
    vehicles: catalogs.vehicles,
    workers: catalogs.workers,
  })
  return buildTaeImportReview({ rows, report, catalogs, allowedWorksiteIds, mappings })
}

/** Carga anterior/siguiente del mismo equipo y alertas de continuidad de sello/lectura/duplicado. */
export async function getTaeSubmissionContext(submission: TaeSubmissionRow): Promise<{ previous: TaeSubmissionRow | null; next: TaeSubmissionRow | null; alerts: TaeAlert[] }> {
  if (!submission.vehicleId) {
    return { previous: null, next: null, alerts: computeTaeAlerts(submission, null, false) }
  }
  const [previous, next, sameLiters] = await Promise.all([
    db.query.fuelTaeSubmissions.findFirst({
      where: and(eq(fuelTaeSubmissions.vehicleId, submission.vehicleId), ne(fuelTaeSubmissions.status, "voided"), lt(fuelTaeSubmissions.loadedAt, submission.loadedAt)),
      orderBy: [desc(fuelTaeSubmissions.loadedAt)],
    }),
    db.query.fuelTaeSubmissions.findFirst({
      where: and(eq(fuelTaeSubmissions.vehicleId, submission.vehicleId), ne(fuelTaeSubmissions.status, "voided"), gt(fuelTaeSubmissions.loadedAt, submission.loadedAt)),
      orderBy: [asc(fuelTaeSubmissions.loadedAt)],
    }),
    db.query.fuelTaeSubmissions.findMany({
      where: and(eq(fuelTaeSubmissions.vehicleId, submission.vehicleId), ne(fuelTaeSubmissions.status, "voided"), eq(fuelTaeSubmissions.liters, submission.liters), ne(fuelTaeSubmissions.id, submission.id)),
      columns: { id: true, loadedAt: true, meterReading: true },
    }),
  ])
  const hasDuplicate = sameLiters.some((item) =>
    item.loadedAt.slice(0, 10) === submission.loadedAt.slice(0, 10) && item.meterReading === submission.meterReading
  )
  return { previous: previous ?? null, next: next ?? null, alerts: computeTaeAlerts(submission, previous ?? null, hasDuplicate) }
}
