"use server"

import { revalidatePath } from "next/cache"
import { and, eq, inArray } from "drizzle-orm"
import { isNetworkError } from "@/lib/network-error"
import { db } from "@/db"
import { fuelSealMovements, fuelTaeImportBatches, fuelTaeSubmissions, fuelTaeVehicleMappings, fuelTaeWorkerMappings, fuelVehicles, workers } from "@/db/schema"
import { can, guardPermission } from "@/lib/auth/can"
import { canAccessWorksite, resolveWorksiteScope } from "@/lib/auth/scope"
import { generateTaeImportDryRunReport, generateTaeImportPreview } from "@/lib/services/fuel-tae"
import { importTaeLegacyWorkbook, reprocessTaeImportRejectedRows, type TaeImportMappingDecision } from "@/lib/combustibles/tae-import-service"
import { nanoid } from "@/lib/id"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { logger } from "@/lib/logger"

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
  const guard = await guardPermission("combustibles:tae_import")
  if (guard.error) return guard.error

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Selecciona el archivo Excel del histórico TAE" }
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
        filename: `tae_reporte_mapeo_${new Date().toISOString().split("T")[0]}.xlsx`,
        preview,
      },
    }
  } catch (error) {
    logger.error("[generateTaeImportReportAction]", error)
    const msg = error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : error instanceof Error ? error.message : "No se pudo generar el reporte"
    return { ok: false, message: msg }
  }
}

export async function importTaeHistoryAction(formData: FormData) {
  const guard = await guardPermission("combustibles:tae_import")
  if (guard.error) return guard.error
  if (formData.get("confirmation") !== "IMPORTAR") return { ok: false, message: "Debes confirmar que revisaste el reporte de mapeo" }
  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Selecciona el archivo Excel del histórico TAE" }
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
    // Rutas HERMANAS, nunca "/combustibles/tae/importar": es la ruta donde
    // vive este mismo formulario (tae-import-report-form.tsx, montado desde
    // tae/importar/page.tsx) — revalidarla remonta el árbol de cliente y
    // borra el resumen de importación antes de que el usuario lo vea (mismo
    // patrón que actions-operaciones.ts:325-333). El detalle del lote recién
    // creado es una ruta que el usuario aún no visitó, así que sí conviene
    // dejarla fresca para cuando navegue a "Ver detalle".
    revalidatePath("/combustibles")
    revalidatePath("/combustibles/tae")
    revalidatePath("/combustibles/tae/importar/historial")
    revalidatePath(`/combustibles/tae/importar/${result.batchId}`)
    return { ok: true as const, data: result, message: `${result.importedRows} cargas históricas importadas` }
  } catch (error) {
    logger.error("[importTaeHistoryAction]", error)
    const msg = error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : error instanceof Error ? error.message : "No se pudo importar el histórico TAE"
    return { ok: false, message: msg }
  }
}

export async function revertTaeImportBatchAction(batchId: string) {
  const guard = await guardPermission("combustibles:tae_import")
  if (guard.error) return guard.error
  if (!can(guard.session, "combustibles:revert")) {
    return { ok: false as const, message: "No tienes permiso para revertir lotes" }
  }
  if (!batchId) return { ok: false as const, message: "Lote requerido" }

  try {
    const result = await db.transaction(async (tx) => {
      const [batch] = await tx
        .update(fuelTaeImportBatches)
        .set({ status: "reverted", updatedAt: new Date().toISOString() })
        .where(and(eq(fuelTaeImportBatches.id, batchId), eq(fuelTaeImportBatches.status, "imported")))
        .returning()

      if (!batch) {
        const existing = await tx.query.fuelTaeImportBatches.findFirst({
          where: eq(fuelTaeImportBatches.id, batchId),
          columns: { status: true },
        })
        if (!existing) throw new Error("Lote no encontrado")
        throw new Error("Este lote ya fue revertido")
      }

      // Borrar primero los movimientos de sello de estas cargas: la FK de
      // fuel_seal_movements.submission_id hoy no tiene ON DELETE CASCADE (el
      // schema.ts ya lo declara así — falta generar y aplicar la migración,
      // pendiente porque el árbol tiene cambios de esquema en curso de otro
      // proceso que no se pueden aislar limpiamente ahora mismo). Sin este
      // borrado explícito, revertir un lote con al menos una carga validada
      // (que es la que inserta el movimiento de sello) fallaba con violación
      // de FK. Una vez aplicada la migración, este borrado queda redundante
      // pero inofensivo — el CASCADE ya lo habría hecho.
      const submissionIds = await tx
        .select({ id: fuelTaeSubmissions.id })
        .from(fuelTaeSubmissions)
        .where(eq(fuelTaeSubmissions.importBatchId, batchId))
      if (submissionIds.length > 0) {
        await tx.delete(fuelSealMovements).where(inArray(fuelSealMovements.submissionId, submissionIds.map((s) => s.id)))
      }

      const removed = await tx
        .delete(fuelTaeSubmissions)
        .where(eq(fuelTaeSubmissions.importBatchId, batchId))
        .returning({ id: fuelTaeSubmissions.id })

      await recordAudit({
        userId: guard.session.user.id,
        userEmail: guard.session.user.email ?? undefined,
        action: "delete",
        entityType: "fuel_tae_import_batch",
        entityId: batchId,
        oldState: { status: "imported", submissions: removed.length },
        newState: { status: "reverted", submissions: 0 },
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

    revalidatePath("/combustibles")
    revalidatePath("/combustibles/tae")
    revalidatePath("/combustibles/tae/importar")
    revalidatePath("/combustibles/tae/importar/historial")
    revalidatePath(`/combustibles/tae/importar/${batchId}`)
    return { ok: true as const, message: `Lote revertido: ${result.removed} cargas eliminadas`, data: result }
  } catch (error) {
    logger.error("[revertTaeImportBatchAction]", error)
    const msg = error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : error instanceof Error ? error.message : "No se pudo revertir el lote"
    return { ok: false as const, message: msg }
  }
}

export async function reprocessTaeImportBatchAction(batchId: string) {
  const guard = await guardPermission("combustibles:tae_import")
  if (guard.error) return guard.error
  if (!batchId) return { ok: false as const, message: "Lote requerido" }

  try {
    const scope = resolveWorksiteScope(guard.session)
    const result = await reprocessTaeImportRejectedRows({
      batchId,
      userId: guard.session.user.id,
      allowedWorksiteIds: scope.mode === "all" ? undefined : new Set(scope.mode === "some" ? scope.ids : []),
    })
    revalidatePath("/combustibles")
    revalidatePath("/combustibles/tae")
    revalidatePath("/combustibles/tae/importar")
    revalidatePath(`/combustibles/tae/importar/${batchId}`)
    return { ok: true as const, data: result, message: result.reprocessedRows ? `Se reprocesaron ${result.reprocessedRows} filas rechazadas` : "No hubo filas rechazadas listas para reprocesar" }
  } catch (error) {
    logger.error("[reprocessTaeImportBatchAction]", error)
    const msg = error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : error instanceof Error ? error.message : "No se pudieron reprocesar las filas"
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
  const guard = await guardPermission("combustibles:tae_import")
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
  revalidatePath("/combustibles/tae/importar/historial")
  return { ok: true, message: input.vehicleId ? "Equipo asignado para futuras importaciones" : "Marcado sin equivalente" }
}

export async function saveTaeWorkerMappingAction(input: { worksiteId: string; role: "driver" | "supervisor"; legacyName: string; workerId: string | null }) {
  const guard = await guardPermission("combustibles:tae_import")
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
  revalidatePath("/combustibles/tae/importar/historial")
  return { ok: true, message: input.workerId ? "Persona asignada para futuras importaciones" : "Marcado sin equivalente" }
}
