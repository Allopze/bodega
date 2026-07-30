/**
 * Extract text from PDF files using pdfjs-dist.
 * Works for digitally-generated PDFs (not scanned images).
 */

export interface PdfExtractionResult {
  text: string
  pageCount: number
}

/**
 * Extract all text from a PDF buffer.
 * Returns concatenated text from all pages.
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<PdfExtractionResult> {
  // `pdfjs-dist` inicializa APIs de canvas durante la evaluación del módulo.
  // Cargarlo sólo al extraer un PDF evita que una dependencia nativa ausente
  // derribe rutas que no usan este flujo (incluido el render de solicitudes).
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const data = new Uint8Array(buffer)

  const doc = await getDocument({ data }).promise
  const pageCount = doc.numPages
  const textParts = await Promise.all(Array.from({ length: pageCount }, async (_, index) => {
    const page = await doc.getPage(index + 1)
    const content = await page.getTextContent()

    return content.items
      .map((item) => {
        if ("str" in item) return item.str
        return ""
      })
      .join(" ")
  }))

  // Cleanup (destroy may not exist in all pdfjs-dist versions)
  try { await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.() } catch { /* ignore */ }

  return {
    text: textParts.join("\n"),
    pageCount,
  }
}
