import type { Session } from "next-auth"
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm"
import { db } from "@/db"
import { dteDocuments, purchaseOrderInvoices, purchaseOrders } from "@/db/schema"
import { readDtePortalConfig } from "@/lib/services/dte-portal/config"
import { dteTipoLabel } from "@/lib/services/dte-portal/labels"
import { buildDateFilter } from "./utils"
import type { ReportData, ExportFilters } from "./types"

/**
 * Cruce OC ↔ Factura ↔ DTE: para cada documento DTE ya vinculado a una
 * factura de OC, compara el total del DTE (lo que el SII certifica que
 * emitió el proveedor) contra el monto de la factura subida a la OC.
 */
export async function dteConciliacion(_session: Session | null, filters: ExportFilters, limit: number): Promise<ReportData> {
  const codEmp = (await readDtePortalConfig()).credentials.codEmp

  const docs = await db
    .select({
      tipoDte:           dteDocuments.tipoDte,
      folio:             dteDocuments.folio,
      fechaEmision:      dteDocuments.fechaEmision,
      rutEmisor:         dteDocuments.rutEmisor,
      razonSocialEmisor: dteDocuments.razonSocialEmisor,
      montoTotal:        dteDocuments.montoTotal,
      purchaseOrderInvoiceId: dteDocuments.purchaseOrderInvoiceId,
    })
    .from(dteDocuments)
    .where(and(
      eq(dteDocuments.codEmp, codEmp),
      isNotNull(dteDocuments.purchaseOrderInvoiceId),
      buildDateFilter(filters, dteDocuments.fechaEmision),
    ))
    .orderBy(desc(dteDocuments.fechaEmision))
    .limit(limit + 1)

  const rowLimitApplied = docs.length > limit
  const limited = rowLimitApplied ? docs.slice(0, limit) : docs

  const invoiceIds = [...new Set(limited.map((d) => d.purchaseOrderInvoiceId!))]
  const invoices = invoiceIds.length > 0
    ? await db
        .select({
          id:              purchaseOrderInvoices.id,
          invoiceNumber:   purchaseOrderInvoices.invoiceNumber,
          amount:          purchaseOrderInvoices.amount,
          purchaseOrderId: purchaseOrderInvoices.purchaseOrderId,
        })
        .from(purchaseOrderInvoices)
        .where(inArray(purchaseOrderInvoices.id, invoiceIds))
    : []
  const invoiceById = new Map(invoices.map((i) => [i.id, i]))

  const orderIds = [...new Set(invoices.map((i) => i.purchaseOrderId))]
  const orders = orderIds.length > 0
    ? await db.select({ id: purchaseOrders.id, code: purchaseOrders.code }).from(purchaseOrders).where(inArray(purchaseOrders.id, orderIds))
    : []
  const orderCodeById = new Map(orders.map((o) => [o.id, o.code]))

  return {
    filenameBase: "dte-conciliacion",
    worksheetName: "Conciliación OC-Factura-DTE",
    headers: ["Tipo DTE", "Folio DTE", "Fecha", "RUT Emisor", "Razón Social", "Total DTE", "OC", "N° Factura", "Monto Factura", "Discrepancia"],
    rows: limited.map((d) => {
      const invoice = d.purchaseOrderInvoiceId ? invoiceById.get(d.purchaseOrderInvoiceId) : undefined
      const invoiceAmount = invoice?.amount ?? null
      const discrepancy = invoiceAmount !== null ? d.montoTotal - invoiceAmount : null
      return [
        dteTipoLabel(d.tipoDte),
        d.folio,
        d.fechaEmision,
        d.rutEmisor,
        d.razonSocialEmisor,
        d.montoTotal,
        invoice ? (orderCodeById.get(invoice.purchaseOrderId) ?? invoice.purchaseOrderId) : "",
        invoice?.invoiceNumber ?? "",
        invoiceAmount,
        discrepancy,
      ]
    }),
    rowLimitApplied,
  }
}
