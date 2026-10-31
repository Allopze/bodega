import { createHash } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelEquipmentLoads,
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
import { taeEvidenceKinds, type InternalFieldLoadInput, type PastLoadInput, type TaePublicSubmissionInput } from "@/lib/validation/fuel-tae"
import type { OcrMeterResult } from "@/lib/services/tae-ocr"
import { getUserIdsWithPermissionForWorksite, notifyAfterCommit, notifyManyUser } from "@/lib/services/notifications"
import {
  checkLiters,
  checkSealInputs,
  trimSeal,
  missingEvidenceMessage,
  PastLoadNotAllowed,
  PossibleDuplicateLoad,
  requiredEvidenceKinds,
  resolveLoadedAt,
} from "@/lib/combustibles/field-load-rules"
import { evaluateSealChain } from "@/lib/combustibles/control/seal-chain"
import { auditResetDecisions } from "@/lib/combustibles/projection-audit"
import { projectTaeSubmissions } from "@/lib/combustibles/control/projection"
import { resetStaleDecisionsAfter, snapshotDecidedLoadsAfter } from "@/lib/combustibles/control/stale-decisions"
import { loadPerformanceControlContext } from "@/lib/combustibles/control/settings"
import type { FlagReason, ReviewStatus } from "@/lib/combustibles/control/contracts"
import { getActiveLink } from "./access"
import { getTaeSubmissionContext } from "./context"
import { TaeSubmissionRejected } from "./errors"
import {
  assertMeterBelowNext,
  assertMeterNotRegressing,
  findPossibleDuplicate,
  findPreviousSubmission,
  reevaluateNextSubmissionSealChain,
} from "./submit-rules"
import type { TaeEvidenceKind, TaeEvidenceUpload } from "./types"
import { fuelLoadHref } from "@/lib/combustibles/routes"

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

/** Cómo quedó la carga en el control: «por decidir» (con sus motivos) o sin observaciones. */
export interface FieldLoadReview {
  /** Id de la carga en la serie del equipo (`fuel_equipment_loads`): el de la bandeja «Por revisar». */
  loadId: string
  status: ReviewStatus
  flagReasons: FlagReason[]
}

export interface FieldLoadResult {
  id: string
  publicResultToken: string
  duplicate: boolean
  /** Sólo la vía interna lo devuelve: la pública no muestra el estado del control. */
  review?: FieldLoadReview | null
}

/** Lo que sólo la vía interna puede traer: la carga de otro día y la confirmación de una posible duplicada. */
export interface FieldLoadOptions {
  pastLoad?: PastLoadInput | null
  acknowledgeDuplicate?: boolean
}

/** Con una carga de otro día las fotos son opcionales: se valida su forma, pero no se exige ninguna. */
function assertEvidence(input: TaePublicSubmissionInput, evidence: TaeEvidenceUpload[], options: { optional?: boolean } = {}) {
  const present = new Set<TaeEvidenceKind>()
  for (const item of evidence) {
    if (!(taeEvidenceKinds as readonly string[]).includes(item.kind) || present.has(item.kind)) {
      throw new TaeSubmissionRejected("Las fotos adjuntas no son válidas. Vuelve a tomarlas.", "evidence_missing")
    }
    present.add(item.kind)
  }
  if (options.optional) return
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
  options = {},
}: {
  context: FieldLoadContext
  input: TaePublicSubmissionInput
  evidence: TaeEvidenceUpload[]
  ocrResult?: OcrMeterResult
  options?: FieldLoadOptions
}): Promise<FieldLoadResult> {
  // Una carga por QR nunca trae fecha propia: `pastLoad` sólo existe en la vía interna.
  if (options.pastLoad && context.source !== "internal_app") throw new PastLoadNotAllowed()
  const timing = resolveLoadedAt({ offline: input.offline, capturedAt: input.capturedAt, pastLoad: options.pastLoad })
  if (!timing.ok) throw new TaeSubmissionRejected(timing.issue.message, "invalid_time", timing.issue.field)
  const { loadedAt, source: loadedAtSource } = timing
  const backdated = loadedAtSource === "backdated"

  const sealIssue = checkSealInputs(input)
  if (sealIssue) throw new TaeSubmissionRejected(sealIssue.message, sealIssue.field === "noSealReason" ? "seal_reason_required" : "filler_seal", sealIssue.field)
  assertEvidence(input, evidence, { optional: backdated })

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
  if (backdated) await assertMeterBelowNext(db, vehicle.id, meterType, reading, loadedAt)

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
      if (backdated) {
        await assertMeterBelowNext(tx, vehicle.id, meterType, reading, loadedAt)
        // Después del reintento idempotente: reenviar la misma carga no puede toparse consigo misma.
        if (!options.acknowledgeDuplicate) {
          const { settings } = await loadPerformanceControlContext(tx)
          const similar = await findPossibleDuplicate(tx, vehicle.id, loadedAt, input.liters, settings)
          if (similar) throw new PossibleDuplicateLoad(similar)
        }
      }
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
        backdateReason: timing.backdateReason ?? null,
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

      // Una carga de otro día puede no traer fotos: no hay nada que insertar.
      if (storedFiles.length > 0) await tx.insert(fuelTaeEvidence).values(storedFiles.map((file) => ({
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
          ...(backdated ? { loadedAt, backdateReason: timing.backdateReason } : {}),
          sealChainStatus: chain.status,
          ...(chain.status === "mismatch" ? { sealChainExpected: chain.expected } : {}),
        },
        worksiteId: context.worksiteId,
        ...(backdated || chain.status === "mismatch"
          ? {
              reason: [
                backdated ? `Carga de otro día: ${timing.backdateReason}` : null,
                chain.status === "mismatch" ? `Cadena de sellos rota: se esperaba ${chain.expected ?? "(sin sello)"}` : null,
              ].filter(Boolean).join(". "),
            }
          : {}),
        ipAddress: context.ipAddress,
      }, tx)
      await recordStatusChange({
        entityType: "fuel_tae_submission",
        entityId: inserted.id,
        fromStatus: null,
        toStatus: "submitted",
        changedBy: context.registeredBy,
      }, tx)
      // Si esta carga quedó antes de otras del equipo (una carga de otro día, o un
      // reenvío desde la cola sin conexión), las decisiones ya tomadas sobre las
      // posteriores se miran contra la serie de antes y la de después.
      const decidedLater = await snapshotDecidedLoadsAfter(tx, vehicle.id, loadedAt)
      const projection = await projectTaeSubmissions(tx, [inserted.id])
      await auditResetDecisions(tx, projection.resetLoadIds, { userId: context.registeredBy }, context.worksiteId)
      await resetStaleDecisionsAfter(tx, decidedLater, { userId: context.registeredBy })
      await reevaluateNextSubmissionSealChain(tx, {
        vehicleId: vehicle.id,
        loadedAt,
        installedSeal,
        actorId: context.registeredBy,
      })
      return { ...inserted, duplicate: false }
    })

    if (submission.duplicate) {
      await Promise.allSettled(storedFiles.map((file) => removeFile(file.absolutePath)))
      return { ...submission, review: await readLoadReview(submission.id) }
    }
  } catch (error) {
    await Promise.allSettled(storedFiles.map((file) => removeFile(file.absolutePath)))
    throw error
  }

  await notifyReviewersIfAlerts(id)
  return { id, publicResultToken, duplicate: false, review: await readLoadReview(id) }
}

/** Cómo quedó la carga en la serie del equipo; `null` si no se proyectó (no debería ocurrir) o no se pudo leer. */
async function readLoadReview(submissionId: string): Promise<FieldLoadReview | null> {
  try {
    const [row] = await db.select({
      loadId: fuelEquipmentLoads.id,
      status: fuelEquipmentLoads.reviewStatus,
      flagReasons: fuelEquipmentLoads.flagReasons,
    }).from(fuelEquipmentLoads).where(eq(fuelEquipmentLoads.taeSubmissionId, submissionId)).limit(1)
    return row ? { loadId: row.loadId, status: row.status as ReviewStatus, flagReasons: (row.flagReasons ?? []) as FlagReason[] } : null
  } catch {
    // La carga ya quedó registrada: no leer su estado no debe convertir el éxito en error.
    return null
  }
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
      entityHref: fuelLoadHref({ origen: "terreno", id }),
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
  const { id, publicResultToken, duplicate } = await registerFieldLoad({
    context: { source: "public_pwa", worksiteId: link.worksiteId, loadingPointId: link.loadingPointId, registeredBy: null, ipAddress },
    input,
    evidence,
    ocrResult,
  })
  // La respuesta pública no incluye cómo quedó la carga en el control.
  return { id, publicResultToken, duplicate }
}

/**
 * Carga registrada por un usuario autenticado; el llamador ya comprobó permiso y
 * alcance de faena. La carga de otro día (`pastLoad`) además exige
 * `allowPastLoad`, que el llamador decide con `combustibles:register_past_load`:
 * sin él se rechaza aquí mismo, para que ninguna vía pueda saltarse el permiso.
 */
export async function createInternalFieldLoad({
  userId,
  input,
  evidence,
  ipAddress,
  ocrResult,
  allowPastLoad = false,
}: {
  userId: string
  input: InternalFieldLoadInput
  evidence: TaeEvidenceUpload[]
  ipAddress?: string
  ocrResult?: OcrMeterResult
  allowPastLoad?: boolean
}): Promise<FieldLoadResult> {
  const { pastLoad, acknowledgeDuplicate, ...base } = input
  if (pastLoad && !allowPastLoad) throw new PastLoadNotAllowed()
  return registerFieldLoad({
    context: { source: "internal_app", worksiteId: base.worksiteId, loadingPointId: base.loadingPointId, registeredBy: userId, ipAddress },
    input: base,
    evidence,
    ocrResult,
    options: { pastLoad, acknowledgeDuplicate },
  })
}
