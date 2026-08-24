"use server"

import { desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelProviderRejections, fuelProviderTransactions } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { todayInChile } from "@/lib/utils"
import { addExportMetadataSheet } from "@/lib/combustibles/xlsx-utils"
import { buildFuelProviderQualityWorkbook, type FuelProviderQualityExportRow } from "@/lib/combustibles/fuel-provider-quality-export"

const MAX_EXPORT_ROWS = 10_000

/** Exporta sólo el estado operativo; nunca incluye el payload crudo del portal. */
export async function exportFuelProviderQualityAction() {
  let session
  try { session = await requirePermission("combustibles:export", "/combustibles/importar") }
  catch { return { ok: false as const, message: "Sin permisos para exportar calidad de integración" } }

  const [pending, rejections] = await Promise.all([
    db.query.fuelProviderTransactions.findMany({
      where: eq(fuelProviderTransactions.status, "pending"),
      orderBy: [desc(fuelProviderTransactions.updatedAt)],
      limit: MAX_EXPORT_ROWS + 1,
    }),
    db.query.fuelProviderRejections.findMany({
      where: eq(fuelProviderRejections.status, "open"),
      orderBy: [desc(fuelProviderRejections.createdAt)],
      limit: MAX_EXPORT_ROWS + 1,
    }),
  ])

  const rows: FuelProviderQualityExportRow[] = [
    ...pending.map((row) => ({
      tipo: "pendiente" as const,
      proveedor: row.provider,
      cuenta: row.sourceAccount,
      identidad: row.identityKey,
      codigo: row.resolutionCode ?? "pending",
      motivo: row.resolutionMessage ?? "La fila requiere revisión",
      producto: row.sourceProduct ?? "",
      patente: row.sourcePlate ?? "",
      fecha: row.occurredAt ?? "",
      litros: row.quantity == null ? null : Number(row.quantity),
      monto: row.amount == null ? null : Number(row.amount),
    })),
    ...rejections.map((row) => ({
      tipo: "rechazo" as const,
      proveedor: row.provider,
      cuenta: row.sourceAccount,
      identidad: row.sourceRowKey,
      codigo: row.code,
      motivo: row.message,
      producto: row.sourceProduct ?? "",
      patente: row.sourcePlate ?? "",
      fecha: row.occurredAt ?? "",
      litros: row.quantity == null ? null : Number(row.quantity),
      monto: row.amount == null ? null : Number(row.amount),
    })),
  ]
  const truncated = rows.length > MAX_EXPORT_ROWS
  const exportRows = truncated ? rows.slice(0, MAX_EXPORT_ROWS) : rows
  const workbook = await buildFuelProviderQualityWorkbook(exportRows)
  addExportMetadataSheet(workbook, session, { rowCount: exportRows.length })
  const buffer = await workbook.xlsx.writeBuffer()
  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "export",
    entityType: "fuel_provider_quality_export",
    entityId: nanoid(),
    newState: { rowCount: exportRows.length, truncated },
  })
  return {
    ok: true as const,
    data: {
      base64: Buffer.from(buffer).toString("base64"),
      filename: `calidad_integraciones_combustible_${todayInChile()}.xlsx`,
      truncated,
      rowLimit: MAX_EXPORT_ROWS,
    },
  }
}
