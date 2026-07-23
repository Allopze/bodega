/**
 * Parser for Chilean DTE (Documento Tributario Electrónico) XML files.
 * Extracts invoice data: number, date, items, amounts.
 */

import { XMLParser } from "fast-xml-parser"

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

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
})

/**
 * Parse a Chilean DTE XML string into structured data.
 * Supports: Factura (33), Factura de Exenta (34), Nota de Crédito (61), Nota de Débito (56)
 */
export function parseDteXml(xmlString: string): DteData | null {
  try {
    const parsed = xmlParser.parse(xmlString)
    if (!parsed) return null

    // Try both <DTE><Documento> and direct <Documento>
    const documento = parsed.DTE?.Documento ?? parsed.Documento
    if (!documento) return null

    // ── Header ──────────────────────────────────────────────────────────────
    const encabezado = documento.Encabezado
    if (!encabezado) return null

    const idDoc = encabezado.IdDoc ?? {}
    const emisor = encabezado.Emisor ?? {}
    const totales = encabezado.Totales ?? {}

    const folio = str(idDoc.Folio)
    const fechaEmision = str(idDoc.FechaEmision)
    const rutEmisor = str(emisor.RUTEmisor)
    const rznSocEmisor = str(emisor.RznSocEmisor)

    const mntNeto = num(totales.MntNeto)
    const iva = num(totales.IVA)
    const mntTotal = num(totales.MntTotal)

    // ── Line items ──────────────────────────────────────────────────────────
    const detalle = documento.Detalle
    const rawItems: Record<string, unknown>[] = detalle?.Item
      ? Array.isArray(detalle.Item) ? detalle.Item : [detalle.Item]
      : []

    const items: DteItem[] = rawItems.map((itemNode, index) => {
      const nroLinea = num(itemNode.NroLinea) || index + 1
      const cdgItem = itemNode.CdgItem as Record<string, unknown> | undefined
      const productCode = cdgItem ? str(cdgItem.VlrCod) : null
      const nmItem = str(itemNode.NmItem) ?? ""
      const dscItem = str(itemNode.DscItem)
      const qtyItem = num(itemNode.QtyItem)
      const unmdItem = str(itemNode.UnmdItem) ?? "UN"
      const prcItem = num(itemNode.PrcItem)
      const montoItem = num(itemNode.MontoItem)
      const descuentoMonto = num(itemNode.DescuentoMonto)

      return {
        lineNumber:   nroLinea,
        productCode,
        productName:  nmItem,
        description:  dscItem,
        quantity:     qtyItem,
        unitOfMeasure: unmdItem,
        unitPrice:    prcItem,
        discount:     descuentoMonto,
        amount:       montoItem || qtyItem * prcItem,
      }
    })

    // ── Build result ────────────────────────────────────────────────────────
    const totalAmount = mntTotal || (mntNeto + iva)

    return {
      invoiceNumber: folio ?? "",
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

function str(value: unknown): string | null {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number") return String(value)
  return null
}

function num(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const cleaned = value.replace(/\./g, "").replace(",", ".")
    const n = parseFloat(cleaned)
    return isNaN(n) ? 0 : n
  }
  return 0
}
