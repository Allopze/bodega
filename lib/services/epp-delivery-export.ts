/**
 * EPP delivery history Excel export.
 * Respects RBAC worksite visibility (same pattern as stock-export.ts).
 */

import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  deliveries, deliveryItems,
  products, workers, worksites,
  purchaseRequestItems, purchaseRequests,
} from "@/db/schema"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import { buildXlsxBuffer } from "@/lib/reports/export"
import type { Session } from "next-auth"
import { formatDate, todayInChile} from "@/lib/utils"
import { getProductSizesByIds } from "@/lib/services/product-sizes"

export interface EppDeliveryExportFilters {
  worksiteId?: string
}

/**
 * Build an Excel buffer with EPP delivery history for the authenticated user's scope.
 */
export async function getEppDeliveryExport(
  session: Session | null,
  filters: EppDeliveryExportFilters = {},
  maxRows = 10_000,
): Promise<{ buffer: ArrayBuffer; filename: string; truncated: boolean }> {
  const wsIds = visibleWorksiteIds(session)
  const worksiteScope = isGlobalRole(session)
    ? undefined
    : wsIds.length > 0 ? inArray(deliveries.worksiteId, wsIds) : sql<boolean>`false`

  const worksiteFilter = filters.worksiteId
    ? eq(deliveries.worksiteId, filters.worksiteId)
    : undefined

  const rows = await db
    .select({
      code:          deliveries.code,
      deliveredAt:   deliveries.deliveredAt,
      worksiteName:  worksites.name,
      workerFirst:   workers.firstName,
      workerLast:    workers.lastName,
      workerRut:     workers.rut,
      workerPos:     workers.position,
      hasSig:        deliveries.signaturePath,
      productId:     deliveryItems.productId,
      productName:   products.name,
      productSku:    products.sku,
      quantity:      deliveryItems.quantity,
      quantityOriginal: deliveryItems.quantityOriginal,
      unitOfMeasure: deliveryItems.unitOfMeasure,
      requestCode:   purchaseRequests.code,
    })
    .from(deliveries)
    .innerJoin(worksites, eq(deliveries.worksiteId, worksites.id))
    .innerJoin(workers, eq(deliveries.workerId, workers.id))
    .innerJoin(deliveryItems, eq(deliveryItems.deliveryId, deliveries.id))
    .leftJoin(products, eq(deliveryItems.productId, products.id))
    .leftJoin(purchaseRequestItems, eq(deliveryItems.requestItemId, purchaseRequestItems.id))
    .leftJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .where(and(
      eq(deliveries.destinationType, "worker"),
      isNotNull(deliveries.workerId),
      worksiteScope,
      worksiteFilter,
    ))
    .orderBy(desc(deliveries.deliveredAt), asc(deliveries.code))
    .limit(maxRows + 1)

  const truncated = rows.length > maxRows
  const limited = truncated ? rows.slice(0, maxRows) : rows
  // La talla entregada es parte del registro: sin ella el export no distingue
  // el zapato 42 del 40, que son filas de catálogo distintas con el mismo nombre.
  const sizeById = await getProductSizesByIds(
    limited.map((r) => r.productId).filter((id): id is string => Boolean(id)),
  )

  const filename = `entregas-epp-${todayInChile()}.xlsx`
  const buffer = await buildXlsxBuffer({
    filenameBase:  "entregas-epp",
    worksheetName: "Entregas EPP",
    headers: [
      "Código", "Fecha entrega", "Faena",
      "Trabajador", "RUT", "Cargo",
      "EPP entregado", "Talla", "SKU", "Cantidad", "U/M",
      "Cantidad originalmente registrada", "Regularizada",
      "Solicitud origen", "Evidencia de firma histórica",
    ],
    rows: limited.map((r) => [
      r.code,
      r.deliveredAt ? formatDate(r.deliveredAt) : "",
      r.worksiteName,
      `${r.workerFirst} ${r.workerLast}`.trim(),
      r.workerRut,
      r.workerPos ?? "",
      r.productName ?? "",
      (r.productId ? sizeById.get(r.productId)?.label : null) ?? "",
      r.productSku ?? "",
      r.quantity,
      r.unitOfMeasure,
      r.quantityOriginal ?? "",
      r.quantityOriginal !== null ? "Sí" : "No",
      r.requestCode ?? "",
      r.hasSig ? "Sí" : "—",
    ]),
  })

  return { buffer, filename, truncated }
}
