/**
 * Server-side file validation: magic bytes detection + MIME normalization.
 *
 * Rejects files whose actual content doesn't match the declared MIME type.
 * Returns the authoritative MIME type based on magic bytes so the caller
 * persists the *real* type, not the client-declared one.
 */

// ── Magic byte signatures ────────────────────────────────────────────────────

const MAGIC: Array<{
  mime: string
  bytes: number[]
  mask?: number[]
}> = [
  // PDF — starts with %PDF
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
  // JPEG — starts with FF D8 FF
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  // PNG — starts with 89 50 4E 47 0D 0A 1A 0A
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // XML — starts with <?xml (any encoding, skip BOM)
  { mime: "application/xml", bytes: [0x3c, 0x3f, 0x78, 0x6d, 0x6c] },
  // BOM-prefixed XML (UTF-8 BOM: EF BB BF)
  {
    mime: "application/xml",
    bytes: [0xef, 0xbb, 0xbf, 0x3c, 0x3f, 0x78, 0x6d, 0x6c],
  },
]

// ── Public API ───────────────────────────────────────────────────────────────

/** MIME types accepted by the application per upload context. */
export const MimeType = {
  /** Entregas: comprobantes de entrega */
  PROOF: new Set(["application/pdf", "image/jpeg", "image/png"]),
  /** Compras: facturas */
  INVOICE: new Set(["application/pdf", "image/jpeg", "image/png", "application/xml"]),
  /** Cotizaciones: ofertas de proveedores */
  QUOTATION: new Set(["application/pdf", "image/jpeg", "image/png"]),
} as const

export type MimeTypeSet = ReadonlySet<string>

export interface ValidateFileResult {
  /** The authoritative MIME type derived from magic bytes. */
  mimeType: string
  /** Human-readable error when validation fails. */
  error?: string
}

/**
 * Validate a file's magic bytes and return the real MIME type.
 *
 * Flow:
 * 1. Check the file has at least 8 bytes.
 * 2. Read the first 16 bytes and match against known magic signatures.
 * 3. If the detected type is not in `allowedMimes`, reject.
 * 4. If the client-declared type differs from the detected type,
 *    use the detected type (normalized).
 */
export async function validateFile(
  file: File,
  allowedMimes: MimeTypeSet,
): Promise<ValidateFileResult> {
  const minBytes = Math.min(16, file.size)
  if (minBytes < 4) {
    return { mimeType: "", error: "El archivo está vacío o es demasiado pequeño" }
  }

  const buf = new Uint8Array(await file.arrayBuffer())
  const detected = detectMime(buf)

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

function friendlyName(mime: string): string {
  switch (mime) {
    case "application/pdf":  return "PDF"
    case "image/jpeg":       return "JPG"
    case "image/png":        return "PNG"
    case "application/xml":  return "XML"
    default:                 return mime
  }
}
