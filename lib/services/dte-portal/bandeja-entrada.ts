/**
 * lib/services/dte-portal/bandeja-entrada.ts
 *
 * Bandeja de Entrada del Panel Correo (PanelCorreo/PNC_PanelCorreo.php) —
 * fuente real de las compras de Chome. A diferencia de paneldte.php?rlib=com
 * (vacío: los documentos recibidos nunca se procesan hacia el libro), esta
 * bandeja trae los DTE que los proveedores envían por correo, con RUT emisor
 * incluido en la propia tabla.
 *
 * Verificado contra el portal real (2026-08-04, CodEmp 433):
 * - Sin paginación: un solo POST trae todo el período (681 documentos
 *   probado en 2026-06). La respuesta puede tardar hasta ~80s para ese
 *   volumen — ver el timeout ajustado en config.ts/client.ts.
 * - Las filas son `<tr>` bare (a diferencia de `<tr onmouseover=` de
 *   paneldte.php). El ancla confiable NO es el checkbox `chkRegistro` (solo
 *   algunas filas lo tienen, a veces `disabled`) sino la presencia de
 *   `dtepdfX.php?post=`, verificada 1:1 contra `tbxTotalRegistros`.
 * - Layout físico de columnas (`<td>` de nivel superior, 0-indexado):
 *   0=#, 1=íconos Opciones (flag/email/xml — el PDF NO vive acá),
 *   2=checkbox, 3=fecha/hora recepción, 4=comentario HTML muerto (nunca
 *   renderizado, ignorar), 5=punto de color sin mapear, 6=spacer vacío,
 *   7=fecha doc, 8=tipo (texto, envuelto en el link dtepdfX.php?post= —
 *   ahí vive el PDF/Nreguist, no en la celda de Opciones), 9=folio,
 *   10=RUT emisor, 11=razón social, 12=ícono/spacer, 13=total,
 *   14=tipo ref, 15=folio ref, 16=fecha ref.
 * - El XML del proveedor es un enlace DIRECTO, sin el salto
 *   estadodoc.php→dn.php que sí necesita el flujo de ventas:
 *   `../empr/Chome/DTEProveedores/PRV_<RUT>_<TIPO>_<FOLIO>.xml`.
 * - El "estado en plataforma" no es texto confiable: se deriva del ícono
 *   `penplata.gif` (su `title`) cuando está presente.
 *
 * @see EXPLORACION_PORTAL_DTE_FACTURAENLINEA_2026-08-04.md § 7
 */

import type { DtePortalClient } from "./client"
import {
  decodeHtmlEntities,
  findMatchingRowEnd,
  parseFechaPortal,
  parseFolio,
  parseMonto,
  resolveTipoDocFromText,
  splitTopLevelTdCells,
} from "./parser"
import { DtePortalError, type DteBandejaFilter, type DteBandejaResult, type DteBandejaRow } from "./types"

/** Marca exclusiva de cada fila real (verificado 681/681 contra tbxTotalRegistros). */
const ROW_DATA_MARKER = "dtepdfX.php?post="

/**
 * Consulta la Bandeja de Entrada para un período. Sin paginación: una sola
 * respuesta trae todo (verificado hasta 681 documentos/mes).
 */
export async function fetchBandejaEntrada(
  client: DtePortalClient,
  filter: DteBandejaFilter,
): Promise<DteBandejaResult> {
  const body: Record<string, string> = {
    cbxEstadoPlataforma: filter.estadoPlataforma ?? "",
    cbxMesDocumento: filter.mes,
    cbxAnioDocumento: filter.anio,
    cbxCodigoEmpresa: filter.codEmp,
    tbxRutProveedor: filter.rutProveedor ?? "",
    tbxRutUsuario: client.credentials.rutUsr,
    tbxCodigoEmpresa: filter.codEmp,
  }

  const html = await client.post("PanelCorreo/PNC_PanelCorreo.php", body, {
    CODIGOEMPRESA: filter.codEmp,
    RUTUSUARIO: client.credentials.rutUsr,
    ACCION: "1",
  })

  return parseBandejaResult(html)
}

/**
 * Parsea el HTML completo de la Bandeja de Entrada: extrae las filas y las
 * compara contra `tbxTotalRegistros`, avisando si no coinciden (señal de que
 * el portal empezó a paginar este endpoint, contrario a lo verificado).
 */
export function parseBandejaResult(html: string): DteBandejaResult {
  const rows = parseBandejaRows(html)
  const declaredTotal = extractBandejaTotal(html)

  if (declaredTotal === null && rows.length === 0) {
    throw new DtePortalError(
      "No se encontró tbxTotalRegistros ni filas de documentos en el HTML de la Bandeja de Entrada. " +
      "Es posible que el HTML del portal haya cambiado o que las credenciales sean inválidas.",
      "PARSE_FAILED",
      undefined,
      html.slice(0, 2000),
    )
  }

  const totalRegistros = declaredTotal ?? rows.length
  if (totalRegistros !== rows.length) {
    console.warn(`[dte-bandeja] tbxTotalRegistros declara ${totalRegistros} pero se parsearon ${rows.length} filas. La Bandeja de Entrada podría estar paginando resultados que este parser no está siguiendo.`)
  }

  return { rows, totalRegistros }
}

/**
 * Extrae las filas de documentos reales de la Bandeja de Entrada.
 *
 * El ancla de fila es la presencia de `dtepdfX.php?post=` dentro de un
 * `<tr>` bare — NO el checkbox `chkRegistro`, que solo aparece (a veces
 * disabled) en algunas filas.
 */
export function parseBandejaRows(html: string): DteBandejaRow[] {
  const rowStartRe = /<tr>/gi
  const starts: number[] = []
  let m: RegExpExecArray | null
  while ((m = rowStartRe.exec(html)) !== null) {
    starts.push(m.index)
  }

  const rows: DteBandejaRow[] = []
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!
    const end = i + 1 < starts.length ? starts[i + 1]! : html.length
    const chunk = html.slice(start, end)
    if (!chunk.includes(ROW_DATA_MARKER)) continue

    const rowEnd = findMatchingRowEnd(chunk)
    const rowHtml = rowEnd >= 0 ? chunk.slice(0, rowEnd) : chunk

    const row = parseBandejaRow(rowHtml)
    if (row) rows.push(row)
  }

  return rows
}

function parseBandejaRow(rowHtml: string): DteBandejaRow | null {
  const cells = splitTopLevelTdCells(rowHtml)
  const cellTexts = cells.map((c) => c.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim())

  const fecha = parseFechaPortal(cellTexts[7] ?? "")
  if (!fecha) {
    console.warn(`[dte-bandeja] Fecha no reconocida, fila descartada: "${cellTexts[7]}"`)
    return null
  }

  const folio = parseFolio(cellTexts[9] ?? "")
  if (!folio) {
    console.warn(`[dte-bandeja] Folio no reconocido, fila descartada: "${cellTexts[9]}"`)
    return null
  }

  const tipoDoc = resolveTipoDocFromText(cellTexts[8] ?? "")
  if (!tipoDoc) {
    console.warn(`[dte-bandeja] Tipo de documento no reconocido, fila descartada (folio ${folio}): "${cellTexts[8]}"`)
    return null
  }

  const rutEmisor = (cellTexts[10] ?? "").trim()
  if (!rutEmisor) {
    console.warn(`[dte-bandeja] RUT emisor no reconocido, fila descartada (folio ${folio})`)
    return null
  }

  const montoTotal = parseMonto(cellTexts[13] ?? "")
  if (montoTotal === null) {
    console.warn(`[dte-bandeja] Monto total no reconocido, fila descartada (folio ${folio}): "${cellTexts[13]}"`)
    return null
  }

  // El link dtepdfX.php?post= (con el id Nreguist) vive en la celda
  // "Documento/Tipo" (índice 8, envolviendo el texto del tipo), NO en
  // "Opciones" (índice 1) — esa solo trae los íconos flag/email/xml.
  const documentoCell = cells[8] ?? ""
  const opciones = cells[1] ?? ""

  return {
    fechaRecepcion: (cellTexts[3] ?? "").trim(),
    estadoPlataforma: extractEstadoPlataforma(rowHtml),
    fecha,
    tipoDoc,
    folio,
    rutEmisor,
    razonSocial: (cellTexts[11] ?? "").trim(),
    montoTotal,
    tipoRef: (cellTexts[14] ?? "").trim() || null,
    folioRef: (cellTexts[15] ?? "").trim() || null,
    fechaRef: (cellTexts[16] ?? "").trim() || null,
    nreguist: extractNreguist(documentoCell),
    pdfUrl: extractBandejaPdfUrl(documentoCell),
    xmlUrl: extractBandejaXmlUrl(opciones),
  }
}

/**
 * Extrae el id interno del portal (Nreguist) decodificando el `post=`
 * base64 de dtepdfX.php (mismo patrón que pdf_dte.php en el flujo de ventas).
 */
function extractNreguist(cellHtml: string): string | null {
  const match = cellHtml.match(/dtepdfX\.php\?post=([A-Za-z0-9+/=]+)/i)
  if (!match) return null
  try {
    const decoded = Buffer.from(match[1]!, "base64").toString("utf8")
    const nregMatch = decoded.match(/Nreguist=([^&]+)/i)
    return nregMatch ? nregMatch[1]! : null
  } catch {
    return null
  }
}

function extractBandejaPdfUrl(cellHtml: string): string | null {
  const match = cellHtml.match(/href=["']?([^"'\s>]*dtepdfX\.php\?post=[^"'\s>]*)["']?/i)
  return match ? decodeHtmlEntities(match[1]!) : null
}

/** Enlace directo al XML del proveedor — sin salto intermedio (ver § 7.3). */
export function extractBandejaXmlUrl(cellHtml: string): string | null {
  const match = cellHtml.match(/href=["']?([^"'\s>]*DTEProveedores\/PRV_[^"'\s>]*\.xml)["']?/i)
  return match ? decodeHtmlEntities(match[1]!) : null
}

/**
 * El "estado en plataforma" no es texto confiable (la celda de texto es un
 * comentario HTML nunca renderizado, ver cabecera del archivo). Se deriva
 * del ícono `penplata.gif` cuando está presente.
 */
function extractEstadoPlataforma(rowHtml: string): string | null {
  const match = rowHtml.match(/<img[^>]*src=["']?[^"'\s>]*penplata\.gif["']?[^>]*title=["']([^"']+)["']/i)
  return match ? decodeHtmlEntities(match[1]!).trim() : null
}

export function extractBandejaTotal(html: string): number | null {
  const match = html.match(/tbxTotalRegistros["'][^>]*value=["'](\d+)["']/i)
  return match ? parseInt(match[1]!, 10) : null
}
