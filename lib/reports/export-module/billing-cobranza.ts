import type { Session } from "next-auth"
import { getBillingSummary, listInvoices, todayIso } from "@/lib/services/billing/queries"
import { agingBucketFor, AGING_BUCKETS } from "@/lib/services/billing/config"
import {
  collectionStatusLabel,
  documentStatusLabel,
  docTypeShortLabel,
  dueDateSourceLabel,
  paymentStatusLabel,
  providerLabel,
} from "@/lib/services/billing/labels"
import type { ExportFilters, ReportData, ReportSheet } from "./types"

/**
 * Estado de cuentas por cobrar: detalle, antigüedad de deuda y facturación por
 * cliente y por faena.
 *
 * Tres decisiones sobre la forma del reporte:
 *
 * 1. **La moneda es una columna, nunca un supuesto.** Las hojas de resumen
 *    agrupan por moneda; no hay una fila "total" que sume pesos con dólares.
 * 2. **Respeta el alcance por faena** porque usa las mismas consultas que las
 *    pantallas: exportar no puede ser una puerta lateral a datos de otra faena.
 * 3. **Los estados salen como texto**, no como códigos internos: la planilla la
 *    lee alguien que no conoce el vocabulario del sistema.
 *
 * La protección contra inyección de fórmulas la aplica `excel-builder`, que es
 * quien escribe las celdas.
 */
export async function billingCobranza(
  session: Session | null,
  filters: ExportFilters,
  limit: number,
): Promise<ReportData> {
  const today = todayIso()
  const period = filters.fromDate?.slice(0, 7) ?? today.slice(0, 7)

  const [result, summary] = await Promise.all([
    listInvoices(session, "sale", {
      from: filters.fromDate,
      to: filters.toDate,
      worksiteId: filters.worksiteId,
      pageSize: Math.min(limit, 200),
      page: 1,
    }),
    getBillingSummary(session, { period, worksiteId: filters.worksiteId }),
  ])

  const headers = [
    "Tipo", "Folio", "Cliente", "RUT", "Contrato", "Faena",
    "Emisión", "Vencimiento", "Origen del vencimiento",
    "Moneda", "Neto", "IVA", "Total", "Cobrado", "Saldo",
    "Estado documental", "Estado de pago", "Estado de cobranza",
    "Días de atraso", "Tramo de antigüedad", "Fuente", "Responsable",
  ]

  const rows = result.rows.map((row) => [
    docTypeShortLabel(row.docType),
    row.folio,
    row.clientName ?? row.counterpartyName,
    row.counterpartyTaxId,
    row.contractCode ?? "",
    row.worksiteName ?? "",
    row.issueDate,
    row.dueDate ?? "",
    dueDateSourceLabel(row.dueDateSource) ?? "",
    row.currency,
    row.netAmount,
    row.taxAmount,
    row.totalAmount,
    row.paidAmount,
    row.outstandingAmount,
    documentStatusLabel(row.documentStatus).label,
    paymentStatusLabel(row.paymentStatus).label,
    collectionStatusLabel(row.collectionStatus).label,
    // Solo tiene sentido informar atraso si queda algo por cobrar.
    row.daysOverdue !== null && row.paymentStatus !== "paid" && row.daysOverdue > 0 ? row.daysOverdue : "",
    row.agingBucket ? AGING_BUCKETS.find((bucket) => bucket.id === row.agingBucket)?.label ?? "" : "",
    providerLabel(row.source),
    row.ownerName ?? "",
  ])

  const sheets: ReportSheet[] = [
    {
      worksheetName: "Antigüedad de deuda",
      headers: ["Tramo", "Facturas", "Moneda", "Saldo pendiente"],
      rows: summary.aging.flatMap((bucket) =>
        bucket.byCurrency.length === 0
          ? [[bucket.label, bucket.count, "", 0]]
          : bucket.byCurrency.map((money) => [bucket.label, bucket.count, money.currency, money.amount]),
      ),
    },
    {
      worksheetName: "Por cliente",
      headers: ["Cliente", "Moneda", "Facturado en el período"],
      rows: summary.topClients.map((row) => [row.clientName, row.currency, row.amount]),
    },
    {
      worksheetName: "Por faena",
      headers: ["Faena", "Moneda", "Facturado en el período"],
      rows: summary.byWorksite.map((row) => [row.worksiteName, row.currency, row.amount]),
    },
    {
      worksheetName: "Resumen",
      headers: ["Indicador", "Moneda", "Monto"],
      rows: [
        ...summary.invoicedByCurrency.map((money) => ["Facturado en el período", money.currency, money.amount]),
        ...summary.collectedByCurrency.map((money) => ["Cobrado del período", money.currency, money.amount]),
        ...summary.outstandingByCurrency.map((money) => ["Pendiente de cobro", money.currency, money.amount]),
        ...summary.overdueByCurrency.map((money) => ["Vencido", money.currency, money.amount]),
        ["Facturas emitidas en el período", "", summary.invoiceCount],
        ["Facturas vencidas", "", summary.overdueCount],
        ["Días promedio de pago", "", summary.averageDaysToPay ?? "sin facturas pagadas"],
        ["Período del resumen", "", period],
        ["Fecha de referencia (hora de Chile)", "", today],
      ],
    },
  ]

  return {
    filenameBase: "facturacion-cobranza",
    worksheetName: "Facturas emitidas",
    headers,
    rows,
    sheets,
    rowLimitApplied: result.total > result.rows.length,
  }
}

/** Reexportado para que el dispatcher no tenga que conocer la implementación. */
export { agingBucketFor }
