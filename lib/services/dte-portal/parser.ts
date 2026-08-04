/**
 * lib/services/dte-portal/parser.ts
 *
 * Parser defensivo del HTML de paneldte.php.
 *
 * El portal DTE FacturaEnLinea es PHP legacy: la tabla de resultados
 * (id="tabla") y los formularios tienen una estructura predecible pero
 * quebradiza. Este parser está diseñado para fallar con un error explícito
 * cuando el HTML cambia, en vez de devolver datos silenciosamente corruptos.
 *
 * @see explicacion_integral_dte_facturaenlinea.md § 8–10, 19
 */

import { DtePortalError, type DteDocumentRow, type DteEstadoSii, type DteEstadoIntercambio, type DtePageResult } from "./types"

// ── Mapa de iconos de estado SII (§ 19) ──────────────────────────────────────

const SII_STATE_MAP: Record<string, DteEstadoSii> = {
  "siipen.png":     "pendiente_envio",
  "siiinv.png":     "pendiente_envio",
  "siiinvpen.png":  "pendiente_envio",
  "siiinvpar.png":  "pendiente_envio",
  "siienv.png":     "enviado",
  "siiinvrec.png":  "aceptado",
  "siienvrec.png":  "aceptado",
  "siiman.png":     "manual",
  "siianu.png":     "anulado",
  "siiinvrej.png":  "rechazado",
  "siienvpen.png":  "rechazado",
}

const INTERCAMBIO_MAP: Record<string, DteEstadoIntercambio> = {
  "flag_blue.png":   "pendiente",
  "flag_green.png":  "aceptado",
  "flag_red.png":    "rechazado",
}

// ── Parsers principales ──────────────────────────────────────────────────────

/**
 * Parsea el HTML de la tabla de resultados de paneldte.php.
 *
 * Busca un elemento <table> con id="tabla" y extrae cada fila <tr>
 * interpretando las columnas según el orden esperado (§ 8).
 */
export function parseDteTable(html: string, codEmp: string): DtePageResult {
  const table = extractTable(html)
  if (!table) {
    throw new DtePortalError(
      "No se encontró la tabla de resultados en el portal DTE. " +
      "Es posible que el HTML del portal haya cambiado o que las credenciales sean inválidas.",
      "PARSE_FAILED",
      undefined,
      html.slice(0, 2000),
    )
  }

  const rows = extractRows(table)
  const docs: DteDocumentRow[] = []

  for (const row of rows) {
    const cells = extractCells(row)
    if (cells.length < 8) continue // Mínimo 8 columnas (§ 8)

    const doc = parseRow(cells, rows.indexOf(row), codEmp)
    if (doc) docs.push(doc)
  }

  return {
    docs,
    currentPage: extractCurrentPage(html),
    totalPages: extractTotalPages(html),
    totalDocs: docs.length > 0 ? null : 0, // No tenemos total del portal, solo lo que parseamos
    periodo: extractPeriodo(html),
  }
}

/**
 * Parsea el estado SII desde el HTML de la columna "Aceptación SII".
 * Busca el nombre del archivo de imagen del icono.
 */
export function parseEstadoSii(cellHtml: string): DteEstadoSii | null {
  const imgMatch = cellHtml.match(/<img[^>]*src=["'](?:[^"']*\/)?([^"'\s\/]+\.(?:png|gif|jpg))["']/i)
  if (!imgMatch) return null
  const filename = imgMatch[1]!.toLowerCase()
  for (const [key, state] of Object.entries(SII_STATE_MAP)) {
    if (filename.includes(key)) return state
  }
  return null
}

/**
 * Parsea el estado de intercambio electrónico desde el HTML.
 * Busca el icono flag_*.png.
 */
export function parseEstadoIntercambio(cellHtml: string): DteEstadoIntercambio | null {
  const imgMatch = cellHtml.match(/<img[^>]*src=["'](?:[^"']*\/)?(flag_\w+\.png)["']/i)
  if (!imgMatch) return null
  const filename = imgMatch[1]!.toLowerCase()
  return INTERCAMBIO_MAP[filename] ?? null
}

/**
 * Extrae el parámetro `post` de un enlace pdf_dte.php
 */
export function extractPdfPostUrl(cellHtml: string): string | null {
  const match = cellHtml.match(/href=["']([^"']*pdf_dte\.php[^"']*)["']/i)
  return match ? decodeHtmlEntities(match[1]!) : null
}

/**
 * Extrae el enlace al XML del documento.
 */
export function extractXmlUrl(cellHtml: string): string | null {
  // Buscar enlaces o iconos que lleven al XML
  const match = cellHtml.match(/href=["']([^"']*file-xml[^"']*)["']/i)
  if (match) return decodeHtmlEntities(match[1]!)

  // También puede ser un onclick que lleve a panelAceptacionSii.php
  const onclickMatch = cellHtml.match(/onclick=["'][^"']*panelAceptacionSii\.php[^"']*["']/i)
  if (onclickMatch) return null // No hay URL directa, se requiere navegación

  return null
}

/**
 * Extrae el rowId de un documento (parámetro nreg o similar).
 */
export function extractRowId(cellHtml: string): string | null {
  const matchUrl = cellHtml.match(/nreg(?:uist)?=([^&"'\s]+)/i)
  if (matchUrl) return matchUrl[1]!
  const matchInput = cellHtml.match(/name=["']nreg(?:uist)?["'][^>]*value=["']([^"']+)["']/i)
  if (matchInput) return matchInput[1]!
  return null
}

/**
 * Limpia y parsea un valor monetario desde el texto de una celda.
 */
export function parseMonto(text: string): number | null {
  const cleaned = text
    .replace(/[^0-9,\-]/g, "")  // Solo dígitos, coma y signo
    .replace(/\./g, "")          // Separador de miles
    .replace(",", ".")           // Decimal a punto
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

/**
 * Parsea una fecha del portal (formato dd-mm-yyyy o dd/mm/yyyy) a ISO (yyyy-mm-dd).
 */
export function parseFechaPortal(text: string): string | null {
  const cleaned = text.trim()
  // dd-mm-yyyy o dd/mm/yyyy
  const match = cleaned.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/)
  if (!match) return null
  const [_, day, month, year] = match
  return `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`
}

/**
 * Parsea el número de folio desde una celda que puede contener HTML.
 */
export function parseFolio(text: string): number | null {
  const cleaned = text.replace(/<[^>]*>/g, "").trim()
  const n = parseInt(cleaned.replace(/\./g, ""), 10)
  return isNaN(n) ? null : n
}

// ── Helpers de extracción del HTML ───────────────────────────────────────────

function extractTable(html: string): string | null {
  // Buscar <table id="tabla"> o <table id="mytable"> o <table> que contenga los datos
  const patterns = [
    /<table[^>]*\bid=["']tabla["'][^>]*>([\s\S]*?)<\/table>/i,
    /<table[^>]*\bid=["']mytable["'][^>]*>([\s\S]*?)<\/table>/i,
    /<table[^>]*class=["'][^"']*tabla[^"']*["'][^>]*>([\s\S]*?)<\/table>/i,
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match) return match[0]
  }

  return null
}

function extractRows(tableHtml: string): string[] {
  const rows: string[] = []
  // Buscar solo <tr> que no estén dentro de <thead>
  const theadEnd = tableHtml.search(/<\/thead>/i)
  const tbody = theadEnd >= 0 ? tableHtml.slice(theadEnd + 8) : tableHtml

  const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let match: RegExpExecArray | null
  while ((match = trPattern.exec(tbody)) !== null) {
    rows.push(match[0])
  }
  return rows
}

function extractCells(rowHtml: string): string[] {
  const cells: string[] = []
  const tdPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi
  let match: RegExpExecArray | null
  while ((match = tdPattern.exec(rowHtml)) !== null) {
    cells.push(match[1]!.trim())
  }
  return cells
}

function parseRow(cells: string[], rowIndex: number, codEmp: string): DteDocumentRow | null {
  const cellTexts = cells.map((c) => c.replace(/<[^>]*>/g, "").trim())

  // Columna 0: Opciones (iconos PDF, XML, email, etc.)
  // Columna 1: Aceptación SII (estado)
  // Columna 2: Fecha
  // Columna 3: Documento (tipo)
  // Columna 4: Folio
  // Columna 5: Razón Social
  // Columna 6: Estado
  // Columna 7: Total Neto
  // Columna 8: Total

  const fecha = parseFechaPortal(cellTexts[2] ?? "")
  if (!fecha) return null

  const folio = parseFolio(cellTexts[4] ?? "")
  if (!folio) return null

  const montoNeto = parseMonto(cellTexts[7] ?? "")
  const montoTotal = parseMonto(cellTexts[8] ?? "") ?? montoNeto ?? 0

  const estadoSii = parseEstadoSii(cells[1] ?? "")
  const pdfUrl = extractPdfPostUrl(cells[0] ?? "")
  const xmlUrl = extractXmlUrl(cells[0] ?? "")
  const rowId = extractRowId(cells[0] ?? "")

  const tipoDoc = (cellTexts[3] ?? "").trim()

  return {
    rowId,
    estadoSii,
    fecha,
    tipoDoc,
    folio,
    razonSocial: (cellTexts[5] ?? "").trim(),
    estado: (cellTexts[6] ?? "").trim(),
    montoNeto,
    montoTotal,
    pdfUrl,
    xmlUrl,
    rutEmisor: null, // Se llena desde el contexto de la consulta, no del HTML
    codEmp: codEmp,
  }
}

function extractCurrentPage(html: string): number {
  // Buscar en el select de paginación o en el texto "Página X de Y"
  const pageMatch = html.match(/pagina["']\s*>\s*<option[^>]*selected[^>]*>(\d+)<\/option>/i)
  if (pageMatch) return parseInt(pageMatch[1]!, 10)

  const textMatch = html.match(/Página\s+(\d+)\s+de\s+\d+/i)
  if (textMatch) return parseInt(textMatch[1]!, 10)

  return 1
}

function extractTotalPages(html: string): number | null {
  const match = html.match(/Página\s+\d+\s+de\s+(\d+)/i)
  if (match) return parseInt(match[1]!, 10)

  // Buscar en el select de paginación el último option
  const options = html.match(/<option[^>]*>\d+<\/option>/gi)
  if (options && options.length > 0) {
    const last = options[options.length - 1]!.match(/>(\d+)</)
    if (last) return parseInt(last[1]!, 10)
  }

  return null
}

function extractPeriodo(html: string): string | null {
  const match = html.match(/<input[^>]*\bname=["']peri["'][^>]*\bvalue=["'](\d{4}-\d{2})["']/i)
  return match ? match[1]! : null
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&ntilde;/g, "ñ")
    .replace(/&Ntilde;/g, "Ñ")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
} /**
 * Parser defensivo del HTML de paneldte.php.
 *
 * @see explicacion_integral_dte_facturaenlinea.md § 8–10, 19
 */