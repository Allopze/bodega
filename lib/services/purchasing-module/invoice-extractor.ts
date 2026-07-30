/**
 * Invoice data extractor — orchestrates DTE XML, PDF text, and OCR extraction.
 */

import { parseDteXml } from "./dte-parser"
import { extractTextFromPdf } from "./pdf-text-extractor"
import { parseInvoiceText, type ParsedInvoiceData } from "./invoice-text-parser"
import { extractInvoiceTextOcr } from "./invoice-ocr"

export type ExtractionMethod = "dte_xml" | "pdf_text" | "pdf_text_ocr" | "ocr" | "manual"

export interface ExtractionResult {
  data: ParsedInvoiceData | null
  method: ExtractionMethod
  confidence: number
  /** Non-blocking evidence gaps that the form must show to the operator. */
  warnings?: string[]
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
  const warnings: string[] = []

  // ── 1. DTE XML ────────────────────────────────────────────────────────────
  if (mimeType === "application/xml" || mimeType === "text/xml" || fileName.endsWith(".xml")) {
    const xmlString = decodeXmlBuffer(fileBuffer)
    const dteData = parseDteXml(xmlString)
    if (dteData) {
      const data: ParsedInvoiceData = {
        invoiceNumber: dteData.invoiceNumber,
        issueDate: dteData.issueDate,
        totalAmount: dteData.totalAmount,
        netAmount: dteData.netAmount,
        taxAmount: dteData.taxAmount,
        supplierName: dteData.supplierName,
        supplierRut: dteData.supplierRut,
        items: dteData.items.map((item) => ({
          productName: item.productName,
          productCode: item.productCode,
          unitOfMeasure: item.unitOfMeasure,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.amount,
        })),
      }
      return extractionResult({
        data,
        method: "dte_xml",
        confidence: 0.95,
        warnings: getDataWarnings(data),
      })
    }
  }

  // ── 2. PDF text extraction ─────────────────────────────────────────────────
  let pdfTextCandidate: ParsedInvoiceData | null = null
  let pdfTextConfidence = 0
  if (mimeType === "application/pdf") {
    try {
      const { text } = await extractTextFromPdf(fileBuffer)

      // Check if we got meaningful text (more than just whitespace/numbers)
      const meaningfulText = text.replace(/[\s\d\.\,\-\$\%\(\)]/g, "")
      if (meaningfulText.length > 50) {
        const parsed = parseInvoiceText(text)
        const confidence = calculateConfidence(parsed)
        if (isUsefulInvoiceData(parsed)) {
          if (parsed.items.length > 0) {
            return extractionResult({
              data: parsed,
              method: "pdf_text",
              confidence,
              warnings: getDataWarnings(parsed),
            })
          }
          // Keep good header data, but give OCR a chance to recover the lines.
          pdfTextCandidate = parsed
          pdfTextConfidence = confidence
          warnings.push("El texto del PDF permitió identificar la cabecera, pero no sus líneas; se intentó OCR adicional.")
        } else {
          warnings.push("El texto del PDF no contenía una factura verificable; se intentó OCR.")
        }
      } else {
        warnings.push("El PDF no contiene texto seleccionable suficiente; se intentó OCR.")
      }
    } catch {
      warnings.push("No se pudo leer el texto interno del PDF; se intentó OCR.")
    }

    // ── 3. OCR fallback for scanned PDFs ────────────────────────────────────
    const ocrCandidate = await extractOcrCandidate(fileBuffer, warnings)
    if (ocrCandidate) {
      if (pdfTextCandidate) {
        const data = mergeInvoiceData(pdfTextCandidate, ocrCandidate.data)
        return extractionResult({
          data,
          method: "pdf_text_ocr",
          confidence: Math.min(pdfTextConfidence, ocrCandidate.confidence),
          warnings: [...warnings, ...getDataWarnings(data)],
        })
      }
      return extractionResult({
        data: ocrCandidate.data,
        method: "ocr",
        confidence: ocrCandidate.confidence,
        warnings: [...warnings, ...getDataWarnings(ocrCandidate.data)],
      })
    }

    if (pdfTextCandidate) {
      return extractionResult({
        data: pdfTextCandidate,
        method: "pdf_text",
        confidence: pdfTextConfidence,
        warnings: [...warnings, ...getDataWarnings(pdfTextCandidate)],
      })
    }
  }

  // ── 4. Image OCR ──────────────────────────────────────────────────────────
  if (mimeType === "image/jpeg" || mimeType === "image/png") {
    const ocrCandidate = await extractOcrCandidate(fileBuffer, warnings)
    if (ocrCandidate) {
      return extractionResult({
        data: ocrCandidate.data,
        method: "ocr",
        confidence: ocrCandidate.confidence,
        warnings: [...warnings, ...getDataWarnings(ocrCandidate.data)],
      })
    }
  }

  return extractionResult({ data: null, method: "manual", confidence: 0, warnings })
}

async function extractOcrCandidate(fileBuffer: Buffer, warnings: string[]) {
  try {
    const ocrResult = await extractInvoiceTextOcr(fileBuffer)
    if (ocrResult.warning) warnings.push(`OCR: ${ocrResult.warning}`)
    if (!ocrResult.text || ocrResult.confidence <= 0.4) {
      warnings.push("El OCR no produjo texto con confianza suficiente para completar la factura.")
      return null
    }

    const data = parseInvoiceText(ocrResult.text)
    if (!isUsefulInvoiceData(data)) {
      warnings.push("El OCR no identificó folio, fecha y total verificables; completa los datos manualmente.")
      return null
    }

    return {
      data,
      confidence: Math.min(ocrResult.confidence, calculateConfidence(data)),
    }
  } catch {
    warnings.push("El OCR no pudo procesar el archivo; completa los datos manualmente.")
    return null
  }
}

function extractionResult(result: Required<ExtractionResult>): ExtractionResult {
  // Keep the legacy, concise manual result when no extraction attempt produced
  // a diagnostic; callers that need to surface warnings get them explicitly.
  return result.warnings.length > 0
    ? result
    : { data: result.data, method: result.method, confidence: result.confidence }
}

function isUsefulInvoiceData(data: ParsedInvoiceData) {
  return Boolean(data.invoiceNumber && data.issueDate && data.totalAmount && data.totalAmount > 0)
}

function mergeInvoiceData(header: ParsedInvoiceData, ocr: ParsedInvoiceData): ParsedInvoiceData {
  return {
    invoiceNumber: header.invoiceNumber ?? ocr.invoiceNumber,
    issueDate: header.issueDate ?? ocr.issueDate,
    totalAmount: header.totalAmount ?? ocr.totalAmount,
    netAmount: header.netAmount ?? ocr.netAmount,
    taxAmount: header.taxAmount ?? ocr.taxAmount,
    supplierName: header.supplierName ?? ocr.supplierName,
    supplierRut: header.supplierRut ?? ocr.supplierRut,
    items: ocr.items.length > 0 ? ocr.items : header.items,
  }
}

function getDataWarnings(data: ParsedInvoiceData) {
  const warnings: string[] = []
  if (data.items.length === 0) {
    warnings.push("No se detectaron líneas de detalle; revisa la factura antes de adjuntarla.")
  } else if (data.items.some((item) => !item.unitOfMeasure)) {
    warnings.push("Una o más líneas no declaran unidad en el documento; no se completó con la unidad de la OC.")
  }

  if (data.netAmount != null && data.taxAmount != null && data.totalAmount != null) {
    const difference = Math.abs(data.netAmount + data.taxAmount - data.totalAmount)
    if (difference > 1) warnings.push("Neto, IVA y total extraídos no cuadran entre sí; confirma los montos.")
  }
  return warnings
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
