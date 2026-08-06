/**
 * lib/services/billing/export.ts
 *
 * Export Excel de facturas emitidas. Reusa `listInvoices` para que el archivo
 * respete exactamente el mismo alcance por faena y los mismos filtros que la
 * pantalla: lo que se exporta es lo que la sesión puede ver, ni una fila más.
 */

import type { Session } from "next-auth"
import type { ReportCell, ReportData, ReportSheet } from "@/lib/reports/export"
import { listInvoices, type InvoiceFilters } from "./queries"
import { collectionStatusLabel, documentStatusLabel, paymentStatusLabel, providerLabel } from "./labels"

/** Tope de filas del archivo; sobre esto se informa el recorte en el nombre de hoja. */
const MAX_EXPORT_ROWS = 5000
const PAGE_SIZE = 200

function safeCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  const text = typeof value === "string" ? value : String(value)
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

export async function buildInvoicesExport(session: Session | null, filters: InvoiceFilters): Promise<ReportData> {
  const rows: ReportCell[][] = []
  let page = 1
  let total = 0
  for (;;) {
    const result = await listInvoices(session, "sale", { ...filters, page, pageSize: PAGE_SIZE })
    total = result.total
    for (const row of result.rows) {
      rows.push([
        row.folio,
        safeCell(row.docType),
        safeCell(row.counterpartyName),
        safeCell(row.counterpartyTaxId),
        row.issueDate,
        row.dueDate,
        safeCell(row.currency),
        row.netAmount,
        row.taxAmount,
        row.totalAmount,
        row.paidAmount,
        row.outstandingAmount,
        documentStatusLabel(row.documentStatus).label,
        paymentStatusLabel(row.paymentStatus).label,
        collectionStatusLabel(row.collectionStatus).label,
        providerLabel(row.source),
        safeCell(row.clientName),
        safeCell(row.contractCode),
        safeCell(row.worksiteName),
        row.daysOverdue,
      ])
    }
    if (rows.length >= Math.min(total, MAX_EXPORT_ROWS) || result.rows.length === 0) break
    page += 1
  }

  const rowLimitApplied = total > MAX_EXPORT_ROWS
  const sheetData: ReportSheet = {
    worksheetName: "Facturas",
    headers: [
      "Folio", "Tipo doc.", "Cliente", "RUT", "Emisión", "Vencimiento", "Moneda",
      "Neto", "IVA", "Total", "Pagado", "Saldo",
      "Estado documental", "Estado de pago", "Cobranza", "Fuente",
      "Cliente vinculado", "Contrato", "Faena", "Días vencida",
    ],
    rows: rows.slice(0, MAX_EXPORT_ROWS),
  }

  return {
    filenameBase: "facturas-emitidas",
    worksheetName: sheetData.worksheetName,
    headers: sheetData.headers,
    rows: sheetData.rows,
    rowLimitApplied,
  }
}
