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
  /** Unidad textual declarada por el proveedor; null si el XML no la informa. */
  unitOfMeasure: string | null
  unitPrice:    number
  discount:     number
  amount:       number
}

export interface DteData {
  /** Tipo declarado dentro del XML DTE (33, 34, etc.). */
  tipoDte:       string | null
  invoiceNumber: string
  issueDate:     string | null
  supplierRut:   string | null
  supplierName:  string | null
  netAmount:     number
  taxAmount:     number
  totalAmount:   number
  items:         DteItem[]
  /**
   * Códigos de orden de compra que el proveedor citó en `<Referencia>`,
   * normalizados con `normalizeOrderCodeRef`. Ver `extractOrderCodeRefs`.
   */
  referencedOrderCodes: string[]
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

    const tipoDte = field(idDoc, "TipoDTE")
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
      const productCode = extractProductCode(itemNode)
      const nmItem = field(itemNode, "NmbItem", "NmItem") ?? ""
      const dscItem = field(itemNode, "DscItem")
      const qtyItem = num(child(itemNode, "QtyItem"))
      // La ausencia de UnmdItem es información: no se reemplaza por una
      // unidad inventada porque podría parecer conciliada con la OC.
      const unmdItem = field(itemNode, "UnmdItem")
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
      tipoDte,
      invoiceNumber: folio ?? "",
      issueDate:     fechaEmision ?? null,
      supplierRut:   rutEmisor ?? null,
      supplierName:  rznSocEmisor ?? null,
      netAmount:     mntNeto,
      taxAmount:     iva,
      totalAmount,
      items,
      referencedOrderCodes: extractOrderCodeRefs(documento),
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

/**
 * Extrae el código de producto de una línea de detalle.
 *
 * El SII permite **varios** `CdgItem` por línea, cada uno con su `TpoCodigo`, y
 * los proveedores lo usan: TRECK manda dos en cada línea — `INT` con su código
 * real ("06-08-001-T-XL") y `QBLI` con el valor "0".
 *
 * La versión anterior hacía `childRecord(itemNode, "CdgItem")`, y `asRecord`
 * devuelve null ante un array: con dos códigos el resultado era `productCode:
 * null`. O sea, del único proveedor que sí manda código, se descartaba. El
 * cruce de ítems caía siempre al nombre sin que nada lo dijera.
 *
 * Preferencia: `INT` (código interno del emisor, el que sirve para cruzar),
 * después cualquiera con valor útil. Se descartan los vacíos y el "0", que no
 * identifican nada y podrían cruzar con un producto ajeno.
 */
function extractProductCode(itemNode: Record<string, unknown>): string | null {
  const nodes = asArray(child(itemNode, "CdgItem")).map(asRecord).filter(Boolean) as Record<string, unknown>[]
  if (nodes.length === 0) return null

  const readCode = (node: Record<string, unknown>) => {
    const value = field(node, "VlrCod", "VlrCodigo")
    if (!value) return null
    const trimmed = value.trim()
    // "0" es relleno, no un identificador.
    return trimmed && trimmed !== "0" ? trimmed : null
  }

  const preferred = nodes.find((node) => {
    const tipo = field(node, "TpoCodigo", "TpoCod")?.trim().toUpperCase()
    return tipo === "INT" && readCode(node) !== null
  })
  if (preferred) return readCode(preferred)

  for (const node of nodes) {
    const code = readCode(node)
    if (code) return code
  }
  return null
}

/**
 * Códigos de OC que el proveedor citó en `<Referencia>` con `TpoDocRef` 801
 * ("Orden de Compra" en la tabla de documentos no tributarios del SII).
 *
 * Es la evidencia más fuerte que existe para decir a qué orden pertenece una
 * factura —la escribió el proveedor mirando nuestra OC— y hasta ahora el parser
 * la descartaba entera. Sobre las 667 facturas reales de APRO y TRECK en
 * `docs/facturas_apro_treck_kupfer`, **654 (98%) traen una referencia 801**, y
 * todas las emitidas desde que la plataforma existe citan el código en su forma
 * canónica sin prefijo: `2026-0025` para `OC-2026-0025`.
 *
 * Las que no calzan son las anteriores a la plataforma, con la numeración
 * interna vieja del proveedor (`4477`, `585.`) — y las sucias que mandan igual:
 * `OC206`, `SINOC080426`, `1 8 9`, `25/09/2025`. Por eso esto NO intenta
 * interpretar: normaliza y deja que la comparación exacta decida. Un código que
 * no calce con ninguna OC simplemente no aporta señal, que es el mismo lugar
 * donde estábamos antes.
 */
function extractOrderCodeRefs(documento: Record<string, unknown>): string[] {
  const codes = new Set<string>()
  for (const referencia of asArray(child(documento, "Referencia"))) {
    const record = asRecord(referencia)
    if (!record) continue
    const tipo = field(record, "TpoDocRef")?.trim().toUpperCase()
    if (tipo !== "801" && tipo !== "OC") continue
    const code = normalizeOrderCodeRef(field(record, "FolioRef"))
    if (code) codes.add(code)
  }
  return [...codes]
}

/**
 * Forma comparable de un código de OC, para los dos lados del cruce: el
 * `FolioRef` del proveedor y el `purchase_orders.code` nuestro tienen que pasar
 * por acá antes de compararse.
 *
 * `OC-2026-0025`, `2026-0025` y `OC 2026 0025` colapsan todos a `20260025`. Se
 * descarta lo de menos de 3 caracteres (`N`, `-`): no identifica una orden y
 * abarataría una coincidencia que después se muestra como certeza.
 */
export function normalizeOrderCodeRef(value: string | null | undefined): string | null {
  if (!value) return null
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "")
  // El prefijo es nuestro, no del documento: los proveedores lo omiten tanto
  // como lo escriben, y sin quitarlo `OC-2026-0025` nunca calzaría con `2026-0025`.
  const withoutPrefix = compact.startsWith("OC") ? compact.slice(2) : compact
  return withoutPrefix.length >= 3 ? withoutPrefix : null
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
