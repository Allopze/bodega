import { and, eq, inArray } from "drizzle-orm"
import * as schema from "../../db/schema"
import {
  countRows,
  dateOnly,
  daysAgo,
  devId,
  insertInBatches,
  int,
  iso,
  pick,
  type SeedContext,
  type SeedResult,
} from "./shared"

export async function seedOperaciones(context: SeedContext): Promise<SeedResult> {
  const { db, sql, apply, today, rng, base, actors, log } = context
  const notes: string[] = []
  let inserted = 0
  let skipped = 0

  const insertBatch = async <T>(rows: T[], run: (chunk: T[]) => Promise<number>): Promise<number> =>
    insertInBatches(rows, run)

  // ── Conteos físicos ───────────────────────────────────────────────────────
  const countCount = await countRows(sql, "physical_inventory_counts")
  if (countCount < 2) {
    const counts: (typeof schema.physicalInventoryCounts.$inferInsert)[] = base.worksites.slice(0, 2).map((worksite, index) => ({
      id: devId("physical-count", index + 1),
      code: `INV-DEV-2026-${String(index + 1).padStart(4, "0")}`,
      worksiteId: worksite.id,
      status: "closed",
      countedBy: actors.adminUserId,
      closedBy: actors.adminUserId,
      closedAt: iso(daysAgo(today, 5 + index)),
      notes: "Conteo físico de demostración.",
      createdAt: iso(daysAgo(today, 10 + index)),
      updatedAt: iso(daysAgo(today, 5 + index)),
    }))

    const items: (typeof schema.physicalInventoryCountItems.$inferInsert)[] = []
    for (const [index, count] of counts.entries()) {
      const stock = await db
        .select()
        .from(schema.worksiteStock)
        .where(eq(schema.worksiteStock.worksiteId, count.worksiteId!))
        .limit(10)
      const rows = stock.length > 0
        ? stock.map((row) => ({ productId: row.productId, expected: row.quantity }))
        : base.products.slice(0, 10).map((product) => ({ productId: product.id, expected: 0 }))
      for (const [position, row] of rows.entries()) {
        const counted = Math.max(0, row.expected + int(rng, -3, 3))
        items.push({
          id: devId("physical-count-item", index * 100 + position + 1, 6),
          countId: count.id!,
          productId: row.productId,
          expectedQuantity: row.expected,
          countedQuantity: counted,
          difference: counted - row.expected,
          notes: null,
        })
      }
    }

    if (apply) {
      inserted += await insertBatch(counts, async (chunk) =>
        (await db.insert(schema.physicalInventoryCounts).values(chunk).onConflictDoNothing().returning({ id: schema.physicalInventoryCounts.id })).length,
      )
      inserted += await insertBatch(items, async (chunk) =>
        (await db.insert(schema.physicalInventoryCountItems).values(chunk).onConflictDoNothing().returning({ id: schema.physicalInventoryCountItems.id })).length,
      )
    } else {
      skipped += counts.length + items.length
    }
  } else {
    skipped += 2
    notes.push(`physical_inventory_counts ya tiene ${countCount} filas; se omite.`)
  }

  // ── Devoluciones de bodega ────────────────────────────────────────────────
  const returnCount = await countRows(sql, "stock_returns")
  if (returnCount < 4) {
    const returns: (typeof schema.stockReturns.$inferInsert)[] = Array.from({ length: 4 }, (_, index) => ({
      id: devId("stock-return", index + 1),
      code: `DEV-DEV-2026-${String(index + 1).padStart(4, "0")}`,
      worksiteId: pick(rng, base.worksites).id,
      productId: pick(rng, base.products).id,
      deliveryItemId: null,
      quantity: int(rng, 1, 6),
      reason: "Devolución de demostración por término de faena.",
      notes: "Dato generado para el entorno de desarrollo.",
      createdBy: actors.adminUserId,
      createdAt: iso(daysAgo(today, int(rng, 1, 60))),
    }))
    if (apply) {
      inserted += await insertBatch(returns, async (chunk) =>
        (await db.insert(schema.stockReturns).values(chunk).onConflictDoNothing().returning({ id: schema.stockReturns.id })).length,
      )
    } else {
      skipped += returns.length
    }
  } else {
    skipped += 4
  }

  // ── Feedback / soporte ────────────────────────────────────────────────────
  const feedbackCount = await countRows(sql, "feedback_reports")
  if (feedbackCount < 8) {
    const reports: (typeof schema.feedbackReports.$inferInsert)[] = Array.from({ length: 6 }, (_, index) => {
      const estado = index < 2 ? "abierto" : index < 4 ? "en_progreso" : "resuelto"
      return {
        id: devId("feedback", index + 1),
        tipo: pick(rng, ["bug", "consulta", "sugerencia"] as const),
        titulo: `Reporte de demostración ${index + 1}`,
        descripcion: "Descripción de demostración para poblar la bandeja de soporte.",
        pagina: "/dashboard",
        priority: pick(rng, ["baja", "normal", "alta", "critica"] as const),
        dueAt: iso(daysAgo(today, -int(rng, 1, 10))),
        estado,
        notaInterna: "Reporte generado por el seed de desarrollo.",
        createdBy: actors.adminUserId,
        resolvedBy: estado === "resuelto" ? actors.adminUserId : null,
        resolvedAt: estado === "resuelto" ? iso(daysAgo(today, int(rng, 1, 5))) : null,
        createdAt: iso(daysAgo(today, int(rng, 5, 40))),
        updatedAt: iso(daysAgo(today, int(rng, 1, 5))),
      }
    })
    const events: (typeof schema.feedbackReportEvents.$inferInsert)[] = reports.map((report, index) => ({
      id: devId("feedback-event", index + 1),
      reportId: report.id!,
      eventType: "created",
      fromEstado: null,
      toEstado: report.estado,
      note: "Alta de demostración.",
      actorId: actors.adminUserId,
      createdAt: report.createdAt as string,
    }))
    if (apply) {
      inserted += await insertBatch(reports, async (chunk) =>
        (await db.insert(schema.feedbackReports).values(chunk).onConflictDoNothing().returning({ id: schema.feedbackReports.id })).length,
      )
      inserted += await insertBatch(events, async (chunk) =>
        (await db.insert(schema.feedbackReportEvents).values(chunk).onConflictDoNothing().returning({ id: schema.feedbackReportEvents.id })).length,
      )
    } else {
      skipped += reports.length + events.length
    }
  } else {
    skipped += 6
  }

  // ── Cotizaciones de repuestos y servicios ─────────────────────────────────
  const findOpenRequests = (requestType: "repuestos" | "servicios") =>
    db
      .select({ id: schema.purchaseRequests.id })
      .from(schema.purchaseRequests)
      .where(and(
        eq(schema.purchaseRequests.requestType, requestType),
        inArray(schema.purchaseRequests.status, ["submitted", "in_review", "partially_approved", "approved"]),
      ))
      .limit(5)

  const createRequests = async (requestType: "repuestos" | "servicios") => {
    const requests: (typeof schema.purchaseRequests.$inferInsert)[] = Array.from({ length: 5 }, (_, index) => ({
      id: devId(`request-${requestType}`, index + 1),
      code: `SOL-DEV-${requestType === "repuestos" ? "REP" : "SER"}-${String(index + 1).padStart(4, "0")}`,
      worksiteId: base.worksites[index % base.worksites.length]!.id,
      costCenterId: null,
      requesterId: actors.adminUserId,
      requestType,
      urgency: index === 0 ? "high" : "normal",
      requiredDate: dateOnly(daysAgo(today, -7)),
      status: "submitted",
      submittedAt: iso(daysAgo(today, int(rng, 1, 15))),
      closedAt: null,
      notes: "Solicitud de demostración creada por el seed de desarrollo.",
      deliveryMode: "via_oficina",
      createdAt: iso(daysAgo(today, int(rng, 1, 15))),
      updatedAt: iso(daysAgo(today, int(rng, 1, 15))),
    }))
    const items: (typeof schema.purchaseRequestItems.$inferInsert)[] = requests.map((request, index) => ({
      id: devId(`request-${requestType}-item`, index + 1),
      requestId: request.id!,
      productId: null,
      productNameFree: requestType === "repuestos"
        ? `Repuesto de demostración ${index + 1}`
        : `Servicio de demostración ${index + 1}`,
      quantity: int(rng, 1, 5),
      unitOfMeasure: "unidad",
      status: "requested",
      urgency: "normal",
      requiredDate: request.requiredDate,
      workerId: null,
      sortOrder: 1,
      notes: "Ítem de demostración.",
      createdAt: request.createdAt as string,
      updatedAt: request.updatedAt as string,
    }))
    if (apply) {
      inserted += await insertBatch(requests, async (chunk) =>
        (await db.insert(schema.purchaseRequests).values(chunk).onConflictDoNothing().returning({ id: schema.purchaseRequests.id })).length,
      )
      inserted += await insertBatch(items, async (chunk) =>
        (await db.insert(schema.purchaseRequestItems).values(chunk).onConflictDoNothing().returning({ id: schema.purchaseRequestItems.id })).length,
      )
    } else {
      skipped += requests.length + items.length
    }
    return requests.map((request) => ({ id: request.id! }))
  }

  let repuestoRequests = await findOpenRequests("repuestos")
  if (repuestoRequests.length === 0) repuestoRequests = await createRequests("repuestos")
  let serviceRequests = await findOpenRequests("servicios")
  if (serviceRequests.length === 0) serviceRequests = await createRequests("servicios")

  if (repuestoRequests.length > 0) {
    const quotationCount = await countRows(sql, "repuesto_quotations")
    if (quotationCount < 5) {
      const rows: (typeof schema.repuestoQuotations.$inferInsert)[] = repuestoRequests.map((request, index) => ({
        id: devId("repuesto-quotation", index + 1),
        requestId: request.id,
        supplierId: base.suppliers[index % base.suppliers.length]?.id ?? null,
        supplierNameFree: base.suppliers.length === 0 ? "Proveedor de demostración" : null,
        fileName: `cotizacion-repuesto-${index + 1}.pdf`,
        filePath: `dev/repuestos/cotizacion-repuesto-${index + 1}.pdf`,
        fileSize: "120000",
        mimeType: "application/pdf",
        uploadedBy: actors.adminUserId,
        totalAmount: int(rng, 80_000, 900_000),
        status: "pending",
        notes: "Cotización de demostración.",
        createdAt: iso(daysAgo(today, int(rng, 1, 20))),
        updatedAt: iso(daysAgo(today, int(rng, 1, 20))),
      }))
      if (apply) {
        inserted += await insertBatch(rows, async (chunk) =>
          (await db.insert(schema.repuestoQuotations).values(chunk).onConflictDoNothing().returning({ id: schema.repuestoQuotations.id })).length,
        )
      } else {
        skipped += rows.length
      }
    } else {
      skipped += 5
    }
  } else {
    notes.push("No hay solicitudes de repuestos abiertas para cotizar.")
  }

  if (serviceRequests.length > 0) {
    const quotationCount = await countRows(sql, "service_quotations")
    if (quotationCount < 5) {
      const rows: (typeof schema.serviceQuotations.$inferInsert)[] = serviceRequests.map((request, index) => ({
        id: devId("service-quotation", index + 1),
        requestId: request.id,
        supplierId: base.suppliers[index % base.suppliers.length]?.id ?? null,
        supplierNameFree: base.suppliers.length === 0 ? "Proveedor de demostración" : null,
        fileName: `cotizacion-servicio-${index + 1}.pdf`,
        filePath: `dev/servicios/cotizacion-servicio-${index + 1}.pdf`,
        fileSize: "120000",
        mimeType: "application/pdf",
        uploadedBy: actors.adminUserId,
        totalAmount: int(rng, 80_000, 900_000),
        status: "pending",
        notes: "Cotización de demostración.",
        createdAt: iso(daysAgo(today, int(rng, 1, 20))),
        updatedAt: iso(daysAgo(today, int(rng, 1, 20))),
      }))
      if (apply) {
        inserted += await insertBatch(rows, async (chunk) =>
          (await db.insert(schema.serviceQuotations).values(chunk).onConflictDoNothing().returning({ id: schema.serviceQuotations.id })).length,
        )
      } else {
        skipped += rows.length
      }
    } else {
      skipped += 5
    }
  } else {
    notes.push("No hay solicitudes de servicios abiertas para cotizar.")
  }

  log(`  operaciones: ${inserted} filas insertadas, ${skipped} omitidas o planificadas`)
  return { domain: "operaciones", inserted, skipped, notes }
}
