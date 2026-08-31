/**
 * Server-side file validation: magic bytes detection + MIME normalization.
 *
 * Rejects files whose actual content doesn't match the declared MIME type.
 * Returns the authoritative MIME type based on magic bytes so the caller
 * persists the *real* type, not the client-declared one.
 *
 * IMPORTANT: Callers should read the file into a buffer ONCE and pass it to
 * both validateFile() and the disk write to avoid double memory allocation.
 */

// ── Magic byte signatures ────────────────────────────────────────────────────

const MAGIC: Array<{ mime: string; bytes: number[] }> = [
  // PDF — starts with %PDF
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
  // JPEG — starts with FF D8 FF
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  // PNG — starts with 89 50 4E 47 0D 0A 1A 0A
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // XML — starts with <?xml (after optional UTF-8 BOM EF BB BF)
  { mime: "application/xml", bytes: [0x3c, 0x3f, 0x78, 0x6d, 0x6c] },
  // Excel/ZIP — starts with PK\x03\x04 (Excel is a zip container; the extension
  // check + exceljs's own structural parsing narrow this down further).
  { mime: "application/zip", bytes: [0x50, 0x4b, 0x03, 0x04] },
  // Contenedor compuesto OLE/CFB usado por Excel 97-2003 (.xls).
  { mime: "application/x-ole-storage", bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
]

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const XLS_MIME = "application/vnd.ms-excel"

// ── Public API ───────────────────────────────────────────────────────────────

/** MIME types accepted by the application per upload context. */
export const MimeType = {
  /** Evidencia de terreno TAE */
  IMAGE: new Set(["image/jpeg", "image/png"]),
  /** Entregas: comprobantes de entrega */
  PROOF: new Set(["application/pdf", "image/jpeg", "image/png"]),
  /** Compras: facturas (PDF, images, XML) */
  INVOICE: new Set(["application/pdf", "image/jpeg", "image/png", "application/xml"]),
  /** Cotizaciones: ofertas de proveedores */
  QUOTATION: new Set(["application/pdf", "image/jpeg", "image/png"]),
  /** Importaciones: planillas Excel (contenedor zip) */
  SPREADSHEET: new Set(["application/zip"]),
  /** Formularios Office oficiales, siempre almacenados como descarga. */
  OFFICE: new Set([DOCX_MIME, XLSX_MIME, XLS_MIME]),
  /** Biblioteca documental SST: formatos históricos más Office validado. */
  DOCUMENT_LIBRARY: new Set([
    "application/pdf", "image/jpeg", "image/png", "application/xml",
    DOCX_MIME, XLSX_MIME, XLS_MIME,
  ]),
  /** Evidencia de una ejecución: escaneo, fotografía u original Office. */
  INSPECTION_DOCUMENT: new Set([
    "application/pdf", "image/jpeg", "image/png", DOCX_MIME, XLSX_MIME, XLS_MIME,
  ]),
} as const

export type MimeTypeSet = ReadonlySet<string>

export interface ValidateFileResult {
  /** The authoritative MIME type derived from magic bytes. */
  mimeType: string
  /** Human-readable error when validation fails. */
  error?: string
}

/**
 * Validate a file buffer's magic bytes and return the real MIME type.
 *
 * @param buf     The file contents as a Uint8Array (caller reads once).
 * @param size    Original file size in bytes (for empty check).
 * @param allowedMimes  Set of MIME types permitted for this upload context.
 *
 * Flow:
 * 1. Check the file has at least 4 bytes.
 * 2. Strip optional UTF-8 BOM, then match against known magic signatures.
 * 3. If the detected type is not in `allowedMimes`, reject.
 * 4. Return the detected (normalized) MIME type.
 */
export function validateFileBuffer(
  buf: Uint8Array,
  size: number,
  allowedMimes: MimeTypeSet,
  fileName?: string,
): ValidateFileResult {
  if (size < 4 || buf.length < 4) {
    return { mimeType: "", error: "El archivo está vacío o es demasiado pequeño" }
  }

  // Strip optional UTF-8 BOM before matching
  const content = stripBom(buf)
  let detected = detectMime(content)

  if (!detected) {
    return {
      mimeType: "",
      error: "No se pudo identificar el tipo del archivo. Asegúrate de que sea PDF, JPG, PNG o XML según corresponda.",
    }
  }

  const acceptsOffice = allowedMimes.has(DOCX_MIME) || allowedMimes.has(XLSX_MIME) || allowedMimes.has(XLS_MIME)
  if (acceptsOffice && detected === "application/zip") {
    const office = inspectOoxmlPackage(content, fileName)
    if (office.error) return office
    detected = office.mimeType
  } else if (acceptsOffice && detected === "application/x-ole-storage") {
    const legacy = inspectLegacyExcel(content, fileName)
    if (legacy.error) return legacy
    detected = legacy.mimeType
  }

  if (!allowedMimes.has(detected)) {
    return { mimeType: "", error: `Tipo de archivo no permitido: ${friendlyName(detected)}` }
  }

  return { mimeType: detected }
}

// ── Internals ────────────────────────────────────────────────────────────────

/** Strip UTF-8 BOM (EF BB BF) if present. */
function stripBom(buf: Uint8Array): Uint8Array {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3)
  }
  return buf
}

function detectMime(buf: Uint8Array): string | null {
  for (const sig of MAGIC) {
    if (matchesSignature(buf, sig.bytes)) {
      return sig.mime
    }
  }
  return null
}

function extensionOf(fileName: string | undefined): string {
  const normalized = fileName?.trim().toLowerCase() ?? ""
  const dot = normalized.lastIndexOf(".")
  return dot >= 0 ? normalized.slice(dot) : ""
}

/**
 * Lee sólo el directorio central: no ejecuta ni extrae el Office. Esto basta
 * para verificar el tipo real, cifrado, macros, objetos embebidos y rutas.
 */
function inspectOoxmlPackage(buf: Uint8Array, fileName?: string): ValidateFileResult {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const minEocd = Math.max(0, buf.length - 65_557)
  let eocd = -1
  for (let offset = buf.length - 22; offset >= minEocd; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break }
  }
  if (eocd < 0) return { mimeType: "", error: "El archivo Office no contiene un directorio ZIP válido" }

  const entries = view.getUint16(eocd + 10, true)
  const centralSize = view.getUint32(eocd + 12, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  if (entries < 1 || entries > 10_000 || centralOffset + centralSize > buf.length) {
    return { mimeType: "", error: "El archivo Office tiene una estructura ZIP inválida" }
  }

  const decoder = new TextDecoder("utf-8", { fatal: false })
  const names = new Set<string>()
  let totalUncompressed = 0
  let offset = centralOffset
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > buf.length || view.getUint32(offset, true) !== 0x02014b50) {
      return { mimeType: "", error: "El archivo Office contiene una entrada ZIP inválida" }
    }
    const flags = view.getUint16(offset + 8, true)
    const compressed = view.getUint32(offset + 20, true)
    const uncompressed = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    if ((flags & 0x0001) !== 0) return { mimeType: "", error: "No se permiten archivos Office cifrados" }
    if (offset + 46 + nameLength + extraLength + commentLength > buf.length) {
      return { mimeType: "", error: "El archivo Office contiene una entrada truncada" }
    }
    const name = decoder.decode(buf.subarray(offset + 46, offset + 46 + nameLength)).replaceAll("\\", "/")
    const lower = name.toLowerCase()
    if (!name || name.includes("\0") || name.startsWith("/") || name.split("/").includes("..")) {
      return { mimeType: "", error: "El archivo Office contiene una ruta interna insegura" }
    }
    if (/(^|\/)(vbaproject\.bin|activex\/|embeddings\/)|\.(exe|dll|js|vbs|bat|cmd|com|scr)$/i.test(lower)) {
      return { mimeType: "", error: "No se permiten macros, objetos embebidos ni ejecutables en archivos Office" }
    }
    totalUncompressed += uncompressed
    if (totalUncompressed > 100 * 1024 * 1024 || (compressed > 0 && uncompressed / compressed > 1_000)) {
      return { mimeType: "", error: "El archivo Office supera los límites seguros de descompresión" }
    }
    names.add(lower)
    offset += 46 + nameLength + extraLength + commentLength
  }

  if (!names.has("[content_types].xml") || !names.has("_rels/.rels")) {
    return { mimeType: "", error: "El archivo no es un paquete Office Open XML válido" }
  }
  const hasWord = names.has("word/document.xml")
  const hasExcel = names.has("xl/workbook.xml")
  if (hasWord === hasExcel) return { mimeType: "", error: "No se pudo determinar si el archivo Office es Word o Excel" }

  const mimeType = hasWord ? DOCX_MIME : XLSX_MIME
  const expectedExtension = hasWord ? ".docx" : ".xlsx"
  if (extensionOf(fileName) !== expectedExtension) {
    return { mimeType: "", error: `El contenido del archivo no coincide con la extensión ${extensionOf(fileName) || "ausente"}` }
  }
  return { mimeType }
}

function inspectLegacyExcel(buf: Uint8Array, fileName?: string): ValidateFileResult {
  if (extensionOf(fileName) !== ".xls") {
    return { mimeType: "", error: "El contenido OLE sólo se admite como planilla .xls" }
  }
  // Los nombres del directorio CFB se almacenan en UTF-16LE. Exigir Workbook
  // o Book evita aceptar cualquier contenedor OLE renombrado a .xls.
  const workbook = new TextEncoder().encode("W\0o\0r\0k\0b\0o\0o\0k\0")
  const book = new TextEncoder().encode("B\0o\0o\0k\0")
  const contains = (needle: Uint8Array) => {
    outer: for (let i = 0; i <= buf.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) if (buf[i + j] !== needle[j]) continue outer
      return true
    }
    return false
  }
  if (!contains(workbook) && !contains(book)) {
    return { mimeType: "", error: "El contenedor .xls no contiene un libro de Excel reconocible" }
  }
  return { mimeType: XLS_MIME }
}

function matchesSignature(buf: Uint8Array, signature: number[]): boolean {
  if (buf.length < signature.length) return false
  for (let i = 0; i < signature.length; i++) {
    if (buf[i] !== signature[i]) return false
  }
  return true
}

export function friendlyName(mime: string): string {
  switch (mime) {
    case "application/pdf":  return "PDF"
    case "image/jpeg":       return "JPG"
    case "image/png":        return "PNG"
    case "application/xml":  return "XML"
    case "application/zip":  return "Excel"
    case DOCX_MIME: return "Word (.docx)"
    case XLSX_MIME: return "Excel (.xlsx)"
    case XLS_MIME: return "Excel (.xls)"
    case "application/x-ole-storage": return "contenedor Office antiguo"
    default:                 return mime
  }
}
