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
 * - Layout físico de columnas (`<td>` de nivel superior, 0-indexado, ya SIN
 *   los comentarios HTML que `splitTopLevelTdCells` descarta — el portal trae
 *   un `<!--<td>...PENDIENTE...</td>-->` entre la fecha de recepción y el
 *   punto de color que nunca se renderiza):
 *   0=#, 1=íconos Opciones (flag/email/xml — el PDF NO vive acá),
 *   2=checkbox, 3=fecha/hora recepción, 4=punto de color sin mapear,
 *   5=spacer vacío, 6=fecha doc, 7=tipo (texto, envuelto en el link
 *   dtepdfX.php?post= — ahí vive el PDF/Nreguist, no en la celda de
 *   Opciones), 8=folio, 9=RUT emisor, 10=razón social, 11=ícono/spacer,
 *   12=total, 13=tipo ref, 14=folio ref, 15=fecha ref.
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
import { logger } from "@/lib/logger"

/** Marca exclusiva de cada fila real (verificado 681/681 contra tbxTotalRegistros). */
const ROW_DATA_MARKER = "dtepdfX.php?post="

/**
 * Contexto sólo de diagnóstico: acompaña a los avisos de fila descartada para
 * poder reconstruir qué se perdió y de qué corrida (sin él, un `partial` que
 * dice "faltan 3" deja tres warns sueltos en stdout, mezclados con los de las
 * otras corridas del día).
 */
export interface DteBandejaParseContext {
  correlationId?: string
  /** "YYYY-MM" del período consultado. */
  periodo?: string
}

/**
 * Consulta la Bandeja de Entrada para un período. Sin paginación: una sola
 * respuesta trae todo (verificado hasta 681 documentos/mes).
 */
export async function fetchBandejaEntrada(
  client: DtePortalClient,
  filter: DteBandejaFilter,
  context: DteBandejaParseContext = {},
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

  return parseBandejaResult(html, { periodo: `${filter.anio}-${filter.mes}`, ...context })
}

/**
 * Parsea el HTML completo de la Bandeja de Entrada: extrae las filas y las
 * compara contra `tbxTotalRegistros`, avisando si no coinciden (señal de que
 * el portal empezó a paginar este endpoint, contrario a lo verificado).
 */
export function parseBandejaResult(html: string, context: DteBandejaParseContext = {}): DteBandejaResult {
  const rows = parseBandejaRows(html, context)
  const declaredTotal = extractBandejaTotal(html)

  if (declaredTotal === null && rows.length === 0) {
    throw new DtePortalError(
      "No se encontró tbxTotalRegistros ni filas de documentos en el HTML de la Bandeja de Entrada. " +
      "Es posible que el HTML del portal haya cambiado o que las credenciales sean inválidas.",
      "PARSE_FAILED",
    )
  }

  const totalRegistros = declaredTotal ?? rows.length
  if (declaredTotal === null) {
    // Sin el total declarado la verificación de completitud es una tautología
    // (`totalRegistros` sería `rows.length`): quien consuma el resultado debe
    // mirar `declaredTotal` y reportar la corrida como `partial`, no cerrarla
    // en éxito comparando un número contra sí mismo.
    logger.warn({ correlationId: context.correlationId }, "[dte-bandeja] el portal no declaró el total de registros", {
      code: "DTE_BANDEJA_TOTAL_MISSING",
      periodo: context.periodo ?? null,
      parsed: rows.length,
    })
  } else if (declaredTotal !== rows.length) {
    logger.warn({ correlationId: context.correlationId }, "[dte-bandeja] total declarado no coincide", {
      code: "DTE_BANDEJA_TOTAL_MISMATCH",
      periodo: context.periodo ?? null,
      declared: declaredTotal,
      parsed: rows.length,
    })
  }

  return { rows, totalRegistros, declaredTotal }
}

/**
 * Extrae las filas de documentos reales de la Bandeja de Entrada.
 *
 * El ancla de fila es la presencia de `dtepdfX.php?post=` dentro de un
 * `<tr>` bare — NO el checkbox `chkRegistro`, que solo aparece (a veces
 * disabled) en algunas filas.
 */
export function parseBandejaRows(html: string, context: DteBandejaParseContext = {}): DteBandejaRow[] {
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

    const row = parseBandejaRow(rowHtml, context)
    if (row) rows.push(row)
  }

  return rows
}

function parseBandejaRow(rowHtml: string, context: DteBandejaParseContext = {}): DteBandejaRow | null {
  const cells = splitTopLevelTdCells(rowHtml)
  const cellTexts = cells.map((c) => c.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim())

  // Folio y tipo se leen antes de validar para poder identificar la fila en el
  // aviso aunque sea justamente lo que está mal (no son PII; el RUT sí lo
  // redacta el logger).
  const discard = (code: string) => {
    logger.warn({ correlationId: context.correlationId }, "[dte-bandeja] fila descartada", {
      code,
      periodo: context.periodo ?? null,
      tipo: cellTexts[7] ?? null,
      folio: cellTexts[8] ?? null,
    })
    return null
  }

  // El total (índice 12) es la última columna obligatoria: con menos celdas el
  // layout cambió y los índices fijos ya no describen nada.
  if (cells.length < 13) return discard("DTE_BANDEJA_LAYOUT_INVALID")

  const fecha = parseFechaPortal(cellTexts[6] ?? "")
  if (!fecha) return discard("DTE_BANDEJA_DATE_INVALID")

  const folio = parseFolio(cellTexts[8] ?? "")
  if (!folio) return discard("DTE_BANDEJA_FOLIO_INVALID")

  const tipoDoc = resolveTipoDocFromText(cellTexts[7] ?? "")
  if (!tipoDoc) return discard("DTE_BANDEJA_DOCUMENT_TYPE_INVALID")

  const rutEmisor = (cellTexts[9] ?? "").trim()
  if (!rutEmisor) return discard("DTE_BANDEJA_ISSUER_RUT_INVALID")

  const montoTotal = parseMonto(cellTexts[12] ?? "")
  if (montoTotal === null) return discard("DTE_BANDEJA_AMOUNT_INVALID")

  // El link dtepdfX.php?post= (con el id Nreguist) vive en la celda
  // "Documento/Tipo" (índice 7, envolviendo el texto del tipo), NO en
  // "Opciones" (índice 1) — esa solo trae los íconos flag/email/xml.
  const documentoCell = cells[7] ?? ""
  const opciones = cells[1] ?? ""

  const fechaRecepcion = (cellTexts[3] ?? "").trim()

  return {
    fechaRecepcion,
    // La consulta filtra por fecha del DOCUMENTO, así que la de recepción es
    // el único dato que permite medir el atraso con que el proveedor sube el
    // DTE y justificar un re-barrido de períodos viejos.
    fechaRecepcionDate: parseFechaPortal(fechaRecepcion.split(" ")[0] ?? ""),
    estadoPlataforma: extractEstadoPlataforma(rowHtml),
    fecha,
    tipoDoc,
    folio,
    rutEmisor,
    razonSocial: (cellTexts[10] ?? "").trim(),
    montoTotal,
    tipoRef: (cellTexts[13] ?? "").trim() || null,
    folioRef: (cellTexts[14] ?? "").trim() || null,
    fechaRef: (cellTexts[15] ?? "").trim() || null,
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
 * El "estado en plataforma" no es texto confiable: la celda de texto es un
 * comentario HTML nunca renderizado (por eso `splitTopLevelTdCells` lo
 * descarta antes de contar celdas). Se deriva del ícono `penplata.gif`
 * cuando está presente.
 */
function extractEstadoPlataforma(rowHtml: string): string | null {
  const match = rowHtml.match(/<img[^>]*src=["']?[^"'\s>]*penplata\.gif["']?[^>]*title=["']([^"']+)["']/i)
  return match ? decodeHtmlEntities(match[1]!).trim() : null
}

export function extractBandejaTotal(html: string): number | null {
  const match = html.match(/tbxTotalRegistros["'][^>]*value=["'](\d+)["']/i)
  return match ? parseInt(match[1]!, 10) : null
}
