import type { Session } from "next-auth"
import { and, desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { dteDocuments } from "@/db/schema"
import { readDtePortalConfig } from "@/lib/services/dte-portal/config"
import { dteTipoLabel, estadoSiiLabel } from "@/lib/services/dte-portal/labels"
import { buildDateFilter } from "./utils"
import type { ReportData, ExportFilters } from "./types"

/**
 * Libro de Compras Electrónico: todos los DTE recibidos de proveedores
 * (Bandeja de Entrada del portal DTE FacturaEnLínea) en el rango de fechas.
 *
 * Sin filtro de faena — a diferencia del resto de los reportes de compras,
 * el DTE es por empresa/período tributario (CodEmp del portal), no por
 * faena: dteDocuments no tiene worksiteId.
 */
export async function dteLibroCompras(_session: Session | null, filters: ExportFilters, limit: number): Promise<ReportData> {
  const codEmp = (await readDtePortalConfig()).credentials.codEmp

  const docs = await db
    .select({
      tipoDte:           dteDocuments.tipoDte,
      folio:             dteDocuments.folio,
      fechaEmision:      dteDocuments.fechaEmision,
      rutEmisor:         dteDocuments.rutEmisor,
      razonSocialEmisor: dteDocuments.razonSocialEmisor,
      montoNeto:         dteDocuments.montoNeto,
      iva:               dteDocuments.iva,
      montoTotal:        dteDocuments.montoTotal,
      estadoSii:         dteDocuments.estadoSii,
    })
    .from(dteDocuments)
    .where(and(
      eq(dteDocuments.codEmp, codEmp),
      buildDateFilter(filters, dteDocuments.fechaEmision),
    ))
    .orderBy(desc(dteDocuments.fechaEmision))
    .limit(limit + 1)

  const rowLimitApplied = docs.length > limit
  const limited = rowLimitApplied ? docs.slice(0, limit) : docs

  return {
    filenameBase: "dte-libro-compras",
    worksheetName: "Libro de Compras DTE",
    headers: ["Tipo", "Folio", "Fecha", "RUT Emisor", "Razón Social", "Neto", "IVA", "Total", "Estado SII"],
    rows: limited.map((d) => [
      dteTipoLabel(d.tipoDte),
      d.folio,
      d.fechaEmision,
      d.rutEmisor,
      d.razonSocialEmisor,
      d.montoNeto,
      d.iva,
      d.montoTotal,
      estadoSiiLabel(d.estadoSii),
    ]),
    rowLimitApplied,
  }
}
