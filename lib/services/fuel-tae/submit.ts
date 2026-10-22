import { createHash } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelSupplyMedia,
  fuelTaeEvidence,
  fuelTaeLoadingPoints,
  fuelTaeSubmissions,
  fuelVehicleProducts,
  fuelVehicles,
  workers,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { mkdirp, removeFile, writeBuffer } from "@/lib/storage/helpers"
import { createFuelTaeEvidencePath, resolveFuelTaeEvidenceDir, resolveStorageFile } from "@/lib/storage/config"
import { taeEvidenceKinds, type TaePublicSubmissionInput } from "@/lib/validation/fuel-tae"
import type { OcrMeterResult } from "@/lib/services/tae-ocr"
import { getUserIdsWithPermissionForWorksite, notifyAfterCommit, notifyManyUser } from "@/lib/services/notifications"
import {
  checkLiters,
  checkSealInputs,
  trimSeal,
  missingEvidenceMessage,
  requiredEvidenceKinds,
  resolveLoadedAt,
} from "@/lib/combustibles/field-load-rules"
import { evaluateSealChain } from "@/lib/combustibles/control/seal-chain"
import { auditResetDecisions } from "@/lib/combustibles/projection-audit"
import { projectTaeSubmissions } from "@/lib/combustibles/control/projection"
import { getActiveLink } from "./access"
import { getTaeSubmissionContext } from "./context"
import { TaeSubmissionRejected } from "./errors"
import { assertMeterNotRegressing, findPreviousSubmission } from "./submit-rules"
import type { TaeEvidenceKind, TaeEvidenceUpload } from "./types"

function extensionForMime(mimeType: string) {
  return mimeType === "image/png" ? "png" : "jpg"
}

/** Quién y desde dónde registra: la PWA por QR (sin usuario) o la app autenticada. */
export interface FieldLoadContext {
  source: "public_pwa" | "internal_app"
  worksiteId: string
  loadingPointId: string
  registeredBy: string | null
  ipAddress?: string
}

export interface FieldLoadResult {
  id: string
  publicResultToken: string
  duplicate: boolean
}

function assertEvidence(input: TaePublicSubmissionInput, evidence: TaeEvidenceUpload[]) {
  const present = new Set<TaeEvidenceKind>()
  for (const item of evidence) {
    if (!(taeEvidenceKinds as readonly string[]).includes(item.kind) || present.has(item.kind)) {
      throw new TaeSubmissionRejected("Las fotos adjuntas no son válidas. Vuelve a tomarlas.", "evidence_missing")
    }
    present.add(item.kind)
  }
  const missing = requiredEvidenceKinds(input).filter((kind) => !present.has(kind))
  if (missing.length > 0) throw new TaeSubmissionRejected(missingEvidenceMessage(missing), "evidence_missing")
}

/**
 * Registro de una carga en terreno. Lo comparten la PWA pública (enlace QR) y
 * la API autenticada; las reglas de negocio viven aquí para que ninguna vía
 * pueda saltárselas.
 */
export async function registerFieldLoad({
  context,
  input,
  evidence,
  ocrResult,
}: {
  context: FieldLoadContext
  input: TaePublicSubmissionInput
  evidence: TaeEvidenceUpload[]
  ocrResult?: OcrMeterResult
}): Promise<FieldLoadResult> {
  const timing = resolveLoadedAt(input)
  if (!timing.ok) throw new TaeSubmissionRejected(timing.issue.message, "invalid_time", timing.issue.field)
  const { loadedAt, source: loadedAtSource } = timing

  const sealIssue = checkSealInputs(input)
  if (sealIssue) throw new TaeSubmissionRejected(sealIssue.message, sealIssue.field === "noSealReason" ? "seal_reason_required" : "filler_seal", sealIssue.field)
  assertEvidence(input, evidence)

  const [vehicle, productCompatibility, driver, supervisor, point, medium] = await Promise.all([
    db.query.fuelVehicles.findFirst({ where: and(eq(fuelVehicles.id, input.vehicleId), eq(fuelVehicles.isActive, true)) }),
    db.query.fuelVehicleProducts.findFirst({
      where: and(eq(fuelVehicleProducts.vehicleId, input.vehicleId), eq(fuelVehicleProducts.productId, input.productId)),
      with: { product: true },
    }),
    input.driverWorkerId ? db.query.workers.findFirst({ where: and(eq(workers.id, input.driverWorkerId), eq(workers.isActive, true)) }) : Promise.resolve(null),
    input.supervisorWorkerId ? db.query.workers.findFirst({ where: and(eq(workers.id, input.supervisorWorkerId), eq(workers.isActive, true)) }) : Promise.resolve(null),
    db.query.fuelTaeLoadingPoints.findFirst({
      where: and(eq(fuelTaeLoadingPoints.id, context.loadingPointId), eq(fuelTaeLoadingPoints.worksiteId, context.worksiteId), eq(fuelTaeLoadingPoints.isActive, true)),
      columns: { id: true },
    }),
    db.select({ id: fuelSupplyMedia.id }).from(fuelSupplyMedia)
      .where(and(eq(fuelSupplyMedia.id, input.supplyMediumId), eq(fuelSupplyMedia.isActive, true))).limit(1).then((rows) => rows[0] ?? null),
  ])
  if (!point) throw new Error("El punto de carga no pertenece a la faena o está inactivo")
  if (!vehicle || vehicle.worksiteId !== context.worksiteId) throw new Error("El equipo no pertenece a la faena o está inactivo")
  if (!productCompatibility?.product?.isActive) throw new Error("El producto no está habilitado para este equipo")
  if (input.driverWorkerId && (!driver || driver.worksiteId !== context.worksiteId)) throw new Error("El conductor no pertenece a la faena o está inactivo")
  if (input.supervisorWorkerId && (!supervisor || supervisor.worksiteId !== context.worksiteId)) throw new Error("El supervisor no pertenece a la faena o está inactivo")
  if (!medium) throw new TaeSubmissionRejected("El medio de suministro elegido ya no está disponible. Elige otro.", "invalid_medium", "supplyMediumId")

  // El medidor lo manda el equipo, no el formulario: así una selección errada del
  // operador no cambia contra qué serie se compara su lectura.
  const meterType = vehicle.meterType === "none" ? input.meterType : vehicle.meterType as "odometer" | "hour_meter"
  const reading = input.meterReading ?? null
  if (vehicle.meterType !== "none" && reading == null) {
    throw new TaeSubmissionRejected(
      `Anota la lectura del ${meterType === "hour_meter" ? "horómetro" : "odómetro"} tal como aparece en el tablero.`,
      "reading_required",
      "meterReading",
    )
  }
  const litersIssue = checkLiters(input.liters, vehicle.tankCapacityLiters)
  if (litersIssue) throw new TaeSubmissionRejected(litersIssue.message, litersIssue.field === "liters" && input.liters > 0 ? "over_capacity" : "invalid_liters", "liters")
  // Rechazo temprano, antes de escribir las fotos; se repite bajo el candado del equipo.
  await assertMeterNotRegressing(db, vehicle.id, meterType, reading, loadedAt)

  const id = nanoid()
  const publicResultToken = nanoid(32)
  const now = new Date().toISOString()
  // Se guarda el sello tal como está grabado ("0504"); la forma canónica solo sirve para comparar.
  const removedSeal = trimSeal(input.removedSealNumber)
  const installedSeal = trimSeal(input.installedSealNumber)
  const storedFiles: Array<{ filePath: string; absolutePath: string; upload: TaeEvidenceUpload; sha256: string }> = []

  try {
    const evidenceDir = resolveFuelTaeEvidenceDir()
    await mkdirp(evidenceDir)
    for (const upload of evidence) {
      const storageName = `${id}-${upload.kind}-${nanoid(10)}.${extensionForMime(upload.mimeType)}`
      const absolutePath = resolveStorageFile(evidenceDir, storageName)
      await writeBuffer(absolutePath, upload.buffer)
      storedFiles.push({
        filePath: createFuelTaeEvidencePath(storageName),
        absolutePath,
        upload,
        sha256: createHash("sha256").update(upload.buffer).digest("hex"),
      })
    }

    const submission = await db.transaction(async (tx) => {
      // Serializa las cargas del mismo equipo: la lectura anterior y la cadena de
      // sellos se leen de la última carga, y dos envíos simultáneos no deben
      // compararse con la misma.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`fuel_tae_vehicle:${vehicle.id}`}))`)

      // Un reintento con la misma clave devuelve la carga original sin volver a
      // evaluar reglas: la lectura que aceptó entonces ya no es "la última".
      const [already] = await tx.select({ id: fuelTaeSubmissions.id, publicResultToken: fuelTaeSubmissions.publicResultToken })
        .from(fuelTaeSubmissions).where(eq(fuelTaeSubmissions.clientSubmissionId, input.clientSubmissionId))
      if (already) return { ...already, duplicate: true }

      await assertMeterNotRegressing(tx, vehicle.id, meterType, reading, loadedAt)
      const previous = await findPreviousSubmission(tx, vehicle.id, loadedAt)
      const chain = evaluateSealChain(
        { removedSeal, installedSeal, noSealReason: (input.noSealReason ?? "").trim() || null },
        previous ? previous.installedSealNumber : undefined,
      )

      const [inserted] = await tx.insert(fuelTaeSubmissions).values({
        id,
        clientSubmissionId: input.clientSubmissionId,
        source: context.source,
        publicResultToken,
        worksiteId: context.worksiteId,
        loadingPointId: context.loadingPointId,
        vehicleId: vehicle.id,
        productId: input.productId,
        supplyMediumId: medium.id,
        equipmentCodeSnapshot: vehicle.code ?? vehicle.plate,
        plateSnapshot: vehicle.plate,
        loadedAt,
        loadedAtSource,
        submittedAt: now,
        registeredBy: context.registeredBy,
        driverWorkerId: driver?.id ?? null,
        driverNameSnapshot: driver ? `${driver.firstName} ${driver.lastName}`.trim() : input.driverName,
        supervisorWorkerId: supervisor?.id ?? null,
        supervisorNameSnapshot: supervisor ? `${supervisor.firstName} ${supervisor.lastName}`.trim() : input.supervisorName,
        manualIdentity: !driver || !supervisor,
        meterType,
        // D-5: lo que vale es lo que digitó el operador. El OCR queda como
        // sugerencia para el revisor y nunca ocupa su lugar.
        meterReading: reading,
        meterReadingSource: reading != null ? "manual" : null,
        ocrSuggestedReading: ocrResult?.value ?? null,
        ocrConfidence: ocrResult?.value != null ? ocrResult.confidence : null,
        ocrRawText: ocrResult?.rawText || null,
        ocrProcessedAt: ocrResult ? now : null,
        meterUnavailableReason: input.meterUnavailableReason || null,
        liters: input.liters,
        removedSealNumber: removedSeal,
        installedSealNumber: installedSeal,
        noSealReason: input.noSealReason || null,
        sealChainStatus: chain.status,
        sealChainExpected: chain.expected,
        notes: input.notes || null,
        status: "submitted",
      }).onConflictDoNothing({ target: fuelTaeSubmissions.clientSubmissionId }).returning({
        id: fuelTaeSubmissions.id,
        publicResultToken: fuelTaeSubmissions.publicResultToken,
      })

      if (!inserted) {
        const [existing] = await tx.select({
          id: fuelTaeSubmissions.id,
          publicResultToken: fuelTaeSubmissions.publicResultToken,
        })
          .from(fuelTaeSubmissions)
          .where(eq(fuelTaeSubmissions.clientSubmissionId, input.clientSubmissionId))

        if (!existing) throw new Error("No se pudo recuperar la carga TAE idempotente")
        return { ...existing, duplicate: true }
      }

      await tx.insert(fuelTaeEvidence).values(storedFiles.map((file) => ({
        id: nanoid(),
        submissionId: inserted.id,
        kind: file.upload.kind,
        fileName: (file.upload.fileName.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || `${file.upload.kind}.jpg`,
        filePath: file.filePath,
        fileSize: file.upload.buffer.length,
        mimeType: file.upload.mimeType,
        sha256: file.sha256,
      })))
      // Una sola entrada de auditoría por alta; si la cadena de sellos se rompió,
      // el motivo viaja en esa misma entrada. Es una alerta de seguridad, no un
      // error de validación: la carga se registra igual.
      await recordAudit({
        userId: context.registeredBy,
        action: "create",
        entityType: "fuel_tae_submission",
        entityId: inserted.id,
        newState: {
          source: context.source,
          worksiteId: context.worksiteId,
          liters: input.liters,
          loadedAtSource,
          sealChainStatus: chain.status,
          ...(chain.status === "mismatch" ? { sealChainExpected: chain.expected } : {}),
        },
        worksiteId: context.worksiteId,
        ...(chain.status === "mismatch" ? { reason: `Cadena de sellos rota: se esperaba ${chain.expected ?? "(sin sello)"}` } : {}),
        ipAddress: context.ipAddress,
      }, tx)
      await recordStatusChange({
        entityType: "fuel_tae_submission",
        entityId: inserted.id,
        fromStatus: null,
        toStatus: "submitted",
        changedBy: context.registeredBy,
      }, tx)
      const projection = await projectTaeSubmissions(tx, [inserted.id])
      await auditResetDecisions(tx, projection.resetLoadIds, { userId: context.registeredBy }, context.worksiteId)
      return { ...inserted, duplicate: false }
    })

    if (submission.duplicate) {
      await Promise.allSettled(storedFiles.map((file) => removeFile(file.absolutePath)))
      return submission
    }
  } catch (error) {
    await Promise.allSettled(storedFiles.map((file) => removeFile(file.absolutePath)))
    throw error
  }

  await notifyReviewersIfAlerts(id)
  return { id, publicResultToken, duplicate: false }
}

async function notifyReviewersIfAlerts(id: string) {
  const saved = await db.query.fuelTaeSubmissions.findFirst({ where: eq(fuelTaeSubmissions.id, id) })
  if (!saved) return
  const { alerts } = await getTaeSubmissionContext(saved)
  if (alerts.length === 0) return
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

/** Carga recibida por un enlace QR público: la faena y el punto salen del enlace. */
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
}): Promise<FieldLoadResult> {
  const link = await getActiveLink(accessToken)
  if (input.worksiteId !== link.worksiteId) throw new Error("La faena no corresponde al enlace")
  if (!link.loadingPointId || input.loadingPointId !== link.loadingPointId) throw new Error("El punto de carga no corresponde al enlace")
  return registerFieldLoad({
    context: { source: "public_pwa", worksiteId: link.worksiteId, loadingPointId: link.loadingPointId, registeredBy: null, ipAddress },
    input,
    evidence,
    ocrResult,
  })
}

/** Carga registrada por un usuario autenticado; el llamador ya comprobó permiso y alcance de faena. */
export async function createInternalFieldLoad({
  userId,
  input,
  evidence,
  ipAddress,
  ocrResult,
}: {
  userId: string
  input: TaePublicSubmissionInput
  evidence: TaeEvidenceUpload[]
  ipAddress?: string
  ocrResult?: OcrMeterResult
}): Promise<FieldLoadResult> {
  return registerFieldLoad({
    context: { source: "internal_app", worksiteId: input.worksiteId, loadingPointId: input.loadingPointId, registeredBy: userId, ipAddress },
    input,
    evidence,
    ocrResult,
  })
}
