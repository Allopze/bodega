/**
 * Invoice data extractor — orchestrates DTE XML, PDF text, and OCR extraction.
 */

import { parseDteXml } from "./dte-parser"
import { decodeXmlBuffer } from "@/lib/services/dte-portal/cached-xml"
import { extractTextFromPdf } from "./pdf-text-extractor"
import { parseInvoiceText, type ParsedInvoiceData } from "./invoice-text-parser"
import { extractInvoiceTextOcr } from "./invoice-ocr"

export type ExtractionMethod = "dte_xml" | "pdf_text" | "pdf_text_ocr" | "ocr" | "manual"

/**
 * Tres cosas distintas que antes viajaban como un solo número llamado
 * "confianza", y que la UI mostraba como "95% confianza" aunque nada estuviera
 * verificado (P1 de la auditoría de OCR 2026-07-30).
 *
 * - `coverage`: cuántos de los campos esperados vinieron. Es presencia, no
 *   veracidad: un folio mal leído cuenta igual que uno correcto.
 * - `engineConfidence`: lo que declara Tesseract sobre su propia lectura. Sólo
 *   existe en las ramas OCR; un DTE XML o un PDF con texto no la tienen.
 * - `totalsConsistent`: si neto + IVA cuadra con el total extraído. Es la única
 *   señal aritmética del documento contra sí mismo.
 *
 * La confianza de *conciliación* (que el documento corresponda a esta OC) no
 * vive aquí: la resuelve el operador línea por línea en el formulario, con el
 * matching de `invoice-item-matching.ts` y el panel de conciliación de la OC.
 */
export interface ExtractionQuality {
  coverage: number
  engineConfidence: number | null
  totalsConsistent: boolean | null
}

export interface ExtractionResult {
  data: ParsedInvoiceData | null
  method: ExtractionMethod
  quality: ExtractionQuality
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
        quality: quality(data, null),
        warnings: getDataWarnings(data),
      })
    }
  }

  // ── 2. PDF text extraction ─────────────────────────────────────────────────
  let pdfTextCandidate: ParsedInvoiceData | null = null
  if (mimeType === "application/pdf") {
    try {
      const { text } = await extractTextFromPdf(fileBuffer)

      // Check if we got meaningful text (more than just whitespace/numbers)
      const meaningfulText = text.replace(/[\s\d\.\,\-\$\%\(\)]/g, "")
      if (meaningfulText.length > 50) {
        const parsed = parseInvoiceText(text)
        if (isUsefulInvoiceData(parsed)) {
          if (parsed.items.length > 0) {
            return extractionResult({
              data: parsed,
              method: "pdf_text",
              quality: quality(parsed, null),
              warnings: getDataWarnings(parsed),
            })
          }
          // Keep good header data, but give OCR a chance to recover the lines.
          pdfTextCandidate = parsed
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
          quality: quality(data, ocrCandidate.engineConfidence),
          warnings: [...warnings, ...getDataWarnings(data)],
        })
      }
      return extractionResult({
        data: ocrCandidate.data,
        method: "ocr",
        quality: quality(ocrCandidate.data, ocrCandidate.engineConfidence),
        warnings: [...warnings, ...getDataWarnings(ocrCandidate.data)],
      })
    }

    if (pdfTextCandidate) {
      return extractionResult({
        data: pdfTextCandidate,
        method: "pdf_text",
        quality: quality(pdfTextCandidate, null),
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
        quality: quality(ocrCandidate.data, ocrCandidate.engineConfidence),
        warnings: [...warnings, ...getDataWarnings(ocrCandidate.data)],
      })
    }
  }

  return extractionResult({ data: null, method: "manual", quality: quality(null, null), warnings })
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

    return { data, engineConfidence: ocrResult.confidence }
  } catch {
    warnings.push("El OCR no pudo procesar el archivo; completa los datos manualmente.")
    return null
  }
}

function extractionResult(result: Required<ExtractionResult>): ExtractionResult {
  // Sin diagnósticos se omite el arreglo vacío; `quality` viaja siempre, porque
  // la UI decide con ella qué pedir que se revise.
  return result.warnings.length > 0
    ? result
    : { data: result.data, method: result.method, quality: result.quality }
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

  // Misma cuenta que `quality.totalsConsistent`: una sola definición de "cuadra"
  // para el aviso al operador y para la señal que viaja al cliente y al log.
  if (totalsConsistent(data) === false) {
    warnings.push("Neto, IVA y total extraídos no cuadran entre sí; confirma los montos.")
  }
  return warnings
}


/**
 * Reúne las tres señales. `pdfTextConfidence` desapareció con esto: era el mismo
 * `coverage` recalculado y comparado contra la confianza del motor, que mide
 * otra cosa.
 */
function quality(data: ParsedInvoiceData | null, engineConfidence: number | null): ExtractionQuality {
  return {
    coverage: data ? fieldCoverage(data) : 0,
    engineConfidence,
    totalsConsistent: data ? totalsConsistent(data) : null,
  }
}

/** null cuando el documento no declara los tres montos: no hay nada que cuadrar. */
function totalsConsistent(data: ParsedInvoiceData): boolean | null {
  if (data.netAmount == null || data.taxAmount == null || data.totalAmount == null) return null
  return Math.abs(data.netAmount + data.taxAmount - data.totalAmount) <= 1
}

/**
 * Proporción de campos esperados que vinieron. Presencia, no veracidad.
 */
function fieldCoverage(data: ParsedInvoiceData): number {
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
