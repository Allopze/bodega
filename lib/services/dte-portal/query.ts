/**
 * lib/services/dte-portal/query.ts
 *
 * Los 4 formularios de consulta del portal DTE FacturaEnLinea.
 *
 * Cada función construye y ejecuta la consulta HTTP correspondiente, parsea
 * el HTML resultante y devuelve los documentos estructurados.
 *
 * @see explicacion_integral_dte_facturaenlinea.md § 6
 */

import { DtePortalClient } from "./client"
import { parseDteTable } from "./parser"
import type {
  DteDocumentRow,
  DteFolioQuery,
  DtePageResult,
  DtePeriodoQuery,
  DteQuery,
  DteRangoQuery,
  DteRutQuery,
} from "./types"

/**
 * Ejecuta cualquier tipo de consulta y devuelve los documentos.
 */
export async function queryDtePortal(
  client: DtePortalClient,
  query: DteQuery,
): Promise<DtePageResult> {
  switch (query.tipo) {
    case "folio":   return queryByFolio(client, query)
    case "periodo": return queryByPeriodo(client, query)
    case "rango":   return queryByRango(client, query)
    case "rut":     return queryByRut(client, query)
  }
}

/**
 * @see § 6.2 — Búsqueda por folio (fil=3)
 *
 * POST a paneldte.php con:
 *   rlib, CodEmp, TipDoc, NumFac1, NumFac2, unosolo, hdnOtroDoc3
 */
export async function queryByFolio(
  client: DtePortalClient,
  query: DteFolioQuery,
): Promise<DtePageResult> {
  const body: Record<string, string> = {
    rlib: query.rlib,
    CodEmp: client.credentials.codEmp,
    TipDoc: query.tipoDoc,
    NumFac1: String(query.folioDesde),
    NumFac2: String(query.folioHasta),
    unosolo: query.folioDesde === query.folioHasta ? "on" : "",
    hdnOtroDoc3: "",
  }

  const html = await client.post("paneldte.php", body, { fil: "3" })
  return parseDteTable(html, client.credentials.codEmp)
}

/**
 * @see § 6.1 — Filtro principal por período (fil=1)
 *
 * POST a paneldte.php con:
 *   rlib, CodEmp, diat, mes, anio, peri, FchCon
 */
export async function queryByPeriodo(
  client: DtePortalClient,
  query: DtePeriodoQuery,
): Promise<DtePageResult> {
  const [year, month] = query.periodo.split("-")

  const body: Record<string, string> = {
    rlib: query.rlib,
    CodEmp: client.credentials.codEmp,
    diat: query.dia,
    mes: month ?? "01",
    anio: year ?? "2026",
    peri: query.periodo,
    FchCon: query.fechaContable ? "on" : "",
  }

  const html = await client.post("paneldte.php", body, { fil: "1" })
  return parseDteTable(html, client.credentials.codEmp)
}

/**
 * @see § 6.4 — Búsqueda por rango de fechas (fil=2)
 *
 * POST a paneldte.php con:
 *   rlib, FchCon, hdnOtroDoc2, date13, date14, CodEmp
 */
export async function queryByRango(
  client: DtePortalClient,
  query: DteRangoQuery,
): Promise<DtePageResult> {
  const body: Record<string, string> = {
    rlib: query.rlib,
    FchCon: "",
    hdnOtroDoc2: "",
    date13: query.desde,
    date14: query.hasta,
    CodEmp: client.credentials.codEmp,
  }

  const html = await client.post("paneldte.php", body, { fil: "2" })
  return parseDteTable(html, client.credentials.codEmp)
}

/**
 * @see § 6.3 — Búsqueda por RUT cliente (fil=4)
 *
 * POST a paneldte.php con:
 *   rlib, CodEmp, hdnOtroDoc, RutClien
 */
export async function queryByRut(
  client: DtePortalClient,
  query: DteRutQuery,
): Promise<DtePageResult> {
  const body: Record<string, string> = {
    rlib: query.rlib,
    CodEmp: client.credentials.codEmp,
    hdnOtroDoc: "",
    RutClien: query.rutCliente,
  }

  const html = await client.post("paneldte.php", body, { fil: "4" })
  return parseDteTable(html, client.credentials.codEmp)
}

/**
 * Obtiene los documentos de una consulta.
 *
 * @see § 9 — Paginación
 *
 * Verificado contra el portal real (2026-08-04): el `<select name="pagina">`
 * del panel se llena por JavaScript en el navegador y nunca refleja el total
 * real en el HTML crudo. Probado con una cuenta real de hasta 305 documentos
 * en una sola consulta: el portal los devolvió TODOS en una sola respuesta,
 * sin paginar. Por eso no hay navegación de páginas — `parseDteTable` ya
 * avisa por consola si `tbxTotalDocumentos` no coincide con las filas
 * parseadas, que sería la señal de que esta suposición dejó de ser válida.
 */
export async function queryAllPages(
  client: DtePortalClient,
  query: DteQuery,
): Promise<DteDocumentRow[]> {
  const result = await queryDtePortal(client, query)
  return result.docs
}