/**
 * lib/services/dte-portal/parser.ts
 *
 * Parser defensivo del HTML de paneldte.php.
 *
 * Verificado contra HTML real del portal (2026-08-04, cuenta rut_emp 78023530-6,
 * CodEmp 433, libro de ventas). Hallazgos que difieren de lo asumido original:
 * - Las filas de documentos NO están dentro de <table id="tabla"> (esa tabla
 *   se cierra justo después del encabezado); son bloques sueltos
 *   `<tr onmouseover=...>` que aparecen después, fuera de cualquier tabla con
 *   nombre. Ese atributo es exclusivo de filas de datos reales.
 * - Cada celda "top-level" puede contener una subtabla propia (Opciones,
 *   Estado), así que separar celdas requiere rastrear profundidad de <table>.
 * - "Aceptación SII" no trae íconos: trae 1-2 puntos de color inline
 *   (background: #hex) cuyo mapeo completo no se pudo determinar con los
 *   datos disponibles — se ignora deliberadamente.
 * - Los íconos Sii*.png / flag_*.png están en la columna "Estado", no en
 *   "Aceptación SII".
 * - "Documento" trae el nombre en español (ej. "Factura Electronica"), no el
 *   código numérico — se resuelve por texto contra el catálogo TipDoc real.
 * - La fecha viene en ISO (yyyy-mm-dd), no dd-mm-yyyy.
 * - El `<select name="pagina">` se llena por JavaScript en el navegador; en
 *   el HTML crudo siempre trae una sola opción sin importar el total real.
 *   Con hasta 305 documentos en una cuenta real, el portal los devolvió TODOS
 *   en una sola respuesta (sin paginar). Por eso no se implementa navegación
 *   de páginas: se usa `tbxTotalDocumentos` solo como señal de alerta si no
 *   coincide con las filas parseadas.
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

// ── Mapa texto→código del dropdown TipDoc (§ 4), verificado contra el HTML
// real del catálogo; sin tildes tal como lo renderiza el portal. Ordenado de
// texto más largo a más corto para evitar falsos positivos por substring
// (ej. "Factura Exenta" no debe matchear dentro de "Factura Exenta Electronica").
const TIPDOC_TEXT_MAP: Array<[text: string, code: string]> = [
  ["Nota Debito Exportacion Electronica", "111"],
  ["Nota Credito Exportacion Electronica", "112"],
  ["Factura Exportacion Electronica", "110"],
  ["Liquidacion Factura Electronica", "43"],
  ["Factura de Compra Electronica", "87"],
  ["Nota de Credito Exportacion", "106"],
  ["Nota de Debito Exportacion", "104"],
  ["Fac. Venta Exenta a Z.Franca", "102"],
  ["Boleta Afecta Electronica", "39"], // verificado contra la Bandeja de Entrada real (2026-08-04)
  ["Boleta Exenta Electronica", "41"],
  ["Factura Exenta Electronica", "34"],
  ["Guia de Despacho Electronica", "52"], // § 4.4, no confirmado contra HTML real
  ["Nota de Credito Electronica", "61"],
  ["Nota de Debito Electronica", "56"],
  ["Liquidacion Factura", "40"],
  ["Factura de Compra", "92"],
  ["Factura Exportacion", "88"],
  ["Factura Electronica", "33"],
  ["Nota de Credito", "60"],
  ["Nota de Debito", "55"],
  ["Factura Afecta", "30"],
  ["Factura Exenta", "32"],
  ["Liquidacion", "103"],
]
TIPDOC_TEXT_MAP.sort((a, b) => b[0].length - a[0].length)

/** Divisores cosméticos entre columnas: <td> negro sin contenido. */
const DIVIDER_TD_RE = /<td[^>]*\bbgcolor=["']#000000["'][^>]*>\s*<\/td>/gi

/** Marca exclusiva de las filas de datos reales del panel (verificado contra HTML real). */
const ROW_MARKER_RE = /<tr\s+onmouseover=/gi

// ── Parsers principales ──────────────────────────────────────────────────────

/**
 * Parsea el HTML de la tabla de resultados de paneldte.php.
 */
export function parseDteTable(html: string, codEmp: string): DtePageResult {
  const rows = extractRows(html)
  const docs: DteDocumentRow[] = []

  for (const row of rows) {
    const cells = extractCells(row)
    if (cells.length < 9) continue // Mínimo 9 columnas reales (§ 8), sin divisores

    const doc = parseRow(cells, codEmp)
    if (doc) docs.push(doc)
  }

  const totalDocs = extractTotalDocumentos(html)

  // Un período sin documentos es un resultado válido, no un fallo de parseo.
  // El libro de ventas NO emite "No se encontraron documentos" cuando está
  // vacío: lo señala con `tbxTotalDocumentos="0"`. Verificado 2026-08-11
  // contra el portal real — 2026-08 sin ventas devuelve 58 KB con total "0" y
  // cero filas, mientras 2026-07 devuelve 288 KB con total "47" y 47 filas.
  // Sin este caso, todo mes sin ventas emitidas fallaba con un error que
  // además culpaba a las credenciales, mandando a buscar un problema
  // inexistente el primer día de cada mes.
  if (docs.length === 0 && rows.length === 0 && totalDocs !== 0 && !hasEmptyResultMarker(html)) {
    throw new DtePortalError(
      "No se encontraron filas de documentos ni el marcador de resultado vacío en el HTML del portal DTE. " +
      "Es posible que el HTML del portal haya cambiado o que las credenciales sean inválidas.",
      "PARSE_FAILED",
      undefined,
      html.slice(0, 2000),
    )
  }

  if (totalDocs !== null && totalDocs !== docs.length) {
    console.warn(`[dte-parser] tbxTotalDocumentos declara ${totalDocs} pero se parsearon ${docs.length} filas. El portal podría estar paginando resultados que este parser no está siguiendo.`)
  }

  return {
    docs,
    currentPage: 1,
    totalPages: 1, // Verificado: el portal devuelve todos los resultados en una sola respuesta (hasta 305 filas probadas)
    totalDocs,
    periodo: extractPeriodo(html),
  }
}

/**
 * Parsea el estado SII desde el HTML de la columna "Estado".
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
 * Busca el icono flag_*.png (columna "Estado", junto al icono SII).
 */
export function parseEstadoIntercambio(cellHtml: string): DteEstadoIntercambio | null {
  const imgMatch = cellHtml.match(/<img[^>]*src=["'](?:[^"']*\/)?(flag_\w+\.png)["']/i)
  if (!imgMatch) return null
  const filename = imgMatch[1]!.toLowerCase()
  return INTERCAMBIO_MAP[filename] ?? null
}

/**
 * Extrae el parámetro `post` de un enlace pdf_dte.php.
 * Nota: el portal trae dos enlaces a pdf_dte.php por fila (copia cedible en
 * "Opciones", copia tributaria normal en "Documento"); esta función toma el
 * primero que encuentre en el HTML pasado.
 */
export function extractPdfPostUrl(cellHtml: string): string | null {
  const match = cellHtml.match(/href=["']([^"']*pdf_dte\.php[^"']*)["']/i)
  return match ? decodeHtmlEntities(match[1]!) : null
}

/**
 * Extrae el enlace al XML del documento.
 *
 * Verificado contra el portal real: no hay descarga directa de XML desde la
 * tabla de resultados. El ícono file-xml.png suele estar envuelto en un
 * onclick que abre `estadodoc.php?codemp=...&folio=...&tipodoc=...&Nreguist=...`,
 * una página intermedia desde la que sí se puede extraer el enlace real
 * (`dn.php?file=<RUT_EMISOR>_<TIPO>_<FOLIO>.xml&Tp=...`). Ese segundo salto
 * vive en download.ts, no acá — esta función solo confirma si existe el
 * onclick de navegación.
 */
export function extractXmlUrl(cellHtml: string): string | null {
  const onclickMatch = cellHtml.match(/onClick=["']popupd\(['"]([^'"]*estadodoc\.php[^'"]*)['"]\)["']/i)
  if (onclickMatch) return decodeHtmlEntities(onclickMatch[1]!)
  return null
}

/**
 * Extrae el rowId de un documento (parámetro Nreguist).
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
 * Parsea una fecha del portal a ISO (yyyy-mm-dd).
 * Formato real observado: yyyy-mm-dd. Se acepta también dd-mm-yyyy / dd/mm/yyyy
 * por si otro formulario del portal lo usa (ej. selectores de rango, § 6.4).
 */
export function parseFechaPortal(text: string): string | null {
  const cleaned = text.trim()

  const iso = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) {
    const [, year, month, day] = iso
    return `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`
  }

  const dmy = cleaned.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/)
  if (dmy) {
    const [, day, month, year] = dmy
    return `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`
  }

  return null
}

/**
 * Parsea el número de folio desde una celda que puede contener HTML.
 */
export function parseFolio(text: string): number | null {
  const cleaned = text.replace(/<[^>]*>/g, "").trim()
  const n = parseInt(cleaned.replace(/\./g, ""), 10)
  return isNaN(n) ? null : n
}

/**
 * Resuelve el código numérico de tipo de documento a partir del texto en
 * español que muestra la columna "Documento" (ej. "Factura Electronica" → "33").
 * Usa coincidencia por substring (más largo primero) porque la celda puede
 * traer texto adicional pegado (ej. el link "[POS]" del ticket térmico).
 */
export function resolveTipoDocFromText(text: string): string | null {
  const cleaned = text.replace(/\s+/g, " ").trim()
  for (const [label, code] of TIPDOC_TEXT_MAP) {
    if (cleaned.includes(label)) return code
  }
  return null
}

// ── Helpers de extracción del HTML ───────────────────────────────────────────

function hasEmptyResultMarker(html: string): boolean {
  return /No se encontraron documentos/i.test(html)
}

/**
 * Extrae las filas de documentos reales del HTML completo del panel.
 *
 * Las filas NO están dentro de <table id="tabla"> (esa tabla solo contiene
 * el encabezado); son bloques `<tr onmouseover=...>` sueltos que aparecen
 * después. Ese atributo es exclusivo de filas de datos: no aparece en las
 * subtablas anidadas de "Opciones" ni "Estado".
 */
function extractRows(html: string): string[] {
  const rows: string[] = []
  const starts: number[] = []
  let match: RegExpExecArray | null
  ROW_MARKER_RE.lastIndex = 0
  while ((match = ROW_MARKER_RE.exec(html)) !== null) {
    starts.push(match.index)
  }

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!
    const end = i + 1 < starts.length ? starts[i + 1]! : html.length
    const chunk = html.slice(start, end)
    // Cortar en el cierre real de esta fila, no en el de una subtabla anidada.
    const rowEnd = findMatchingRowEnd(chunk)
    rows.push(rowEnd >= 0 ? chunk.slice(0, rowEnd) : chunk)
  }

  return rows
}

/**
 * Encuentra el `</tr>` que cierra la fila (profundidad 0 de <table> anidada)
 * dentro de un fragmento que empieza en la apertura de un `<tr>`.
 *
 * Genérico — no asume nada específico de paneldte.php, reutilizado también
 * por bandeja-entrada.ts (Panel Correo).
 */
export function findMatchingRowEnd(rowChunk: string): number {
  const tagRe = /<(\/?)(table)\b[^>]*>|<\/tr>/gi
  let tableDepth = 0
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(rowChunk)) !== null) {
    if (m[0].toLowerCase() === "</tr>") {
      if (tableDepth === 0) return m.index + m[0].length
      continue
    }
    if (m[1] === "/") tableDepth = Math.max(0, tableDepth - 1)
    else tableDepth++
  }
  return -1
}

/**
 * Separa un HTML en sus celdas `<td>` de nivel superior, ignorando `<td>` que
 * pertenezcan a subtablas anidadas. Genérico — no asume nada específico de
 * paneldte.php, reutilizado también por bandeja-entrada.ts (Panel Correo).
 */
export function splitTopLevelTdCells(html: string): string[] {
  const cells: string[] = []
  const tagRe = /<(\/?)(td|table)\b[^>]*>/gi
  let tableDepth = 0
  let cellStart = -1
  let m: RegExpExecArray | null

  while ((m = tagRe.exec(html)) !== null) {
    const closing = m[1] === "/"
    const tag = m[2]!.toLowerCase()

    if (tag === "table") {
      tableDepth = closing ? Math.max(0, tableDepth - 1) : tableDepth + 1
      continue
    }

    // tag === "td"
    if (!closing) {
      if (tableDepth === 0) cellStart = m.index + m[0].length
    } else if (tableDepth === 0 && cellStart >= 0) {
      cells.push(html.slice(cellStart, m.index).trim())
      cellStart = -1
    }
  }

  return cells
}

/**
 * Separa una fila de paneldte.php en sus celdas de nivel superior. Antes
 * descarta los <td> divisores (negros, sin contenido) para que los índices
 * resultantes coincidan 1:1 con las columnas documentadas (§ 8) — esa
 * convención de divisores es específica de este panel, por eso no vive en
 * splitTopLevelTdCells().
 */
function extractCells(rowHtml: string): string[] {
  return splitTopLevelTdCells(rowHtml.replace(DIVIDER_TD_RE, ""))
}

function parseRow(cells: string[], codEmp: string): DteDocumentRow | null {
  const cellTexts = cells.map((c) => c.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim())

  // Columna 0: Opciones (iconos PDF, XML, email, etc.)
  // Columna 1: Aceptación SII (puntos de color — no se parsea, ver cabecera del archivo)
  // Columna 2: Fecha
  // Columna 3: Documento (nombre en texto, se resuelve a código)
  // Columna 4: Folio
  // Columna 5: Razón Social
  // Columna 6: Estado (íconos Sii*.png + flag_*.png + Corr*.png)
  // Columna 7: Total Neto
  // Columna 8: Total

  const fecha = parseFechaPortal(cellTexts[2] ?? "")
  if (!fecha) {
    console.warn(`[dte-parser] Fecha no reconocida, fila descartada: "${cellTexts[2]}"`)
    return null
  }

  const folio = parseFolio(cellTexts[4] ?? "")
  if (!folio) {
    console.warn(`[dte-parser] Folio no reconocido, fila descartada: "${cellTexts[4]}"`)
    return null
  }

  const tipoDoc = resolveTipoDocFromText(cellTexts[3] ?? "")
  if (!tipoDoc) {
    console.warn(`[dte-parser] Tipo de documento no reconocido, fila descartada (folio ${folio}): "${cellTexts[3]}"`)
    return null
  }

  const montoNeto = parseMonto(cellTexts[7] ?? "")
  const montoTotal = parseMonto(cellTexts[8] ?? "")
  if (montoTotal === null) {
    console.warn(`[dte-parser] Monto total no reconocido, fila descartada (folio ${folio}): "${cellTexts[8]}"`)
    return null
  }

  const estadoSii = parseEstadoSii(cells[6] ?? "")
  const estadoIntercambio = parseEstadoIntercambio(cells[6] ?? "")
  const pdfUrl = extractPdfPostUrl(cells[0] ?? "")
  const xmlUrl = extractXmlUrl(cells[0] ?? "")
  const rowId = extractRowId(cells[0] ?? "")

  return {
    rowId,
    estadoSii,
    estadoIntercambio,
    fecha,
    tipoDoc,
    folio,
    razonSocial: (cellTexts[5] ?? "").trim(),
    estado: (cellTexts[6] ?? "").trim(),
    montoNeto,
    montoTotal,
    pdfUrl,
    xmlUrl,
    rutEmisor: null, // No visible en la tabla; se resuelve en la Fase 3 vía estadodoc.php
    codEmp: codEmp,
  }
}

function extractTotalDocumentos(html: string): number | null {
  const match = html.match(/tbxTotalDocumentos["'][^>]*value=["'](\d+)["']/i)
  return match ? parseInt(match[1]!, 10) : null
}

function extractPeriodo(html: string): string | null {
  const match = html.match(/<input[^>]*\bname=["']peri["'][^>]*\bvalue=["'](\d{4}-\d{2})["']/i)
  return match ? match[1]! : null
}

/** Decodifica entidades HTML comunes del portal (sin librería externa). */
export function decodeHtmlEntities(text: string): string {
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
}
