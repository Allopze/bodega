import type { Session } from "next-auth"
import { and, desc, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { dteDocuments } from "@/db/schema"
import { readDtePortalEnv } from "@/lib/services/dte-portal/config"
import { dteTipoLabel } from "@/lib/services/dte-portal/labels"
import { buildDateFilter } from "./utils"
import type { ReportData, ExportFilters } from "./types"

/**
 * DTE recibidos que no calzaron (por RUT + folio) con ninguna factura de OC
 * ni carga de combustible — candidatos a revisar: ¿falta subir la factura a
 * la OC, o es un gasto que nunca pasó por una orden de compra?
 */
export async function dteFacturasSinOc(_session: Session | null, filters: ExportFilters, limit: number): Promise<ReportData> {
  const codEmp = readDtePortalEnv().credentials.codEmp

  const docs = await db
    .select({
      tipoDte:           dteDocuments.tipoDte,
      folio:             dteDocuments.folio,
      fechaEmision:      dteDocuments.fechaEmision,
      rutEmisor:         dteDocuments.rutEmisor,
      razonSocialEmisor: dteDocuments.razonSocialEmisor,
      montoTotal:        dteDocuments.montoTotal,
      periodo:           dteDocuments.periodo,
    })
    .from(dteDocuments)
    .where(and(
      eq(dteDocuments.codEmp, codEmp),
      isNull(dteDocuments.purchaseOrderInvoiceId),
      isNull(dteDocuments.fuelLoadId),
      buildDateFilter(filters, dteDocuments.fechaEmision),
    ))
    .orderBy(desc(dteDocuments.fechaEmision))
    .limit(limit + 1)

  const rowLimitApplied = docs.length > limit
  const limited = rowLimitApplied ? docs.slice(0, limit) : docs

  return {
    filenameBase: "dte-facturas-sin-oc",
    worksheetName: "DTE sin OC",
    headers: ["Tipo", "Folio", "Fecha", "RUT Emisor", "Razón Social", "Total", "Período"],
    rows: limited.map((d) => [
      dteTipoLabel(d.tipoDte),
      d.folio,
      d.fechaEmision,
      d.rutEmisor,
      d.razonSocialEmisor,
      d.montoTotal,
      d.periodo,
    ]),
    rowLimitApplied,
  }
}
