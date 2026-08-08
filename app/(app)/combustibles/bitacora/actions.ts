"use server"

import { eq, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelLoads,
  fuelOperationRecords,
  fuelTaeSubmissions,
  worksites,
} from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import {
  getUserIdsWithPermissionForWorksite,
  notifyAfterCommit,
  notifyManyUser,
} from "@/lib/services/notifications"
import { getFuelLogExportRows, getFuelLogRowsBySelection, FUEL_LOG_SOURCE_LABEL, fuelLogEntityType, type FuelLogFilters, type FuelLogRow, type FuelLogSource } from "@/lib/combustibles/fuel-log"
import { addExportMetadataSheet } from "@/lib/combustibles/xlsx-utils"

/** Resuelve el worksiteId y un label descriptivo para una entidad de la bitácora.
 *  Exportada: también la usa el historial de auditoría para acotar por faena. */
export async function resolveEntityWorksite(
  entityType: string,
  entityId: string,
): Promise<{ worksiteId: string; worksiteName: string | null; label: string } | null> {
  if (entityType === "fuel_tae_submission") {
    const row = await db.query.fuelTaeSubmissions.findFirst({
      where: eq(fuelTaeSubmissions.id, entityId),
      columns: { worksiteId: true, equipmentCodeSnapshot: true, plateSnapshot: true, liters: true },
    })
    if (!row) return null
    const ws = await db.query.worksites.findFirst({
      where: eq(worksites.id, row.worksiteId),
      columns: { name: true },
    })
    return {
      worksiteId: row.worksiteId,
      worksiteName: ws?.name ?? null,
      label: `${row.equipmentCodeSnapshot ?? row.plateSnapshot} · ${Number(row.liters).toLocaleString("es-CL")} L`,
    }
  }
  if (entityType === "fuel_load") {
    const row = await db.query.fuelLoads.findFirst({
      where: eq(fuelLoads.id, entityId),
      columns: { worksiteId: true, liters: true },
      with: { vehicle: { columns: { code: true, plate: true } } },
    })
    if (!row) return null
    const ws = await db.query.worksites.findFirst({
      where: eq(worksites.id, row.worksiteId),
      columns: { name: true },
    })
    const vehicleLabel = row.vehicle ? (row.vehicle.code ?? row.vehicle.plate) : "—"
    return {
      worksiteId: row.worksiteId,
      worksiteName: ws?.name ?? null,
      label: `${vehicleLabel} · ${Number(row.liters).toLocaleString("es-CL")} L`,
    }
  }
  if (entityType === "fuel_operation_record") {
    const row = await db.query.fuelOperationRecords.findFirst({
      where: eq(fuelOperationRecords.id, entityId),
      columns: { worksiteId: true, plate: true, code: true, liters: true },
    })
    if (!row?.worksiteId) return null
    const ws = await db.query.worksites.findFirst({
      where: eq(worksites.id, row.worksiteId),
      columns: { name: true },
    })
    return {
      worksiteId: row.worksiteId,
      worksiteName: ws?.name ?? null,
      label: `${row.code ?? row.plate} · ${Number(row.liters).toLocaleString("es-CL")} L`,
    }
  }
  return null
}

/**
 * Agrega o quita una marca de revisión en una fila de la bitácora.
 * Si ya existe una marca con esa `entityType`+`entityId`, se elimina; si no, se crea.
 */
export async function toggleReviewMarkAction(source: FuelLogSource, entityId: string) {
  let session
  try { session = await requirePermission("combustibles:view") }
  catch { return { ok: false as const, message: "Sin permisos" } }

  const entityType = fuelLogEntityType(source)

  // `combustibles:view` no acota por faena: sin esto, cualquier usuario con
  // el permiso podía marcar/desmarcar (y disparar la notificación de) un
  // registro de una faena fuera de su alcance con sólo conocer su id.
  const entityCtx = await resolveEntityWorksite(entityType, entityId)
  if (!entityCtx) return { ok: false as const, message: "Registro no encontrado" }
  if (!canAccessWorksite(session, entityCtx.worksiteId)) return { ok: false as const, message: "No tienes acceso a esta faena" }

  // Buscar si existe una marca para esta entidad
  const [existingRow] = await db.execute(sql`
    select id from fuel_review_marks
    where entity_type = ${entityType} and entity_id = ${entityId}
    limit 1
  `)

  if (existingRow && (existingRow as { id: string }).id) {
    // Ya existe → eliminar (toggle off)
    await db.execute(sql`
      delete from fuel_review_marks
      where entity_type = ${entityType} and entity_id = ${entityId}
    `)
    await recordAudit({
      userId: session.user.id, userEmail: session.user.email ?? undefined,
      action: "delete", entityType, entityId,
    })
    return { ok: true as const, marked: false as const }
  }

  // No existe → insertar (toggle on)
  const id = nanoid()
  await db.execute(sql`
    insert into fuel_review_marks (id, entity_type, entity_id, marked_by, created_at)
    values (${id}, ${entityType}, ${entityId}, ${session.user.id}, now())
  `)
  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined,
    action: "create", entityType, entityId,
  })

  // Notificar al responsable de la faena cuando se marca un registro
  // (ya resuelto arriba para el chequeo de alcance — se reutiliza).
  notifyAfterCommit(async () => {
    try {
      const targetIds = await getUserIdsWithPermissionForWorksite("combustibles:tae_review", entityCtx.worksiteId)
      if (targetIds.length === 0) return

      await notifyManyUser(targetIds, {
        type: "system_alert",
        title: "Registro marcado para revisión",
        body: `${entityCtx.label} · ${entityCtx.worksiteName ?? "Faena sin nombre"}`,
        entityType,
        entityId,
        entityHref: `/combustibles/bitacora`,
        dedupeKey: `review-mark:${entityId}`,
      })
    } catch (err) {
      logger.error("[review-mark] notification failed", err)
    }
  })

  return { ok: true as const, marked: true as const, markId: id }
}

async function buildWorkbook(rows: FuelLogRow[]) {
  const ExcelJS = await import("exceljs")
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Bitácora general")
  ws.columns = [
    { header: "Fecha y hora", key: "occurredAt", width: 20 },
    { header: "Fuente", key: "source", width: 16 },
    { header: "Faena", key: "worksiteName", width: 20 },
    { header: "Proveedor", key: "supplierName", width: 18 },
    { header: "Lugar de carga", key: "loadingPointName", width: 20 },
    { header: "Código equipo", key: "equipmentCode", width: 14 },
    { header: "Patente", key: "plate", width: 12 },
    { header: "Tipo de equipo", key: "equipmentTypeName", width: 16 },
    { header: "Conductor", key: "driverName", width: 20 },
    { header: "Supervisor", key: "supervisorName", width: 20 },
    { header: "Producto", key: "productName", width: 16 },
    { header: "Litros", key: "liters", width: 12 },
    { header: "Medidor", key: "meterReading", width: 12 },
    { header: "Tipo medidor", key: "meterLabel", width: 14 },
    { header: "Rendimiento", key: "performanceValue", width: 12 },
    { header: "Unidad rendimiento", key: "performanceUnit", width: 14 },
    { header: "Sello retirado", key: "sealRemoved", width: 14 },
    { header: "Sello instalado", key: "sealInstalled", width: 14 },
    { header: "Evidencias", key: "evidenceCount", width: 12 },
    { header: "Marcado revisión", key: "reviewMark", width: 14 },
    { header: "Nota de revisión", key: "reviewMarkNotes", width: 24 },
    { header: "Observaciones", key: "notes", width: 30 },
    { header: "Estado", key: "statusLabel", width: 14 },
    { header: "Creado por", key: "createdByName", width: 18 },
    { header: "Modificado por", key: "updatedByName", width: 18 },
    { header: "Creado", key: "createdAt", width: 20 },
    { header: "Modificado", key: "updatedAt", width: 20 },
  ]
  ws.getRow(1).font = { bold: true }
  for (const row of rows) {
    ws.addRow({
      ...row,
      source: FUEL_LOG_SOURCE_LABEL[row.source],
      liters: Number(row.liters),
      meterReading: row.meterReading == null ? null : Number(row.meterReading),
      performanceValue: row.performanceValue == null ? null : Number(row.performanceValue),
    })
  }
  return wb
}

function exportFileName(prefix: string) {
  return `${prefix}_${new Date().toISOString().slice(0, 10)}.xlsx`
}

export async function exportFuelLogAction(filters: FuelLogFilters) {
  let session
  try { session = await requirePermission("combustibles:export") }
  catch { return { ok: false as const, message: "Sin permisos para exportar" } }

  const { rows, truncated } = await getFuelLogExportRows(session, filters)
  const wb = await buildWorkbook(rows)
  addExportMetadataSheet(wb, session, { filters, rowCount: rows.length, from: filters.from, to: filters.to })
  const buffer = await wb.xlsx.writeBuffer()
  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined, action: "export",
    entityType: "fuel_log_export", entityId: nanoid(),
    newState: { rowCount: rows.length, truncated, filters: filters as Record<string, unknown> },
  })
  return {
    ok: true as const,
    data: {
      base64: Buffer.from(buffer).toString("base64"),
      filename: exportFileName("bitacora_combustible"),
      truncated,
    },
  }
}

export async function exportFuelLogSelectionAction(selection: Array<{ source: FuelLogSource; id: string }>) {
  let session
  try { session = await requirePermission("combustibles:export") }
  catch { return { ok: false as const, message: "Sin permisos para exportar" } }
  if (!selection.length) return { ok: false as const, message: "No hay filas seleccionadas" }

  const rows = await getFuelLogRowsBySelection(session, selection)
  const wb = await buildWorkbook(rows)
  addExportMetadataSheet(wb, session, { rowCount: rows.length })
  const buffer = await wb.xlsx.writeBuffer()
  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined, action: "export",
    entityType: "fuel_log_export", entityId: nanoid(),
    newState: { rowCount: rows.length, selectionCount: selection.length },
  })
  return {
    ok: true as const,
    data: {
      base64: Buffer.from(buffer).toString("base64"),
      filename: exportFileName("bitacora_seleccion"),
      truncated: false,
    },
  }
}
