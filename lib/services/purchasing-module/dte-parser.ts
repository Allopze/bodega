/**
 * Parser for Chilean DTE (Documento Tributario Electrónico) XML files.
 * Extracts invoice data: number, date, items, amounts.
 */

export interface DteItem {
  lineNumber:   number
  productCode:  string | null
  productName:  string
  description:  string | null
  quantity:     number
  unitOfMeasure: string
  unitPrice:    number
  discount:     number
  amount:       number
}

export interface DteData {
  invoiceNumber: string
  issueDate:     string | null
  supplierRut:   string | null
  supplierName:  string | null
  netAmount:     number
  taxAmount:     number
  totalAmount:   number
  items:         DteItem[]
}

/**
 * Parse a Chilean DTE XML string into structured data.
 * Supports: Factura (33), Factura de Exenta (34), Nota de Crédito (61), Nota de Débito (56)
 */
export function parseDteXml(xmlString: string): DteData | null {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlString, "text/xml")

    // Check for parse errors
    const parseError = doc.querySelector("parsererror")
    if (parseError) return null

    // Try both <DTE> and direct <Documento> (some DTEs omit the wrapper)
    const documento = doc.querySelector("DTE > Documento") ?? doc.querySelector("Documento")
    if (!documento) return null

    // ── Header ──────────────────────────────────────────────────────────────
    const folio = textContent(documento, "Encabezado > IdDoc > Folio")
    const fechaEmision = textContent(documento, "Encabezado > IdDoc > FechaEmision")
    const rutEmisor = textContent(documento, "Encabezado > Emisor > RUTEmisor")
    const rznSocEmisor = textContent(documento, "Encabezado > Emisor > RznSocEmisor")

    // ── Totals ──────────────────────────────────────────────────────────────
    const mntNeto = parseNumber(textContent(documento, "Encabezado > Totales > MntNeto"))
    const iva = parseNumber(textContent(documento, "Encabezado > Totales > IVA"))
    const mntTotal = parseNumber(textContent(documento, "Encabezado > Totales > MntTotal"))

    // ── Line items ──────────────────────────────────────────────────────────
    const detailNodes = documento.querySelectorAll("Detalle > Item")
    const items: DteItem[] = []

    detailNodes.forEach((itemNode) => {
      const nroLinea = parseInt(textContent(itemNode, "NroLinea") ?? "0", 10)
      const cdgItem = itemNode.querySelector("CdgItem")
      const productCode = cdgItem ? textContent(cdgItem, "VlrCod") : null
      const nmItem = textContent(itemNode, "NmItem") ?? ""
      const dscItem = textContent(itemNode, "DscItem")
      const qtyItem = parseNumber(textContent(itemNode, "QtyItem"))
      const unmdItem = textContent(itemNode, "UnmdItem") ?? "UN"
      const prcItem = parseNumber(textContent(itemNode, "PrcItem"))
      const montoItem = parseNumber(textContent(itemNode, "MontoItem"))

      // Some DTEs use PrcItem sinDescuentos + DescuentoMonto
      const descuentoMonto = parseNumber(textContent(itemNode, "DescuentoMonto"))

      items.push({
        lineNumber:   nroLinea || items.length + 1,
        productCode,
        productName:  nmItem,
        description:  dscItem,
        quantity:     qtyItem,
        unitOfMeasure: unmdItem,
        unitPrice:    prcItem,
        discount:     descuentoMonto,
        amount:       montoItem || qtyItem * prcItem,
      })
    })

    // ── Build result ────────────────────────────────────────────────────────
    const invoiceNumber = folio ?? ""
    const totalAmount = mntTotal || (mntNeto + iva)

    return {
      invoiceNumber,
      issueDate:     fechaEmision ?? null,
      supplierRut:   rutEmisor ?? null,
      supplierName:  rznSocEmisor ?? null,
      netAmount:     mntNeto,
      taxAmount:     iva,
      totalAmount,
      items,
    }
  } catch {
    return null
  }
}

/**
 * Try to match DTE items against OC items by product code or name.
 */
export function matchDteItemsToOcItems(
  dteItems: DteItem[],
  ocItems: Array<{ id: string; productId: string | null; productNameFree: string | null; quantity: number }>,
): Array<{
  dteItem: DteItem
  ocItemId: string | null
  matchType: "code" | "name" | "none"
}> {
  return dteItems.map((dteItem) => {
    // Try match by product code first
    if (dteItem.productCode) {
      const byCode = ocItems.find((oci) => oci.productId === dteItem.productCode)
      if (byCode) return { dteItem, ocItemId: byCode.id, matchType: "code" as const }
    }

    // Try match by product name (case-insensitive, trimmed)
    const normalizedName = dteItem.productName.toLowerCase().trim()
    const byName = ocItems.find((oci) => {
      const ocName = (oci.productNameFree ?? "").toLowerCase().trim()
      return ocName && (normalizedName.includes(ocName) || ocName.includes(normalizedName))
    })
    if (byName) return { dteItem, ocItemId: byName.id, matchType: "name" as const }

    return { dteItem, ocItemId: null, matchType: "none" as const }
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function textContent(parent: Element, selector: string): string | null {
  const el = parent.querySelector(selector)
  return el?.textContent?.trim() ?? null
}

function parseNumber(value: string | null): number {
  if (!value) return 0
  // Chilean DTE uses integers (no decimals) for amounts
  const cleaned = value.replace(/\./g, "").replace(/,/g, ".")
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}
