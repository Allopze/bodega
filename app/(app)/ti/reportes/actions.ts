"use server"

import { db } from "@/db"
import {
  itAssets, itAssetTypes, workers, worksites, suppliers, itMaintenances,
  itAssetHistory,
} from "@/db/schema"
import { eq, asc, and, isNull, sql, type SQL } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { buildXlsxBuffer } from "@/lib/reports/export-module/excel-builder"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { todayInChile } from "@/lib/utils"
import type { ExportActionResult } from "@/components/ui/export-button"
import { IT_ASSET_STATUS_META } from "@/lib/services/ti/constants"
import { civilDaysUntil } from "@/lib/services/ti/civil-dates"

export type TiReportType =
  | "inventario_general"
  | "inventario_faena"
  | "equipos_trabajador"
  | "disponibles"
  | "reparacion"
  | "historial_activo"
  | "costo_reparacion"
  | "antiguedad"
  | "garantias"

const TYPE_LABELS: Record<TiReportType, string> = {
  inventario_general: "inventario-general",
  inventario_faena: "inventario-por-faena",
  equipos_trabajador: "equipos-por-trabajador",
  disponibles: "equipos-disponibles",
  reparacion: "equipos-en-reparacion",
  historial_activo: "historial-activo",
  costo_reparacion: "costo-reparacion",
  antiguedad: "antiguedad",
  garantias: "garantias",
}

function assetName(brand: string | null, model: string | null): string {
  return [brand, model].filter(Boolean).join(" ") || "—"
}

async function baseAssetRows(scope?: SQL, where?: SQL) {
  const conditions: SQL[] = [isNull(itAssets.deletedAt)]
  if (scope) conditions.push(scope)
  if (where) conditions.push(where)
  return db
    .select({
      code: itAssets.code,
      type: itAssetTypes.name,
      brand: itAssets.brand,
      model: itAssets.model,
      serialNumber: itAssets.serialNumber,
      status: itAssets.status,
      workerName: sql<string>`trim(concat(${workers.firstName}, ' ', ${workers.lastName}))`,
      worksiteName: worksites.name,
      location: itAssets.location,
      purchaseDate: itAssets.purchaseDate,
      supplierName: suppliers.name,
      cost: itAssets.cost,
      warrantyEndDate: itAssets.warrantyEndDate,
    })
    .from(itAssets)
    .innerJoin(itAssetTypes, eq(itAssets.assetTypeId, itAssetTypes.id))
    .leftJoin(workers, eq(itAssets.workerId, workers.id))
    .leftJoin(worksites, eq(itAssets.worksiteId, worksites.id))
    .leftJoin(suppliers, eq(itAssets.supplierId, suppliers.id))
    .where(and(...conditions))
    .orderBy(asc(itAssets.code))
}

function assetSheet(rows: Awaited<ReturnType<typeof baseAssetRows>>, sheetName: string) {
  return {
    worksheetName: sheetName,
    headers: ["Código", "Tipo", "Marca", "Modelo", "Serie", "Estado", "Trabajador", "Faena", "Ubicación", "Fecha compra", "Proveedor", "Costo", "Garantía"],
    rows: rows.map((row) => [
      row.code,
      row.type,
      row.brand ?? "",
      row.model ?? "",
      row.serialNumber ?? "",
      IT_ASSET_STATUS_META[row.status]?.label ?? row.status,
      row.workerName ?? "",
      row.worksiteName ?? "",
      row.location ?? "",
      row.purchaseDate ?? "",
      row.supplierName ?? "",
      row.cost != null ? Number(row.cost) : "",
      row.warrantyEndDate ?? "",
    ]),
  }
}

export async function exportTiReport(type: TiReportType, assetId?: string): Promise<ExportActionResult> {
  let session
  try { session = await requirePermission("ti:export") }
  catch { return { ok: false, message: "Sin permisos para exportar reportes TI" } }

  const scope = worksiteScopeSql(session, itAssets.worksiteId)

  try {
    let sheets: ReturnType<typeof assetSheet>[] = []
    const today = todayInChile()

    switch (type) {
      case "inventario_general": {
        sheets = [assetSheet(await baseAssetRows(scope), "Inventario general")]
        break
      }
      case "inventario_faena": {
        const rows = await baseAssetRows(scope)
        const byWorksite = new Map<string, typeof rows>()
        for (const row of rows) {
          const key = row.worksiteName ?? "Sin faena"
          if (!byWorksite.has(key)) byWorksite.set(key, [])
          byWorksite.get(key)!.push(row)
        }
        sheets = [...byWorksite.entries()].map(([name, wsRows]) => assetSheet(wsRows, name.slice(0, 30)))
        break
      }
      case "equipos_trabajador": {
        const rows = await baseAssetRows(scope, sql`${itAssets.workerId} IS NOT NULL`)
        const byWorker = new Map<string, typeof rows>()
        for (const row of rows) {
          const key = row.workerName ?? "Sin trabajador"
          if (!byWorker.has(key)) byWorker.set(key, [])
          byWorker.get(key)!.push(row)
        }
        sheets = [...byWorker.entries()].map(([name, wsRows]) => assetSheet(wsRows, name.slice(0, 30)))
        break
      }
      case "disponibles": {
        sheets = [assetSheet(await baseAssetRows(scope, eq(itAssets.status, "disponible")), "Disponibles")]
        break
      }
      case "reparacion": {
        sheets = [assetSheet(await baseAssetRows(scope, eq(itAssets.status, "en_reparacion")), "En reparación")]
        break
      }
      case "historial_activo": {
        if (!assetId) return { ok: false, message: "Selecciona un activo para su historial" }
        const [asset] = await db.select({ code: itAssets.code }).from(itAssets)
          .where(and(eq(itAssets.id, assetId), isNull(itAssets.deletedAt), scope))
          .limit(1)
        if (!asset) return { ok: false, message: "Activo no encontrado" }
        const history = await db
          .select({
            action: itAssetHistory.action,
            detail: itAssetHistory.detail,
            createdAt: itAssetHistory.createdAt,
          })
          .from(itAssetHistory)
          .where(eq(itAssetHistory.assetId, assetId))
          .orderBy(asc(itAssetHistory.createdAt))
        sheets = [{
          worksheetName: `Historial ${asset.code}`.slice(0, 30),
          headers: ["Fecha", "Acción", "Detalle"],
          rows: history.map((h) => [h.createdAt.slice(0, 19).replace("T", " "), h.action, h.detail]),
        }]
        break
      }
      case "costo_reparacion": {
        const rows = await db
          .select({
            code: itAssets.code,
            brand: itAssets.brand,
            model: itAssets.model,
            count: sql<number>`count(*)::int`,
            total: sql<number>`coalesce(sum(${itMaintenances.cost}), 0)`,
            last: sql<string | null>`max(${itMaintenances.date})`,
          })
          .from(itMaintenances)
          .innerJoin(itAssets, eq(itMaintenances.assetId, itAssets.id))
          .where(and(isNull(itAssets.deletedAt), scope ?? sql`true`))
          .groupBy(itAssets.code, itAssets.brand, itAssets.model)
          .orderBy(sql`coalesce(sum(${itMaintenances.cost}), 0) DESC`)
        sheets = [{
          worksheetName: "Costo reparación",
          headers: ["Código", "Equipo", "Reparaciones", "Costo acumulado", "Última mantención"],
          rows: rows.map((r) => [r.code, assetName(r.brand, r.model), r.count, Number(r.total), r.last ?? ""]),
        }]
        break
      }
      case "antiguedad": {
        const rows = await db
          .select({
            code: itAssets.code,
            brand: itAssets.brand,
            model: itAssets.model,
            status: itAssets.status,
            purchaseDate: itAssets.purchaseDate,
          })
          .from(itAssets)
          .where(and(isNull(itAssets.deletedAt), scope ?? sql`true`))
          .orderBy(asc(itAssets.purchaseDate))
        sheets = [{
          worksheetName: "Antigüedad",
          headers: ["Código", "Equipo", "Estado", "Fecha compra", "Años de uso"],
          rows: rows.map((r) => {
            const years = r.purchaseDate
              ? Math.round(civilDaysUntil(today, r.purchaseDate) / 365.25 * 10) / 10
              : ""
            return [r.code, assetName(r.brand, r.model), IT_ASSET_STATUS_META[r.status]?.label ?? r.status, r.purchaseDate ?? "", years]
          }),
        }]
        break
      }
      case "garantias": {
        const rows = await db
          .select({
            code: itAssets.code,
            brand: itAssets.brand,
            model: itAssets.model,
            warrantyEndDate: itAssets.warrantyEndDate,
            supplierName: suppliers.name,
            status: itAssets.status,
          })
          .from(itAssets)
          .leftJoin(suppliers, eq(itAssets.supplierId, suppliers.id))
          .where(and(isNull(itAssets.deletedAt), sql`${itAssets.warrantyEndDate} IS NOT NULL`, scope ?? sql`true`))
          .orderBy(asc(itAssets.warrantyEndDate))
        sheets = [{
          worksheetName: "Garantías",
          headers: ["Código", "Equipo", "Vencimiento", "Días restantes", "Proveedor", "Estado"],
          rows: rows.map((r) => {
            const days = r.warrantyEndDate
              ? civilDaysUntil(r.warrantyEndDate, today)
              : ""
            return [r.code, assetName(r.brand, r.model), r.warrantyEndDate ?? "", days, r.supplierName ?? "", IT_ASSET_STATUS_META[r.status]?.label ?? r.status]
          }),
        }]
        break
      }
    }

    if (sheets.length === 0) return { ok: false, message: "Sin datos para exportar" }

    const buffer = await buildXlsxBuffer({
      filenameBase: TYPE_LABELS[type],
      worksheetName: "TI",
      headers: [],
      rows: [],
      sheets,
    })
    const base64 = Buffer.from(buffer).toString("base64")

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "export",
      entityType: "ti_report",
      entityId: type,
      newState: { type, assetId: assetId ?? null },
    })

    return {
      ok: true,
      data: {
        base64,
        filename: `ti-${TYPE_LABELS[type]}-${today}.xlsx`,
      },
    }
  } catch (error) {
    logger.error("[ti:exportReport]", error)
    return { ok: false, message: "Error al generar el reporte" }
  }
}
