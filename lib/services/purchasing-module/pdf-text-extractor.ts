/**
 * Extract text from PDF files using pdfjs-dist.
 * Works for digitally-generated PDFs (not scanned images).
 */

// El build por defecto de pdfjs-dist asume APIs de navegador y revienta con
// "DOMMatrix is not defined" al cargarse bajo Node — la propia librería avisa
// "Please use the `legacy` build in Node.js environments". Esto corre en el
// servidor, así que va el build legacy.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"

export interface PdfExtractionResult {
  text: string
  pageCount: number
}

/**
 * Extract all text from a PDF buffer.
 * Returns concatenated text from all pages.
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<PdfExtractionResult> {
  const data = new Uint8Array(buffer)

  const doc = await getDocument({ data }).promise
  const pageCount = doc.numPages
  const textParts: string[] = []

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()

    const pageText = content.items
      .map((item) => {
        if ("str" in item) return item.str
        return ""
      })
      .join(" ")

    textParts.push(pageText)
  }

  // Cleanup (destroy may not exist in all pdfjs-dist versions)
  try { await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.() } catch { /* ignore */ }

  return {
    text: textParts.join("\n"),
    pageCount,
  }
}
