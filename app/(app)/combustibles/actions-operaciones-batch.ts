"use server"

import { revalidatePath } from "next/cache"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { fuelAnomalyCases, fuelOperationBatches, fuelOperationRecords, fuelVehicles, worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { isGlobalRole } from "@/lib/auth/scope"
import { recordAudit } from "@/lib/audit"
import { auditResetDecisions } from "@/lib/combustibles/projection-audit"
import { projectOperationRecords, removeProjectionsForOperationBatch } from "@/lib/combustibles/control/projection"
import { requireGlobalImportSession } from "@/lib/combustibles/operations-import-shared"
import type { ActionState } from "@/lib/validation/masters"

export async function revertBatchOperationsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requireGlobalImportSession("combustibles:revert") }
  catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Sin permisos" } }

  const batchId = String(formData.get("batchId") ?? "")
  if (!batchId) return { ok: false, message: "Lote requerido" }

  const batch = await db.query.fuelOperationBatches.findFirst({ where: eq(fuelOperationBatches.id, batchId) })
  if (!batch) return { ok: false, message: "Lote no encontrado" }
  if (batch.estado === "revertido") return { ok: false, message: "Este lote ya fue revertido" }

  await db.transaction(async (tx) => {
    // Primero la serie canónica: `removeProjectionsForOperationBatch` ubica las
    // cargas proyectadas por su registro de origen y recalcula el rendimiento de
    // los equipos afectados, así que tiene que correr antes de borrar los
    // registros.
    await removeProjectionsForOperationBatch(tx, batchId)
    // Capturar los ids ANTES de borrar: `fuel_anomaly_cases.reference_entity_id`
    // es una referencia polimórfica sin FK (apunta a cualquiera de varias
    // tablas), así que borrar estas filas no falla — deja los casos abiertos
    // apuntando a un `fuel_operation_record` que ya no existe, invisibles pero
    // eternamente "activos" en /combustibles/anomalias.
    const deletedRows = await tx.delete(fuelOperationRecords)
      .where(eq(fuelOperationRecords.batchId, batchId))
      .returning({ id: fuelOperationRecords.id })
    if (deletedRows.length > 0) {
      const deletedIds = deletedRows.map((r) => r.id)
      const now = new Date().toISOString()
      await tx.update(fuelAnomalyCases).set({
        status: "dismissed",
        resolution: `Descartado automáticamente: el lote de origen (${batchId}) fue revertido.`,
        resolvedById: session.user.id,
        resolvedAt: now,
        updatedAt: now,
      }).where(and(
        eq(fuelAnomalyCases.referenceEntityType, "fuel_operation_record"),
        inArray(fuelAnomalyCases.referenceEntityId, deletedIds),
        // No pisar un caso que un humano ya cerró — sólo los que seguían abiertos.
        inArray(fuelAnomalyCases.status, ["open", "in_review", "reopened"]),
      ))
    }
    await tx.update(fuelOperationBatches).set({ estado: "revertido", updatedAt: new Date().toISOString() }).where(eq(fuelOperationBatches.id, batchId))
  })

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "delete",
    entityType: "fuel_operation_batch",
    entityId: batchId,
    oldState: { estado: batch.estado },
    newState: { estado: "revertido" },
  })

  revalidatePath("/combustibles")
  revalidatePath("/combustibles/importar")
  revalidatePath(`/combustibles/importar/operaciones/${batchId}`)
  return { ok: true, message: "Lote revertido: sus registros fueron eliminados del dashboard" }
}

export async function linkOperationVehicleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_vehicles", "/combustibles/importar") }
  catch { return { ok: false, message: "Sin permisos" } }
  // Los lotes de operaciones son multi-faena: se restringe a roles globales,
  // igual que el resto del flujo (import/preview/confirm/revert/detalle). Sin
  // esto, un rol scoped con manage_vehicles podría vincular registros de
  // faenas que no puede ver invocando la action directamente.
  if (!isGlobalRole(session)) return { ok: false, message: "Requiere acceso global a todas las faenas" }

  const batchId = String(formData.get("batchId") ?? "")
  const plate = String(formData.get("plate") ?? "").trim().toUpperCase()
  const vehicleId = String(formData.get("vehicleId") ?? "")
  if (!batchId || !plate || !vehicleId) return { ok: false, message: "Datos incompletos" }

  const vehicle = await db.query.fuelVehicles.findFirst({ where: eq(fuelVehicles.id, vehicleId) })
  if (!vehicle) return { ok: false, message: "Vehículo no encontrado" }

  // Vincular cambia a qué equipo pertenece la carga: la serie canónica se
  // reproyecta en la misma transacción para que el rendimiento siga al vínculo.
  const updated = await db.transaction(async (tx) => {
    const rows = await tx.update(fuelOperationRecords)
      .set({ vehicleId })
      .where(and(eq(fuelOperationRecords.batchId, batchId), eq(fuelOperationRecords.plate, plate)))
      .returning({ id: fuelOperationRecords.id })
    if (rows.length > 0) {
      const projection = await projectOperationRecords(tx, rows.map((row) => row.id))
      await auditResetDecisions(tx, projection.resetLoadIds, { userId: session.user.id, userEmail: session.user.email ?? undefined }, null)
    }
    return rows
  })

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "update",
    entityType: "fuel_operation_record",
    entityId: batchId,
    newState: { plate, vehicleId, count: updated.length },
  })

  revalidatePath(`/combustibles/importar/operaciones/${batchId}`)
  revalidatePath("/combustibles")
  return { ok: true, message: `${updated.length} registro(s) vinculados a la patente ${vehicle.plate}` }
}

export async function linkOperationWorksiteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_vehicles", "/combustibles/importar") }
  catch { return { ok: false, message: "Sin permisos" } }
  // Lote multi-faena: restringido a roles globales (ver linkOperationVehicleAction).
  if (!isGlobalRole(session)) return { ok: false, message: "Requiere acceso global a todas las faenas" }

  const batchId = String(formData.get("batchId") ?? "")
  const faenaNombre = String(formData.get("faenaNombre") ?? "")
  const worksiteId = String(formData.get("worksiteId") ?? "")
  if (!batchId || !faenaNombre || !worksiteId) return { ok: false, message: "Datos incompletos" }

  const worksite = await db.query.worksites.findFirst({ where: eq(worksites.id, worksiteId) })
  if (!worksite) return { ok: false, message: "Faena no encontrada" }

  const updated = await db.transaction(async (tx) => {
    const rows = await tx.update(fuelOperationRecords)
      .set({ worksiteId })
      .where(and(eq(fuelOperationRecords.batchId, batchId), eq(fuelOperationRecords.faenaNombre, faenaNombre)))
      .returning({ id: fuelOperationRecords.id })
    if (rows.length > 0) {
      const projection = await projectOperationRecords(tx, rows.map((row) => row.id))
      await auditResetDecisions(tx, projection.resetLoadIds, { userId: session.user.id, userEmail: session.user.email ?? undefined }, worksiteId)
    }
    return rows
  })

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "update",
    entityType: "fuel_operation_record",
    entityId: batchId,
    newState: { faenaNombre, worksiteId, count: updated.length },
  })

  revalidatePath(`/combustibles/importar/operaciones/${batchId}`)
  revalidatePath("/combustibles")
  return { ok: true, message: `${updated.length} registro(s) vinculados a la faena ${worksite.name}` }
}
