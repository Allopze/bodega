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
  // XLSX/ZIP — starts with PK\x03\x04 (XLSX is a zip container; the extension
  // check + exceljs's own structural parsing narrow this down further).
  { mime: "application/zip", bytes: [0x50, 0x4b, 0x03, 0x04] },
]

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
  /** Importaciones: planillas XLSX (contenedor zip) */
  SPREADSHEET: new Set(["application/zip"]),
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
): ValidateFileResult {
  if (size < 4 || buf.length < 4) {
    return { mimeType: "", error: "El archivo está vacío o es demasiado pequeño" }
  }

  // Strip optional UTF-8 BOM before matching
  const content = stripBom(buf)
  const detected = detectMime(content)

  if (!detected) {
    return {
      mimeType: "",
      error: "No se pudo identificar el tipo del archivo. Asegúrate de que sea PDF, JPG, PNG o XML según corresponda.",
    }
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
    case "application/zip":  return "XLSX"
    default:                 return mime
  }
}
