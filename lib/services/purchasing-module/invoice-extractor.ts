/**
 * Invoice data extractor — orchestrates DTE XML, PDF text, and OCR extraction.
 */

import { parseDteXml } from "./dte-parser"
import { extractTextFromPdf } from "./pdf-text-extractor"
import { parseInvoiceText, type ParsedInvoiceData } from "./invoice-text-parser"
import { extractInvoiceTextOcr } from "./invoice-ocr"

export type ExtractionMethod = "dte_xml" | "pdf_text" | "ocr" | "manual"

export interface ExtractionResult {
  data: ParsedInvoiceData | null
  method: ExtractionMethod
  confidence: number
}

/**
 * Extract invoice data from a file buffer.
 * Tries methods in order: DTE XML → PDF text → OCR → manual.
 */
export async function extractInvoiceData(
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<ExtractionResult> {
  // ── 1. DTE XML ────────────────────────────────────────────────────────────
  if (mimeType === "application/xml" || mimeType === "text/xml" || fileName.endsWith(".xml")) {
    const xmlString = decodeXmlBuffer(fileBuffer)
    const dteData = parseDteXml(xmlString)
    if (dteData) {
      return {
        data: {
          invoiceNumber: dteData.invoiceNumber,
          issueDate: dteData.issueDate,
          totalAmount: dteData.totalAmount,
          netAmount: dteData.netAmount,
          taxAmount: dteData.taxAmount,
          supplierName: dteData.supplierName,
          supplierRut: dteData.supplierRut,
          items: dteData.items.map((item) => ({
            productName: item.productName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.amount,
          })),
        },
        method: "dte_xml",
        confidence: 0.95,
      }
    }
  }

  // ── 2. PDF text extraction ─────────────────────────────────────────────────
  if (mimeType === "application/pdf") {
    try {
      const { text } = await extractTextFromPdf(fileBuffer)

      // Check if we got meaningful text (more than just whitespace/numbers)
      const meaningfulText = text.replace(/[\s\d\.\,\-\$\%\(\)]/g, "")
      if (meaningfulText.length > 50) {
        const parsed = parseInvoiceText(text)
        const confidence = calculateConfidence(parsed)
        if (confidence > 0.3) {
          return { data: parsed, method: "pdf_text", confidence }
        }
      }
    } catch {
      // PDF text extraction failed, fall through to OCR
    }

    // ── 3. OCR fallback for scanned PDFs ────────────────────────────────────
    try {
      const ocrResult = await extractInvoiceTextOcr(fileBuffer)
      if (ocrResult.text && ocrResult.confidence > 0.4) {
        const parsed = parseInvoiceText(ocrResult.text)
        const confidence = Math.min(ocrResult.confidence, calculateConfidence(parsed))
        return { data: parsed, method: "ocr", confidence }
      }
    } catch {
      // OCR failed
    }
  }

  // ── 4. Image OCR ──────────────────────────────────────────────────────────
  if (mimeType === "image/jpeg" || mimeType === "image/png") {
    try {
      const ocrResult = await extractInvoiceTextOcr(fileBuffer)
      if (ocrResult.text && ocrResult.confidence > 0.4) {
        const parsed = parseInvoiceText(ocrResult.text)
        const confidence = Math.min(ocrResult.confidence, calculateConfidence(parsed))
        return { data: parsed, method: "ocr", confidence }
      }
    } catch {
      // OCR failed
    }
  }

  return { data: null, method: "manual", confidence: 0 }
}

function decodeXmlBuffer(buffer: Buffer): string {
  // XML declarations are ASCII-compatible, so inspect them as latin1 first.
  // Chilean DTEs frequently declare ISO-8859-1; UTF-8 decoding them corrupts
  // supplier/product names before the parser sees them.
  const declaration = buffer.toString("latin1", 0, Math.min(buffer.length, 1024))
  const encoding = declaration.match(/<\?xml[^>]*encoding=["']([^"']+)["']/i)?.[1]?.toLowerCase()
  if (encoding && /^(iso-8859-1|iso8859-1|latin-?1|windows-1252)$/i.test(encoding)) {
    return buffer.toString("latin1")
  }
  return buffer.toString("utf8")
}

/**
 * Calculate extraction confidence based on how many fields were found.
 */
function calculateConfidence(data: ParsedInvoiceData): number {
  let score = 0
  let total = 0

  // Invoice number is essential
  total += 3
  if (data.invoiceNumber) score += 3

  // Date is important
  total += 2
  if (data.issueDate) score += 2

  // Total amount is important
  total += 3
  if (data.totalAmount && data.totalAmount > 0) score += 3

  // Items are nice to have
  total += 2
  if (data.items.length > 0) score += 2

  return total > 0 ? score / total : 0
}
