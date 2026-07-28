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

    // SII files commonly wrap Documento in EnvDTE/SetDTE/DTE and may use a
    // namespace prefix. Locate it structurally instead of assuming one shape.
    const documento = findDescendant(parsed, "Documento")
    if (!documento) return null

    // ── Header ──────────────────────────────────────────────────────────────
    const encabezado = childRecord(documento, "Encabezado")
    if (!encabezado) return null

    const idDoc = childRecord(encabezado, "IdDoc") ?? {}
    const emisor = childRecord(encabezado, "Emisor") ?? {}
    const totales = childRecord(encabezado, "Totales") ?? {}

    const folio = field(idDoc, "Folio")
    const fechaEmision = field(idDoc, "FchEmis", "FechaEmision")
    const rutEmisor = field(emisor, "RUTEmisor")
    const rznSocEmisor = field(emisor, "RznSoc", "RznSocEmisor")

    const mntNeto = num(child(totales, "MntNeto"))
    const iva = num(child(totales, "IVA"))
    const rawMntTotal = child(totales, "MntTotal")
    const mntTotal = num(rawMntTotal)

    // ── Line items ──────────────────────────────────────────────────────────
    const rawItems: Record<string, unknown>[] = []
    for (const detail of asArray(child(documento, "Detalle"))) {
      const nestedItems = asArray(child(asRecord(detail), "Item"))
      for (const item of nestedItems.length > 0 ? nestedItems : [detail]) {
        const record = asRecord(item)
        if (record) rawItems.push(record)
      }
    }

    const items: DteItem[] = rawItems.map((itemNode, index) => {
      const nroLinea = num(child(itemNode, "NroLinDet", "NroLinea")) || index + 1
      const cdgItem = childRecord(itemNode, "CdgItem")
      const productCode = cdgItem ? field(cdgItem, "VlrCod", "VlrCodigo") : null
      const nmItem = field(itemNode, "NmbItem", "NmItem") ?? ""
      const dscItem = field(itemNode, "DscItem")
      const qtyItem = num(child(itemNode, "QtyItem"))
      const unmdItem = field(itemNode, "UnmdItem") ?? "UN"
      const prcItem = num(child(itemNode, "PrcItem"))
      const montoItem = num(child(itemNode, "MontoItem"))
      const descuentoMonto = num(child(itemNode, "DescuentoMonto"))

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
    // Do not turn an XML fragment into a highly trusted invoice. These fields
    // are the minimum contractual identity and monetary payload of a DTE.
    if (!folio || !fechaEmision || rawMntTotal === undefined || totalAmount <= 0 || items.length === 0 || items.some((item) => !item.productName || item.quantity <= 0 || item.amount <= 0)) {
      return null
    }

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

function localName(key: string) {
  return key.includes(":") ? key.slice(key.lastIndexOf(":") + 1) : key
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asArray(value: unknown): unknown[] {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]
}

function child(node: Record<string, unknown> | null, ...names: string[]): unknown {
  if (!node) return undefined
  const wanted = new Set(names)
  return Object.entries(node).find(([key]) => wanted.has(localName(key)))?.[1]
}

function childRecord(node: Record<string, unknown> | null, ...names: string[]): Record<string, unknown> | null {
  return asRecord(child(node, ...names))
}

function field(node: Record<string, unknown>, ...names: string[]) {
  return str(child(node, ...names))
}

function findDescendant(value: unknown, name: string): Record<string, unknown> | null {
  const record = asRecord(value)
  if (!record) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = findDescendant(entry, name)
        if (found) return found
      }
    }
    return null
  }
  for (const [key, entry] of Object.entries(record)) {
    if (localName(key) === name) return asRecord(entry)
    const found = findDescendant(entry, name)
    if (found) return found
  }
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
