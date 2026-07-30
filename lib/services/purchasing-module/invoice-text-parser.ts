/**
 * Parse extracted text from invoices to find structured data.
 * Works with both PDF text extraction and OCR output.
 */

export interface ParsedInvoiceData {
  invoiceNumber: string | null
  issueDate: string | null
  totalAmount: number | null
  netAmount: number | null
  taxAmount: number | null
  supplierName: string | null
  supplierRut: string | null
  items: ParsedInvoiceItem[]
}

export interface ParsedInvoiceItem {
  productName: string
  productCode: string | null
  /** Null when the invoice does not declare a document unit. */
  unitOfMeasure: string | null
  quantity: number
  unitPrice: number
  amount: number
}

/**
 * Parse invoice text to extract structured data.
 * Uses regex patterns common in Chilean and international invoices.
 */
export function parseInvoiceText(text: string): ParsedInvoiceData {
  // Headers are easier to identify in compact text, but the table parser
  // needs actual row boundaries. Keep both representations.
  const normalized = text.replace(/\s+/g, " ").trim()

  return {
    invoiceNumber: extractInvoiceNumber(normalized),
    issueDate: extractDate(normalized),
    totalAmount: extractTotalAmount(normalized),
    netAmount: extractNetAmount(normalized),
    taxAmount: extractTaxAmount(normalized),
    supplierName: extractSupplierName(normalized),
    supplierRut: extractRut(normalized),
    items: extractItems(text),
  }
}

// ── Invoice Number ────────────────────────────────────────────────────────────

function extractInvoiceNumber(text: string): string | null {
  const patterns = [
    /Factura\s*(?:N[°º]|No\.?|#)\s*:?\s*(\d[\d\-\.]*)/i,
    /Factura\s+Electr[óo]nica\s*(?:N[°º]|No\.?|#)\s*:?\s*(\d[\d\-\.]*)/i,
    /Folio\s*:?\s*(\d[\d\-\.]*)/i,
    /Invoice\s*(?:Number|No\.?|#)\s*:?\s*(\d[\d\-\.]*)/i,
    /Boleta\s*(?:N[°º]|No\.?|#)\s*:?\s*(\d[\d\-\.]*)/i,
    /N[°º]\s*(?:de\s*)?(?:Factura|Boleta|Documento)\s*:?\s*(\d[\d\-\.]*)/i,
    // Crystal Reports and similar renderers frequently output the folio before
    // the document title: “Nº 3064428 R.U.T.”.
    /N[°º]\s*(\d{4,})\s+R\.?U\.?T\.?/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1].trim()
  }
  return null
}

// ── Date ──────────────────────────────────────────────────────────────────────

function extractDate(text: string): string | null {
  const patterns = [
    // DD/MM/YYYY or DD-MM-YYYY
    /(?:Fecha\s*(?:de\s*)?(?:Emisi[óo]n|Emision|Emisión)?)\s*:?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/i,
    // YYYY-MM-DD
    /(?:Fecha\s*(?:de\s*)?(?:Emisi[óo]n|Emision|Emisión)?)\s*:?\s*(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/i,
    // Date: DD/MM/YYYY
    /Date\s*:?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/i,
    // Standalone DD/MM/YYYY near "fecha" or "date"
    /(?:fecha|date)\s*[:\s]*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/i,
    // Values can be emitted several visual cells after their label.
    /Fecha\s+de\s+Emisi[óo]n[\s:\p{L}]{0,48}?(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/iu,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      // Determine format based on group positions
      if (match[0].includes(match[1]!) && match[1]!.length === 4) {
        // YYYY-MM-DD
        return `${match[1]}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}`
      }
      // DD/MM/YYYY
      return `${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}`
    }
  }
  return null
}

// ── Amounts ───────────────────────────────────────────────────────────────────

function extractTotalAmount(text: string): number | null {
  const crystalTotals = extractCrystalTotals(text)
  if (crystalTotals) return crystalTotals.total
  const patterns = [
    /Total\s*(?:a\s*pagar|factura|documento)?\s*:?\s*\$?\s*([\d\.\,]+)/i,
    /Monto\s*Total\s*:?\s*\$?\s*([\d\.\,]+)/i,
    /Amount\s*Due\s*:?\s*\$?\s*([\d\.\,]+)/i,
    /Total\s*:?\s*\$?\s*([\d\.\,]+)/i,
    /Total\s*Amount\s*:?\s*\$?\s*([\d\.\,]+)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return parseChileanNumber(match[1])
  }
  return null
}

function extractNetAmount(text: string): number | null {
  const crystalTotals = extractCrystalTotals(text)
  if (crystalTotals) return crystalTotals.net
  const patterns = [
    /Neto\s*:?\s*\$?\s*([\d\.\,]+)/i,
    /Monto\s*Neto\s*:?\s*\$?\s*([\d\.\,]+)/i,
    /Sub\s*Total\s*:?\s*\$?\s*([\d\.\,]+)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return parseChileanNumber(match[1])
  }
  return null
}

function extractTaxAmount(text: string): number | null {
  const crystalTotals = extractCrystalTotals(text)
  if (crystalTotals) return crystalTotals.tax
  const patterns = [
    /IVA\s*(?:\(?\d+\%?\)?)?\s*:?\s*\$?\s*([\d\.\,]+)/i,
    /Impuesto\s*:?\s*\$?\s*([\d\.\,]+)/i,
    /Tax\s*:?\s*\$?\s*([\d\.\,]+)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return parseChileanNumber(match[1])
  }
  return null
}

// ── Supplier ──────────────────────────────────────────────────────────────────

function extractSupplierName(text: string): string | null {
  const patterns = [
    /(?:Raz[oó]n\s*Social|Empresa|Proveedor|Supplier|Vendor)\s*:?\s*(.{5,80}?)(?:\s*(?:RUT|NIT|RFC|Date|Fecha|Folio))/i,
    /(?:Emisor|Issued\s*by|From)\s*:?\s*(.{5,80}?)(?:\s*(?:RUT|NIT|RFC|Date|Fecha))/i,
    /\b([A-Z][A-Z .&-]{2,80}(?:S\.?A\.?|SPA|LTDA\.?))\s+GIRO\s*:/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return cleanSupplierName(match[1])
  }
  return null
}

function cleanSupplierName(value: string) {
  const trimmed = value.trim()
  // In a flattened document header, branch addresses may precede an all-caps
  // legal name. Prefer the final legal-name token sequence before its suffix.
  return trimmed.match(/([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .&-]{1,48}(?:S\.?A\.?|SPA|LTDA\.?)$)/)?.[1]?.trim() ?? trimmed
}

function extractRut(text: string): string | null {
  const patterns = [
    /RUT\s*:?\s*(\d{1,2}\.\d{3}\.\d{3}\-[\dkK])/i,
    /RUT\s*:?\s*(\d{7,8}\-[\dkK])/i,
    /R\.?\s*U\.?\s*T\.?\s*:?\s*(\d{1,2}\.\d{3}\.\d{3}\-[\dkK])/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1].trim()
  }
  return null
}

// ── Line Items ────────────────────────────────────────────────────────────────

function extractItems(text: string): ParsedInvoiceItem[] {
  const items: ParsedInvoiceItem[] = []

  // Try to find table-like structures with quantities and prices
  // Common patterns in Chilean invoices:
  //   Description  Qty  Unit Price  Amount
  //   Product A     10   $10.000     $100.000

  // Split by lines and look for item-like patterns
  const lines = text.replace(/\r/g, "").split(/\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (isInvoiceSummaryLine(trimmed)) continue

    // Pattern: text followed by numbers (qty, price, amount)
    const itemMatch = trimmed.match(
      /^(.{5,60}?)\s+(\d+(?:\.\d+)?)\s+\$?\s*([\d\.\,]+)\s+\$?\s*([\d\.\,]+)/
    )
    if (itemMatch) {
      const [, productName, qtyStr, priceStr, amountStr] = itemMatch
      const quantity = parseFloat(qtyStr ?? "0")
      const unitPrice = parseChileanNumber(priceStr ?? "0")
      const amount = parseChileanNumber(amountStr ?? "0")

      if (quantity > 0 && unitPrice > 0) {
        items.push({
          productName: productName!.trim(),
          productCode: null,
          unitOfMeasure: extractUnit(productName!),
          quantity,
          unitPrice,
          amount: amount || quantity * unitPrice,
        })
      }
    }

    // Column order emitted by Crystal Reports: price, total, quantity,
    // description and optional product code. This is the layout in
    // DOC-33-3064428.pdf.
    const crystalMatch = trimmed.match(
      /(?:^|\s)([\d.]+(?:,[\d]+)?)\s+([\d.]+(?:,[\d]+)?)\s+(\d+(?:[,.]\d+)?)\s+(.{5,140}?)(?:\s+([A-Z0-9][A-Z0-9-]{4,}))?\s*$/i,
    )
    if (crystalMatch) {
      const [, priceStr, amountStr, qtyStr, rawName, productCode] = crystalMatch
      const quantity = parseDecimal(qtyStr ?? "0")
      const unitPrice = parseChileanNumber(priceStr ?? "0")
      const amount = parseChileanNumber(amountStr ?? "0")
      const productName = rawName?.trim() ?? ""
      if (productName && quantity > 0 && unitPrice > 0 && approximatelyEquals(quantity * unitPrice, amount)) {
        const identified = identifyProductCode(productName, productCode)
        items.push({
          productName: identified.productName,
          productCode: identified.productCode,
          unitOfMeasure: extractUnit(productName),
          quantity,
          unitPrice,
          amount,
        })
      }
    }
  }

  // PDF text extractors may deliver the entire table as one visual line. The
  // same layout is recognized without requiring a newline.
  if (items.length === 0) {
    const compact = text.replace(/\s+/g, " ")
    const crystalMatch = compact.match(/(?:^|\s)([\d.]+(?:,[\d]+)?)\s+([\d.]+(?:,[\d]+)?)\s+(\d+(?:[,.]\d+)?)\s+(.{5,140}?)\s+(?:Total\s+Neto|Total\s+Exento|Subtotal)/i)
    if (crystalMatch) {
      const [, priceStr, amountStr, qtyStr, rawName] = crystalMatch
      const quantity = parseDecimal(qtyStr ?? "0")
      const unitPrice = parseChileanNumber(priceStr ?? "0")
      const amount = parseChileanNumber(amountStr ?? "0")
      const productName = rawName?.trim() ?? ""
      if (productName && quantity > 0 && unitPrice > 0 && approximatelyEquals(quantity * unitPrice, amount)) {
        const identified = identifyProductCode(productName)
        items.push({ productName: identified.productName, productCode: identified.productCode, unitOfMeasure: extractUnit(identified.productName), quantity, unitPrice, amount })
      }
    }
  }

  return items
}

function extractCrystalTotals(text: string): { net: number; tax: number; total: number } | null {
  const match = text.match(/Total\s+Neto\s+Descuento\s+I\.?V\.?A\.?\s*\(?19%?\)?\s+Total[\s\S]{0,260}?(\d[\d.,]*)\s+(\d[\d.,]*)\s+(\d[\d.,]*)/i)
  if (!match) return null
  const net = parseChileanNumber(match[1] ?? "0")
  const tax = parseChileanNumber(match[2] ?? "0")
  const total = parseChileanNumber(match[3] ?? "0")
  return net > 0 && total >= net ? { net, tax, total } : null
}

function extractUnit(value: string): string | null {
  const unit = value.match(/(?:^|\s)(UN|UND|UNIDAD|PAR|KG|KGS|GR|G|LT|LTS|L|MT|MTS|M2|M3)(?:\.?)(?=\s|$)/i)?.[1]
  if (!unit) return null
  const normalized: Record<string, string> = { UND: "UN", UNIDAD: "UN", KGS: "KG", GR: "G", LTS: "L", MTS: "M" }
  return normalized[unit.toUpperCase()] ?? unit.toUpperCase()
}

function parseDecimal(value: string): number {
  const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value
  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function approximatelyEquals(left: number, right: number) {
  return Math.abs(left - right) <= Math.max(1, Math.abs(right) * 0.015)
}

function identifyProductCode(productName: string, explicitCode?: string) {
  if (explicitCode) return { productName: productName.trim(), productCode: explicitCode.trim() }
  const match = productName.match(/\s+([A-Z0-9]+(?:-[A-Z0-9]+){2,})$/i)
  if (!match?.[1]) return { productName: productName.trim(), productCode: null }
  return { productName: productName.slice(0, match.index).trim(), productCode: match[1] }
}

function isInvoiceSummaryLine(line: string) {
  return /\b(?:total|neto|subtotal|iva|impuesto|descuento|exento|timbre)\b/i.test(line)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse Chilean number format: 1.234.567 → 1234567, 1.234,56 → 1234.56
 */
function parseChileanNumber(value: string): number {
  // Remove dots (thousands separator) and replace comma with dot (decimal)
  const cleaned = value.replace(/\./g, "").replace(",", ".")
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : Math.round(num)
}
