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
  quantity: number
  unitPrice: number
  amount: number
}

/**
 * Parse invoice text to extract structured data.
 * Uses regex patterns common in Chilean and international invoices.
 */
export function parseInvoiceText(text: string): ParsedInvoiceData {
  const normalized = text.replace(/\s+/g, " ").trim()

  return {
    invoiceNumber: extractInvoiceNumber(normalized),
    issueDate: extractDate(normalized),
    totalAmount: extractTotalAmount(normalized),
    netAmount: extractNetAmount(normalized),
    taxAmount: extractTaxAmount(normalized),
    supplierName: extractSupplierName(normalized),
    supplierRut: extractRut(normalized),
    items: extractItems(normalized),
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
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1].trim()
  }
  return null
}

function extractRut(text: string): string | null {
  const patterns = [
    /RUT\s*:?\s*(\d{1,2}\.\d{3}\.\d{3}\-[\dkK])/i,
    /RUT\s*:?\s*(\d{7,8}\-[\dkK])/i,
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
  const lines = text.split(/\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

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
          quantity,
          unitPrice,
          amount: amount || quantity * unitPrice,
        })
      }
    }
  }

  return items
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
