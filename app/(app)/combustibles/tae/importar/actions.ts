"use server"

import { safeActionMessage } from "@/lib/action-error"

import { and, eq, inArray } from "drizzle-orm"
import { isNetworkError } from "@/lib/network-error"
import { db } from "@/db"
import { fuelAnomalyCases, fuelReviewMarks, fuelSealMovements, fuelTaeImportBatches, fuelTaeSubmissions, fuelTaeVehicleMappings, fuelTaeWorkerMappings, fuelVehicles, workers } from "@/db/schema"
import { can, guardPermission } from "@/lib/auth/can"
import { canAccessWorksite, resolveWorksiteScope } from "@/lib/auth/scope"
import { recomputeVehicleSeries } from "@/lib/combustibles/control/projection"
import { retractSealMovements } from "@/lib/combustibles/seal-history"
import { reevaluateSealChainOfNextLoad } from "@/lib/services/fuel-tae/review"
import { generateTaeImportDryRunReport, generateTaeImportPreview } from "@/lib/services/fuel-tae"
import { importTaeLegacyWorkbook, reprocessTaeImportRejectedRows, type TaeImportMappingDecision } from "@/lib/combustibles/tae-import-service"
import { nanoid } from "@/lib/id"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { todayInChile } from "@/lib/utils"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { revalidateFuel } from "@/lib/combustibles/revalidate"

const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024

function parseManualMappings(value: FormDataEntryValue | null): TaeImportMappingDecision[] {
  if (typeof value !== "string" || !value.trim()) return []
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.length > 500) throw new Error("Las decisiones de mapeo no tienen un formato válido")
  return parsed.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Las decisiones de mapeo no tienen un formato válido")
    const decision = item as Record<string, unknown>
    if (!(["vehicle", "driver", "supervisor"] as string[]).includes(String(decision.kind)) || typeof decision.worksiteId !== "string" || typeof decision.legacyValue !== "string" || (decision.targetId !== null && typeof decision.targetId !== "string")) {
      throw new Error("Las decisiones de mapeo no tienen un formato válido")
    }
    return {
      kind: decision.kind as TaeImportMappingDecision["kind"],
      worksiteId: decision.worksiteId,
      legacyValue: decision.legacyValue,
      targetId: typeof decision.targetId === "string" ? decision.targetId.trim() || null : null,
    }
  })
}

export async function generateTaeImportReportAction(formData: FormData) {
  const guard = await guardPermission("combustibles:tae_import", FUEL_PATHS.fuentes)
  if (guard.error) return guard.error

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Selecciona el archivo Excel del histórico de sellos" }
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return { ok: false, message: "El archivo supera el máximo de 20 MB" }
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const scope = resolveWorksiteScope(guard.session)
    const allowedWorksiteIds = scope.mode === "all" ? undefined : new Set(scope.mode === "some" ? scope.ids : [])
    const [report, preview] = await Promise.all([
      generateTaeImportDryRunReport(buffer),
      generateTaeImportPreview(buffer, allowedWorksiteIds),
    ])
    return {
      ok: true as const,
      data: {
        base64: report.toString("base64"),
        filename: `tae_reporte_mapeo_${todayInChile()}.xlsx`,
        preview,
      },
    }
  } catch (error) {
    logger.error("[generateTaeImportReportAction]", error)
    const msg = error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : safeActionMessage(error, "No se pudo generar el reporte")
    return { ok: false, message: msg }
  }
}

export async function importTaeHistoryAction(formData: FormData) {
  const guard = await guardPermission("combustibles:tae_import", FUEL_PATHS.fuentes)
  if (guard.error) return guard.error
  if (formData.get("confirmation") !== "IMPORTAR") return { ok: false, message: "Debes confirmar que revisaste el reporte de mapeo" }
  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Selecciona el archivo Excel del histórico de sellos" }
  if (file.size > MAX_IMPORT_FILE_BYTES) return { ok: false, message: "El archivo supera el máximo de 20 MB" }
  try {
    const manualMappings = parseManualMappings(formData.get("manualMappings"))
    const scope = resolveWorksiteScope(guard.session)
    const result = await importTaeLegacyWorkbook({
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      userId: guard.session.user.id,
      allowedWorksiteIds: scope.mode === "all" ? undefined : new Set(scope.mode === "some" ? scope.ids : []),
      manualMappings,
    })
    // `revalidateFuel()` invalida todo `/combustibles`, también la pantalla donde vive este formulario
    // (`/fuentes/agregar/sellos`) y la ficha del archivo recién creado. Es seguro desde que la plataforma ya no
    // se vuelve a montar entera en cada revalidación (hasta 2026-09-24 `AppShell` se exportaba como objeto memo y
    // el resumen de importación se perdía; ver `confirmOperationsImportAction` en actions-operaciones.ts).
    revalidateFuel()
    return { ok: true as const, data: result, message: `${result.importedRows} cargas históricas importadas` }
  } catch (error) {
    logger.error("[importTaeHistoryAction]", error)
    const msg = error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : safeActionMessage(error, "No se pudo importar el histórico de sellos")
    return { ok: false, message: msg }
  }
}

export async function revertTaeImportBatchAction(batchId: string) {
  const guard = await guardPermission("combustibles:tae_import", FUEL_PATHS.fuentes)
  if (guard.error) return guard.error
  if (!can(guard.session, "combustibles:revert")) {
    return { ok: false as const, message: "No tienes permiso para revertir lotes" }
  }
  if (!batchId) return { ok: false as const, message: "Lote requerido" }

  try {
    const result = await db.transaction(async (tx) => {
      const scope = resolveWorksiteScope(guard.session)
      const [batch] = await tx
        .update(fuelTaeImportBatches)
        .set({ status: "reverted", updatedAt: new Date().toISOString() })
        .where(and(eq(fuelTaeImportBatches.id, batchId), eq(fuelTaeImportBatches.status, "imported")))
        .returning()

      if (!batch) {
        if (scope.mode !== "all") throw new Error("Lote no encontrado o fuera de alcance")
        const existing = await tx.query.fuelTaeImportBatches.findFirst({
          where: eq(fuelTaeImportBatches.id, batchId),
          columns: { status: true },
        })
        if (!existing) throw new Error("Lote no encontrado")
        throw new Error("Este lote ya fue revertido")
      }

      // Rev. 2026-11-05 (2.4/2.6): los movimientos de sello ya no se borran sin
      // más. Se archivan (`reverted_at/by/reason`, migración del carril E) para
      // que el retiro/instalación del lote quede en el historial del sello; si la
      // FK de la base todavía no permite sobrevivir al borrado de la carga
      // (hoy es NO ACTION), se retiran después de archivarlos, que es lo que
      // hacía antes este bloque.
      const submissions = await tx
        .select({
          id: fuelTaeSubmissions.id,
          worksiteId: fuelTaeSubmissions.worksiteId,
          vehicleId: fuelTaeSubmissions.vehicleId,
          loadedAt: fuelTaeSubmissions.loadedAt,
        })
        .from(fuelTaeSubmissions)
        .where(eq(fuelTaeSubmissions.importBatchId, batchId))
        .for("update")

      if (scope.mode !== "all") {
        const allowed = new Set(scope.mode === "some" ? scope.ids : [])
        if (submissions.length === 0 || submissions.some((submission) => !allowed.has(submission.worksiteId))) {
          throw new Error("Lote no encontrado o fuera de alcance")
        }
      }

      const submissionIds = submissions.map((submission) => submission.id)
      const now = new Date().toISOString()
      const reason = `Reversa del lote de importación histórica TAE (${batchId})`

      const archivedSealMovements = await retractSealMovements(tx, submissionIds, {
        userId: guard.session.user.id,
        reason,
        now,
      })
      // Los movimientos archivados sobreviven al borrado de su carga: la FK
      // `ON DELETE SET NULL` de la 0373 deja `submission_id` en NULL y conserva
      // la fila (con su `evidence_sha256`) para el historial del sello.

      // Pedidos de revisión abiertos sobre estas cargas: sin cerrarlos quedan
      // apuntando a ids que dejan de existir (`fuel_review_marks.entity_id` no
      // tiene FK) y la bandeja «Por revisar» los muestra para siempre.
      const closedReviewMarks = submissionIds.length > 0
        ? await tx.update(fuelReviewMarks)
            .set({
              status: "withdrawn",
              resolvedBy: guard.session.user.id,
              resolvedAt: now,
              resolutionNote: `Retirado automáticamente: el lote de origen (${batchId}) fue revertido.`,
            })
            .where(and(
              eq(fuelReviewMarks.entityType, "fuel_tae_submission"),
              inArray(fuelReviewMarks.entityId, submissionIds),
              eq(fuelReviewMarks.status, "open"),
            ))
            .returning({ id: fuelReviewMarks.id })
        : []

      // Casos de anomalía abiertos de estas cargas, con el mismo patrón que la
      // reversa del log operacional (`actions-operaciones-batch.ts`): se
      // descartan, no se borran — y no se pisa un caso que un humano ya cerró.
      const dismissedAnomalyCases = submissionIds.length > 0
        ? await tx.update(fuelAnomalyCases)
            .set({
              status: "dismissed",
              resolution: `Descartado automáticamente: el lote de origen (${batchId}) fue revertido.`,
              resolvedById: guard.session.user.id,
              resolvedAt: now,
              updatedAt: now,
            })
            .where(and(
              eq(fuelAnomalyCases.referenceEntityType, "fuel_tae_submission"),
              inArray(fuelAnomalyCases.referenceEntityId, submissionIds),
              inArray(fuelAnomalyCases.status, ["open", "in_review", "reopened"]),
            ))
            .returning({ id: fuelAnomalyCases.id })
        : []

      if (archivedSealMovements.length > 0 && false) {
        // La FK `ON DELETE SET NULL` (migración 0373) deja que el movimiento
        // archivado sobreviva a su carga: no hace falta borrarlo.
        await tx.delete(fuelSealMovements).where(inArray(fuelSealMovements.id, archivedSealMovements))
      }

      if (archivedSealMovements.length > 0 && false) {
        // La FK `ON DELETE SET NULL` (migración 0373) deja que el movimiento
        // archivado sobreviva a su carga: no hace falta borrarlo.
        await tx.delete(fuelSealMovements).where(inArray(fuelSealMovements.id, archivedSealMovements))
      }

      if (archivedSealMovements.length > 0 && false) {
        // La FK `ON DELETE SET NULL` (migración 0373) deja que el movimiento
        // archivado sobreviva a su carga: no hace falta borrarlo.
        await tx.delete(fuelSealMovements).where(inArray(fuelSealMovements.id, archivedSealMovements))
      }

      if (archivedSealMovements.length > 0 && false) {
        // La FK `ON DELETE SET NULL` (migración 0373) deja que el movimiento
        // archivado sobreviva a su carga: no hace falta borrarlo.
        await tx.delete(fuelSealMovements).where(inArray(fuelSealMovements.id, archivedSealMovements))
      }

      const removed = await tx
        .delete(fuelTaeSubmissions)
        .where(eq(fuelTaeSubmissions.importBatchId, batchId))
        .returning({ id: fuelTaeSubmissions.id })

      // Las cargas proyectadas se van con ON DELETE CASCADE, pero el rendimiento
      // de los equipos afectados se calculó con ellas: se recalcula su serie.
      const affectedVehicleIds = [...new Set(submissions.map((submission) => submission.vehicleId).filter((id): id is string => id != null))]
      for (const vehicleId of affectedVehicleIds) await recomputeVehicleSeries(tx, vehicleId)

      // Y la cadena de sellos de la primera carga posterior de cada equipo se
      // calculó contra una carga que ya no existe: se reevalúa (2.6/4.9).
      const lastLoadedAtByVehicle = new Map<string, string>()
      for (const submission of submissions) {
        if (!submission.vehicleId) continue
        const current = lastLoadedAtByVehicle.get(submission.vehicleId)
        if (!current || submission.loadedAt > current) lastLoadedAtByVehicle.set(submission.vehicleId, submission.loadedAt)
      }
      for (const [vehicleId, loadedAt] of lastLoadedAtByVehicle) {
        await reevaluateSealChainOfNextLoad(tx, { vehicleId, afterLoadedAt: loadedAt, actorId: guard.session.user.id, reason })
      }

      await recordAudit({
        userId: guard.session.user.id,
        userEmail: guard.session.user.email ?? undefined,
        action: "delete",
        entityType: "fuel_tae_import_batch",
        entityId: batchId,
        oldState: { status: "imported", submissions: removed.length },
        newState: {
          status: "reverted",
          submissions: 0,
          sealMovementsArchived: archivedSealMovements.length,
          reviewMarksClosed: closedReviewMarks.length,
          anomalyCasesDismissed: dismissedAnomalyCases.length,
        },
        reason: "Reversa de importación histórica TAE",
      }, tx)
      await recordStatusChange({
        entityType: "fuel_tae_import_batch",
        entityId: batchId,
        fromStatus: "imported",
        toStatus: "reverted",
        changedBy: guard.session.user.id,
        reason: `Reversa transaccional de ${removed.length} cargas`,
      }, tx)

      return { removed: removed.length }
    })

    revalidateFuel()
    return { ok: true as const, message: `Archivo revertido: ${result.removed} cargas eliminadas`, data: result }
  } catch (error) {
    logger.error("[revertTaeImportBatchAction]", error)
    const msg = error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : safeActionMessage(error, "No se pudo revertir el archivo")
    return { ok: false as const, message: msg }
  }
}

export async function reprocessTaeImportBatchAction(batchId: string) {
  const guard = await guardPermission("combustibles:tae_import", FUEL_PATHS.fuentes)
  if (guard.error) return guard.error
  if (!batchId) return { ok: false as const, message: "Lote requerido" }

  try {
    const scope = resolveWorksiteScope(guard.session)
    const result = await reprocessTaeImportRejectedRows({
      batchId,
      userId: guard.session.user.id,
      allowedWorksiteIds: scope.mode === "all" ? undefined : new Set(scope.mode === "some" ? scope.ids : []),
    })
    revalidateFuel()
    return { ok: true as const, data: result, message: result.reprocessedRows ? `Se reprocesaron ${result.reprocessedRows} filas rechazadas` : "No hubo filas rechazadas listas para reprocesar" }
  } catch (error) {
    logger.error("[reprocessTaeImportBatchAction]", error)
    const msg = error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : safeActionMessage(error, "No se pudieron reprocesar las filas")
    return { ok: false as const, message: msg }
  }
}

/**
 * Guarda la decisión manual de a qué equipo del catálogo corresponde un código
 * histórico ambiguo en una faena. `vehicleId: null` es una decisión válida —
 * "revisado, sin equivalente" — y evita que el próximo reimport vuelva a
 * marcarlo como observado por el mismo motivo.
 */
export async function saveTaeVehicleMappingAction(input: { worksiteId: string; legacyCode: string; vehicleId: string | null }) {
  const guard = await guardPermission("combustibles:tae_import", FUEL_PATHS.fuentes)
  if (guard.error) return guard.error
  if (!canAccessWorksite(guard.session, input.worksiteId)) return { ok: false, message: "No tienes acceso a esta faena" }
  const legacyCode = input.legacyCode.trim()
  if (!legacyCode) return { ok: false, message: "Código histórico requerido" }
  if (input.vehicleId) {
    const vehicle = await db.query.fuelVehicles.findFirst({ where: eq(fuelVehicles.id, input.vehicleId), columns: { worksiteId: true } })
    if (!vehicle || vehicle.worksiteId !== input.worksiteId) return { ok: false, message: "El equipo no pertenece a esta faena" }
  }
  await db.insert(fuelTaeVehicleMappings)
    .values({ id: nanoid(), worksiteId: input.worksiteId, legacyCode, vehicleId: input.vehicleId, decidedBy: guard.session.user.id })
    .onConflictDoUpdate({ target: [fuelTaeVehicleMappings.worksiteId, fuelTaeVehicleMappings.legacyCode], set: { vehicleId: input.vehicleId, decidedBy: guard.session.user.id, decidedAt: new Date().toISOString() } })
  await recordAudit({ userId: guard.session.user.id, userEmail: guard.session.user.email ?? undefined, action: "update", entityType: "fuel_tae_vehicle_mapping", entityId: `${input.worksiteId}:${legacyCode}`, newState: { vehicleId: input.vehicleId } })
  revalidateFuel()
  return { ok: true, message: input.vehicleId ? "Equipo asignado para futuras importaciones" : "Marcado sin equivalente" }
}

export async function saveTaeWorkerMappingAction(input: { worksiteId: string; role: "driver" | "supervisor"; legacyName: string; workerId: string | null }) {
  const guard = await guardPermission("combustibles:tae_import", FUEL_PATHS.fuentes)
  if (guard.error) return guard.error
  if (!canAccessWorksite(guard.session, input.worksiteId)) return { ok: false, message: "No tienes acceso a esta faena" }
  const legacyName = input.legacyName.trim()
  if (!legacyName) return { ok: false, message: "Nombre histórico requerido" }
  if (input.workerId) {
    const worker = await db.query.workers.findFirst({ where: eq(workers.id, input.workerId), columns: { worksiteId: true } })
    if (!worker || worker.worksiteId !== input.worksiteId) return { ok: false, message: "La persona no pertenece a esta faena" }
  }
  await db.insert(fuelTaeWorkerMappings)
    .values({ id: nanoid(), worksiteId: input.worksiteId, role: input.role, legacyName, workerId: input.workerId, decidedBy: guard.session.user.id })
    .onConflictDoUpdate({ target: [fuelTaeWorkerMappings.worksiteId, fuelTaeWorkerMappings.role, fuelTaeWorkerMappings.legacyName], set: { workerId: input.workerId, decidedBy: guard.session.user.id, decidedAt: new Date().toISOString() } })
  await recordAudit({ userId: guard.session.user.id, userEmail: guard.session.user.email ?? undefined, action: "update", entityType: "fuel_tae_worker_mapping", entityId: `${input.worksiteId}:${input.role}:${legacyName}`, newState: { workerId: input.workerId } })
  revalidateFuel()
  return { ok: true, message: input.workerId ? "Persona asignada para futuras importaciones" : "Marcado sin equivalente" }
}
