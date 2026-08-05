import type { Session } from "next-auth"
import type { ExportFilters, ReportData } from "./types"
import { analiticaResumen } from "./analitica"
import { itemsSinOc } from "./items-sin-oc"
import { ocPorEstado } from "./oc-por-estado"
import { solicitudesList } from "./solicitudes"
import { comprasList } from "./compras"
import { ocCerradasSinFactura } from "./oc-cerradas-sin-factura"
import { recepcionList } from "./recepcion"
import { gastoPorFaena } from "./gasto-faena"
import { dteLibroCompras } from "./dte-libro-compras"
import { dteConciliacion } from "./dte-conciliacion"
import { dteFacturasSinOc } from "./dte-facturas-sin-oc"
import { billingCobranza } from "./billing-cobranza"

export async function getReportData(tipo: string, session: Session | null, filters: ExportFilters = {}, maxRows = 10_000): Promise<ReportData> {
  switch (tipo) {
    case "analitica_resumen":
      return analiticaResumen(session, filters)
    case "items_sin_oc":
      return itemsSinOc(session, filters, maxRows)
    case "oc_por_estado":
      return ocPorEstado(session, filters, maxRows)
    case "solicitudes":
      return solicitudesList(session, filters, maxRows)
    case "compras":
      return comprasList(session, filters, maxRows)
    case "oc_cerradas_sin_factura":
      return ocCerradasSinFactura(session, filters, maxRows)
    case "recepcion":
      return recepcionList(session, filters, maxRows)
    case "dte_libro_compras":
      return dteLibroCompras(session, filters, maxRows)
    case "dte_conciliacion":
      return dteConciliacion(session, filters, maxRows)
    case "dte_facturas_sin_oc":
      return dteFacturasSinOc(session, filters, maxRows)
    case "facturacion_cobranza":
      return billingCobranza(session, filters, maxRows)
    case "gasto_faena":
    default:
      return gastoPorFaena(session, filters, maxRows)
  }
}
