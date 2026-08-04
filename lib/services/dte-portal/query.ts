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
 * Navega a una página específica de resultados.
 *
 * @see § 9 — Paginación
 */
export async function queryPage(
  client: DtePortalClient,
  pagina: number,
  currentQuery: DteQuery,
): Promise<DtePageResult> {
  // Re-ejecutar la consulta base con el parámetro de página
  const baseQuery = structuredClone(currentQuery) as DteQuery & { pagina?: number }
  baseQuery.pagina = pagina

  switch (baseQuery.tipo) {
    case "folio":   return queryByFolio(client, baseQuery as DteFolioQuery)
    case "periodo": return queryByPeriodo(client, baseQuery as DtePeriodoQuery)
    case "rango":   return queryByRango(client, baseQuery as DteRangoQuery)
    case "rut":     return queryByRut(client, baseQuery as DteRutQuery)
  }
}

/**
 * Obtiene todas las páginas de una consulta, iterando automáticamente.
 * Útil para sincronización completa.
 */
export async function queryAllPages(
  client: DtePortalClient,
  query: DteQuery,
  maxPages = 50,
): Promise<DteDocumentRow[]> {
  const allDocs: DteDocumentRow[] = []
  const firstPage = await queryDtePortal(client, query)
  allDocs.push(...firstPage.docs)

  const totalPages = firstPage.totalPages ?? 1
  const max = Math.min(totalPages, maxPages)

  for (let page = 2; page <= max; page++) {
    const result = await queryPage(client, page, query)
    allDocs.push(...result.docs)
  }

  return allDocs
}