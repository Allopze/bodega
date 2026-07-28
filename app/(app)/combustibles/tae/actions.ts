"use server"

import { revalidatePath } from "next/cache"
import { and, desc, eq, ilike, or, sql } from "drizzle-orm"
import { isNetworkError } from "@/lib/network-error"
import { db } from "@/db"
import { fuelStorageLocations, fuelTaeEvidence, fuelTaeLoadingPoints, fuelTaePublicLinks, fuelTaeSubmissions } from "@/db/schema"
import { guardPermission, requirePermission } from "@/lib/auth/can"
import { canAccessWorksite, worksiteScopeSql } from "@/lib/auth/scope"
import { createTaePublicLink, revokeTaePublicLink, reviewTaeSubmission } from "@/lib/services/fuel-tae"
import { taeMeterCorrectionSchema, taeReviewSchema } from "@/lib/validation/fuel-tae"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { nanoid } from "@/lib/id"
import { addExportMetadataSheet } from "@/lib/combustibles/xlsx-utils"

const MAX_TAE_EXPORT_ROWS = 10_000

export async function createTaePublicLinkAction(input: { worksiteId: string; loadingPointId: string; label: string }) {
  const guard = await guardPermission("combustibles:tae_manage_config")
  if (guard.error) return guard.error
  if (!canAccessWorksite(guard.session, input.worksiteId)) return { ok: false, message: "No tienes acceso a esta faena" }
  try {
    const link = await createTaePublicLink({
      worksiteId: input.worksiteId,
      loadingPointId: input.loadingPointId,
      label: input.label.trim() || "Acceso TAE",
      createdBy: guard.session.user.id,
    })
    revalidatePath("/combustibles/tae")
    return { ok: true, data: link }
  } catch (error) {
    logger.error("[createTaePublicLinkAction]", error)
    const msg = error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : error instanceof Error ? error.message : "No se pudo generar el enlace"
    return { ok: false, message: msg }
  }
}

export async function revokeTaePublicLinkAction(id: string) {
  const guard = await guardPermission("combustibles:tae_manage_config")
  if (guard.error) return guard.error
  const link = await db.query.fuelTaePublicLinks.findFirst({ where: eq(fuelTaePublicLinks.id, id) })
  if (!link || !canAccessWorksite(guard.session, link.worksiteId)) return { ok: false, message: "Enlace no encontrado" }
  await revokeTaePublicLink(id, guard.session.user.id)
  revalidatePath("/combustibles/tae")
  return { ok: true, message: "Enlace revocado" }
}

export async function createTaeLoadingPointAction(input: { worksiteId: string; name: string; type: string; storageLocationId?: string | null }) {
  const guard = await guardPermission("combustibles:tae_manage_config")
  if (guard.error) return guard.error
  if (!canAccessWorksite(guard.session, input.worksiteId)) return { ok: false, message: "No tienes acceso a esta faena" }
  const name = input.name.trim()
  if (name.length < 2) return { ok: false, message: "Indica el nombre del punto de carga" }
  const allowed = ["fixed_dispenser", "truck_dispenser", "pickup_tank", "tae", "other"]
  if (!allowed.includes(input.type)) return { ok: false, message: "Tipo de punto inválido" }
  try {
    await db.insert(fuelTaeLoadingPoints).values({ id: nanoid(), worksiteId: input.worksiteId, name, type: input.type, storageLocationId: input.storageLocationId || null })
    revalidatePath("/combustibles/tae")
    return { ok: true, message: "Punto de carga creado" }
  } catch {
    return { ok: false, message: "No se pudo crear el punto. Revisa que no exista otro con ese nombre." }
  }
}

/** Enlaza (o desvincula) un punto de carga con la vasija de la que reparte.
 *  Sin este enlace, lo que la PWA entrega no se descuenta del saldo de ninguna
 *  vasija concreta: `getFuelStorageBalances` sólo cuenta puntos enlazados. */
export async function setTaeLoadingPointStorageAction(id: string, storageLocationId: string | null) {
  const guard = await guardPermission("combustibles:tae_manage_config")
  if (guard.error) return guard.error
  const point = await db.query.fuelTaeLoadingPoints.findFirst({ where: eq(fuelTaeLoadingPoints.id, id) })
  if (!point || !canAccessWorksite(guard.session, point.worksiteId)) return { ok: false, message: "Punto de carga no encontrado" }
  if (storageLocationId) {
    const location = await db.query.fuelStorageLocations.findFirst({ where: eq(fuelStorageLocations.id, storageLocationId) })
    if (!location || location.worksiteId !== point.worksiteId) return { ok: false, message: "La vasija no pertenece a la misma faena" }
  }
  await db.update(fuelTaeLoadingPoints).set({ storageLocationId, updatedAt: new Date().toISOString() }).where(eq(fuelTaeLoadingPoints.id, id))
  await recordAudit({ userId: guard.session.user.id, userEmail: guard.session.user.email ?? undefined, action: "update", entityType: "fuel_tae_loading_point", entityId: id, oldState: { storageLocationId: point.storageLocationId }, newState: { storageLocationId } })
  revalidatePath("/combustibles/tae")
  revalidatePath("/combustibles/ciclo")
  return { ok: true, message: storageLocationId ? "Vasija asignada" : "Vasija desvinculada" }
}

export async function reviewTaeSubmissionAction(input: { id: string; expectedStatus: "submitted" | "observed" | "validated" | "voided"; status: "observed" | "validated" | "voided"; reviewNote: string }) {
  const guard = await guardPermission("combustibles:tae_review")
  if (guard.error) return guard.error
  const parsed = taeReviewSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" }
  const submission = await db.query.fuelTaeSubmissions.findFirst({ where: eq(fuelTaeSubmissions.id, parsed.data.id) })
  if (!submission || !canAccessWorksite(guard.session, submission.worksiteId)) return { ok: false, message: "Carga no encontrada" }
  try {
    await reviewTaeSubmission({ ...parsed.data, userId: guard.session.user.id })
    revalidatePath("/combustibles/tae")
    return { ok: true, message: "Carga TAE actualizada" }
  } catch (error) {
    logger.error("[reviewTaeSubmissionAction]", error)
    const msg = error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : error instanceof Error ? error.message : "No se pudo actualizar la carga"
    return { ok: false, message: msg }
  }
}

export async function updateTaeMeterReadingAction(input: {
  id: string
  expectedStatus: "submitted" | "observed" | "validated" | "voided"
  meterReading: number
  meterType: "odometer" | "hour_meter"
  reason: string
}) {
  const guard = await guardPermission("combustibles:tae_review")
  if (guard.error) return guard.error
  const parsed = taeMeterCorrectionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" }
  const submission = await db.query.fuelTaeSubmissions.findFirst({ where: eq(fuelTaeSubmissions.id, parsed.data.id) })
  if (!submission || !canAccessWorksite(guard.session, submission.worksiteId)) return { ok: false, message: "Carga no encontrada" }
  if (submission.status !== parsed.data.expectedStatus) return { ok: false, message: "La carga cambió mientras la editabas. Actualiza la página e inténtalo nuevamente." }
  if (submission.status === "voided") return { ok: false, message: "Una carga anulada no admite correcciones" }

  const now = new Date().toISOString()
  const nextStatus = submission.status === "validated" ? "observed" : submission.status
  try {
    await db.transaction(async (tx) => {
      const updated = await tx.update(fuelTaeSubmissions).set({
        meterReading: parsed.data.meterReading,
        meterReadingSource: "manual",
        meterType: parsed.data.meterType,
        status: nextStatus,
        reviewNote: submission.status === "validated" ? `Lectura corregida: ${parsed.data.reason}` : submission.reviewNote,
        reviewedBy: submission.status === "validated" ? guard.session.user.id : submission.reviewedBy,
        reviewedAt: submission.status === "validated" ? now : submission.reviewedAt,
        updatedAt: now,
      }).where(and(eq(fuelTaeSubmissions.id, parsed.data.id), eq(fuelTaeSubmissions.status, parsed.data.expectedStatus))).returning({ id: fuelTaeSubmissions.id })
      if (updated.length === 0) throw new Error("La carga cambió mientras la editabas. Actualiza la página e inténtalo nuevamente.")
      await recordAudit({
        userId: guard.session.user.id,
        action: "update",
        entityType: "fuel_tae_submission",
        entityId: parsed.data.id,
        oldState: { meterReading: submission.meterReading, meterType: submission.meterType, meterReadingSource: submission.meterReadingSource, ocrSuggestedReading: submission.ocrSuggestedReading, status: submission.status },
        newState: { meterReading: parsed.data.meterReading, meterType: parsed.data.meterType, meterReadingSource: "manual", status: nextStatus },
        reason: parsed.data.reason,
      }, tx)
      if (nextStatus !== submission.status) {
        await recordStatusChange({ entityType: "fuel_tae_submission", entityId: parsed.data.id, fromStatus: submission.status, toStatus: nextStatus, changedBy: guard.session.user.id, reason: parsed.data.reason }, tx)
      }
    })
  } catch (error) {
    logger.error("[updateTaeMeterReadingAction]", error)
    const msg = error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : error instanceof Error ? error.message : "No se pudo corregir la lectura"
    return { ok: false, message: msg }
  }

  revalidatePath("/combustibles/tae")
  revalidatePath(`/combustibles/tae/${parsed.data.id}`)
  return { ok: true, message: nextStatus === "observed" && submission.status === "validated" ? "Lectura actualizada; la carga volvió a observada" : "Lectura actualizada" }
}

export type TaeExportFilters = { q?: string; from?: string; to?: string; worksiteId?: string; loadingPointId?: string; status?: string; seal?: string; evidence?: string }

export async function exportTaeSubmissionsXlsxAction(filters: TaeExportFilters = {}) {
  let session
  try { session = await requirePermission("combustibles:tae_export") }
  catch { return { ok: false as const, message: "Sin permisos" } }

  const status = ["submitted", "observed", "validated", "voided"].includes(filters.status ?? "") ? filters.status : undefined
  const q = filters.q?.trim().slice(0, 120)
  const where = and(
    worksiteScopeSql(session, fuelTaeSubmissions.worksiteId),
    filters.worksiteId ? eq(fuelTaeSubmissions.worksiteId, filters.worksiteId) : undefined,
    filters.loadingPointId ? eq(fuelTaeSubmissions.loadingPointId, filters.loadingPointId) : undefined,
    status ? eq(fuelTaeSubmissions.status, status) : undefined,
    filters.seal === "missing" ? sql`(${fuelTaeSubmissions.removedSealNumber} is null or btrim(${fuelTaeSubmissions.removedSealNumber}) = '' or ${fuelTaeSubmissions.installedSealNumber} is null or btrim(${fuelTaeSubmissions.installedSealNumber}) = '')` : undefined,
    filters.evidence === "missing" ? sql`(select count(distinct ${fuelTaeEvidence.kind}) from ${fuelTaeEvidence} where ${fuelTaeEvidence.submissionId} = ${fuelTaeSubmissions.id}) < 4` : undefined,
    /^\d{4}-\d{2}-\d{2}$/.test(filters.from ?? "") ? sql`(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago')::date >= ${filters.from}::date` : undefined,
    /^\d{4}-\d{2}-\d{2}$/.test(filters.to ?? "") ? sql`(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago')::date <= ${filters.to}::date` : undefined,
    q ? or(ilike(fuelTaeSubmissions.equipmentCodeSnapshot, `%${q}%`), ilike(fuelTaeSubmissions.plateSnapshot, `%${q}%`), ilike(fuelTaeSubmissions.supervisorNameSnapshot, `%${q}%`), ilike(fuelTaeSubmissions.driverNameSnapshot, `%${q}%`)) : undefined,
  )
  const rows = await db.query.fuelTaeSubmissions.findMany({
    where,
    with: { worksite: { columns: { name: true } }, loadingPoint: { columns: { name: true } } },
    orderBy: [desc(fuelTaeSubmissions.loadedAt)],
    limit: MAX_TAE_EXPORT_ROWS + 1,
  })
  const truncated = rows.length > MAX_TAE_EXPORT_ROWS
  const exportRows = truncated ? rows.slice(0, MAX_TAE_EXPORT_ROWS) : rows

  const ExcelJS = await import("exceljs")
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Control TAE")

  ws.columns = [
    { header: "Fecha carga", key: "loadedAt", width: 20 },
    { header: "Faena", key: "worksite", width: 20 },
    { header: "Punto de carga", key: "loadingPoint", width: 22 },
    { header: "Equipo", key: "equipment", width: 12 },
    { header: "Patente", key: "plate", width: 12 },
    { header: "Supervisor / líder", key: "supervisor", width: 22 },
    { header: "Conductor", key: "driver", width: 22 },
    { header: "Tipo medidor", key: "meterType", width: 14 },
    { header: "Lectura", key: "meterReading", width: 12 },
    { header: "Fuente lectura", key: "meterReadingSource", width: 14 },
    { header: "Litros", key: "liters", width: 12 },
    { header: "Sello retirado", key: "removedSeal", width: 14 },
    { header: "Sello instalado", key: "installedSeal", width: 14 },
    { header: "Identidad manual", key: "manualIdentity", width: 16 },
    { header: "Estado", key: "status", width: 12 },
    { header: "Observaciones", key: "notes", width: 30 },
  ]

  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } }

  for (const row of exportRows) {
    ws.addRow({
      loadedAt: new Date(row.loadedAt).toLocaleString("es-CL"),
      worksite: row.worksite?.name ?? "",
      loadingPoint: row.loadingPoint?.name ?? "",
      equipment: row.equipmentCodeSnapshot,
      plate: row.plateSnapshot ?? "",
      supervisor: row.supervisorNameSnapshot,
      driver: row.driverNameSnapshot,
      meterType: row.meterType === "hour_meter" ? "Horómetro" : "Odómetro",
      meterReading: row.meterReading ?? "",
      meterReadingSource: row.meterReadingSource ?? "",
      liters: row.liters,
      removedSeal: row.removedSealNumber ?? "",
      installedSeal: row.installedSealNumber ?? "",
      manualIdentity: row.manualIdentity ? "Sí" : "No",
      status: row.status,
      notes: row.notes ?? "",
    })
  }
  ws.getColumn("liters").numFmt = "#,##0.000"
  ws.views = [{ state: "frozen", ySplit: 1 }]
  addExportMetadataSheet(wb, session, { filters, rowCount: exportRows.length, from: filters.from, to: filters.to })

  const buffer = await wb.xlsx.writeBuffer()
  const base64 = Buffer.from(buffer).toString("base64")
  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined, action: "export",
    entityType: "fuel_tae_export", entityId: nanoid(),
    newState: { rowCount: exportRows.length, truncated, filters: filters as Record<string, unknown> },
  })
  return {
    ok: true as const,
    data: {
      base64,
      filename: `control_tae_${new Date().toISOString().split("T")[0]}.xlsx`,
      truncated,
      rowLimit: MAX_TAE_EXPORT_ROWS,
    },
  }
}

export async function replaceEvidenceAction(input: {
  evidenceId: string
  replacementFileName: string
  replacementFilePath: string
  replacementMimeType: string
  replacementSize: number
  replacementSha256: string
  motivo: string
}) {
  const guard = await guardPermission("combustibles:tae_review")
  if (guard.error) return guard.error

  const evidence = await db.query.fuelTaeEvidence.findFirst({
    where: eq(fuelTaeEvidence.id, input.evidenceId),
    with: { submission: { columns: { worksiteId: true } } },
  })
  if (!evidence) return { ok: false, message: "Evidencia no encontrada" }
  if (!canAccessWorksite(guard.session, evidence.submission.worksiteId)) return { ok: false, message: "No tienes acceso a esta faena" }

  if (!input.motivo || input.motivo.trim().length < 10) return { ok: false, message: "El motivo de reemplazo debe tener al menos 10 caracteres" }

  const now = new Date().toISOString()
  try {
    await db.transaction(async (tx) => {
      const oldState = {
        fileName: evidence.fileName, filePath: evidence.filePath,
        mimeType: evidence.mimeType, fileSize: evidence.fileSize, sha256: evidence.sha256,
      }
      await tx.update(fuelTaeEvidence).set({
        fileName: input.replacementFileName,
        filePath: input.replacementFilePath,
        mimeType: input.replacementMimeType,
        fileSize: input.replacementSize,
        sha256: input.replacementSha256,
        capturedAt: now,
      }).where(eq(fuelTaeEvidence.id, input.evidenceId))
      await recordAudit({
        userId: guard.session.user.id, action: "update",
        entityType: "fuel_tae_evidence", entityId: input.evidenceId,
        oldState,
        newState: {
          fileName: input.replacementFileName, filePath: input.replacementFilePath,
          mimeType: input.replacementMimeType, fileSize: input.replacementSize, sha256: input.replacementSha256,
        },
        reason: input.motivo,
      }, tx)
    })
    revalidatePath("/combustibles/tae")
    return { ok: true, message: "Evidencia reemplazada correctamente" }
  } catch (error) {
    logger.error("[replaceEvidenceAction]", error)
    const msg = error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : error instanceof Error ? error.message : "No se pudo reemplazar la evidencia"
    return { ok: false, message: msg }
  }
}
