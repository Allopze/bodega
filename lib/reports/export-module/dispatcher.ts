import type { Session } from "next-auth"
import type { ExportFilters, ReportData } from "./types"
import { analiticaResumen } from "./analitica"
import { itemsSinOc } from "./items-sin-oc"
import { ocPorEstado } from "./oc-por-estado"
import { solicitudesList } from "./solicitudes"
import { comprasList } from "./compras"
import { recepcionList } from "./recepcion"
import { gastoPorFaena } from "./gasto-faena"

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
    case "recepcion":
      return recepcionList(session, filters, maxRows)
    case "gasto_faena":
    default:
      return gastoPorFaena(session, filters, maxRows)
  }
}
