/**
 * lib/services/billing/dte-xml.ts
 *
 * Lector de XML DTE para el lado de VENTAS.
 *
 * ¿Por qué no se reutiliza `lib/services/purchasing-module/dte-parser.ts`?
 * Porque ese parser está afinado para conciliar contra ítems de orden de compra:
 * descarta el documento si no trae ítems válidos y no lee el Receptor. Acá se
 * necesita exactamente lo contrario:
 *
 * - **Receptor** (`RUTRecep`, `RznSocRecep`): el listado de ventas del portal
 *   NO trae el RUT del cliente, solo su razón social. Sin el RUT no hay
 *   identidad tributaria ni cruce con el maestro de clientes.
 * - **`FchVenc`**: el vencimiento real que declaró el documento. Es la única
 *   fuente externa de vencimiento que existe; sin ella "vencida" sería una
 *   inferencia.
 * - **`MntExe`**: monto exento, que el listado tampoco separa.
 * - Ítems opcionales: una factura de servicio con una sola línea genérica sigue
 *   siendo válida.
 *
 * El XML es un dato NO confiable (viene de fuera): todo campo se valida y se
 * normaliza, y el documento entero se descarta si no cuadra la identidad
 * mínima. Nunca se guarda el XML crudo en un log.
 */

import { XMLParser } from "fast-xml-parser"
import { cleanRut } from "@/lib/rut"

export interface DteXmlItem {
  lineNumber:  number
  description: string
  quantity:    number | null
  unit:        string | null
  unitPrice:   number | null
  discount:    number | null
  amount:      number | null
}

export interface DteXmlDocument {
  docType:       string
  folio:         number
  issueDate:     string          // "YYYY-MM-DD"
  dueDate:       string | null   // FchVenc, "YYYY-MM-DD"
  issuerTaxId:   string
  issuerName:    string
  receiverTaxId: string
  receiverName:  string
  netAmount:     number | null
  taxAmount:     number | null
  exemptAmount:  number | null
  totalAmount:   number
  items:         DteXmlItem[]
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" })

/** "YYYY-MM-DD" estricto. El portal y el SII usan ISO en los XML. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parsea un XML DTE. Devuelve `null` si falta la identidad mínima
 * (tipo, folio, fecha, emisor, receptor, total) — nunca inventa valores.
 */
export function parseSaleDteXml(xml: string): DteXmlDocument | null {
  let parsed: unknown
  try {
    parsed = parser.parse(xml)
  } catch {
    return null
  }
  if (!parsed) return null

  const documento = findDescendant(parsed, "Documento")
  if (!documento) return null

  const encabezado = asRecord(child(documento, "Encabezado"))
  if (!encabezado) return null

  const idDoc    = asRecord(child(encabezado, "IdDoc")) ?? {}
  const emisor   = asRecord(child(encabezado, "Emisor")) ?? {}
  const receptor = asRecord(child(encabezado, "Receptor")) ?? {}
  const totales  = asRecord(child(encabezado, "Totales")) ?? {}

  const docType = text(child(idDoc, "TipoDTE"))
  const folio   = int(child(idDoc, "Folio"))
  const issueDate = isoDate(text(child(idDoc, "FchEmis")))
  const dueDate   = isoDate(text(child(idDoc, "FchVenc")))

  const issuerTaxId   = rut(text(child(emisor, "RUTEmisor")))
  const issuerName    = text(child(emisor, "RznSoc")) ?? text(child(emisor, "RznSocEmisor"))
  const receiverTaxId = rut(text(child(receptor, "RUTRecep")))
  const receiverName  = text(child(receptor, "RznSocRecep"))

  // El XML del SII declara los montos como magnitud sin signo; el signo de una
  // Nota de Crédito (TipoDTE 61) es convención contable externa al documento.
  // La convención interna (invoices.ts, derivePaymentStatus) exige que una NC
  // tenga total NEGATIVO para reducir la cuenta por cobrar — sin esto, una NC
  // cargada desde XML se contabilizaba como factura que aumenta la deuda.
  const asCredit = docType === "61"
    ? (v: number | null) => (v === null ? null : -Math.abs(v))
    : (v: number | null) => v
  const netAmount    = asCredit(num(child(totales, "MntNeto")))
  const taxAmount    = asCredit(num(child(totales, "IVA")))
  const exemptAmount = asCredit(num(child(totales, "MntExe")))
  const totalAmount  = asCredit(num(child(totales, "MntTotal")))

  // Identidad mínima. Sin esto el registro no se puede deduplicar ni atribuir.
  if (
    !docType || !folio || folio <= 0 || !issueDate ||
    !issuerTaxId || !receiverTaxId || totalAmount === null
  ) {
    return null
  }

  const items: DteXmlItem[] = []
  for (const detalle of asArray(child(documento, "Detalle"))) {
    const record = asRecord(detalle)
    if (!record) continue
    const nested = asArray(child(record, "Item"))
    for (const [index, node] of (nested.length > 0 ? nested : [record]).entries()) {
      const item = asRecord(node)
      if (!item) continue
      const description = text(child(item, "NmbItem")) ?? text(child(item, "DscItem"))
      if (!description) continue
      items.push({
        lineNumber:  int(child(item, "NroLinDet")) ?? items.length + index + 1,
        description,
        quantity:    num(child(item, "QtyItem")),
        unit:        text(child(item, "UnmdItem")),
        unitPrice:   num(child(item, "PrcItem")),
        discount:    num(child(item, "DescuentoMonto")),
        amount:      num(child(item, "MontoItem")),
      })
    }
  }

  return {
    docType,
    folio,
    issueDate,
    dueDate,
    issuerTaxId,
    // La razón social puede faltar en un XML mal formado; el RUT es lo que
    // manda, así que se cae al RUT antes que descartar el documento entero.
    issuerName:   issuerName ?? issuerTaxId,
    receiverTaxId,
    receiverName: receiverName ?? receiverTaxId,
    netAmount,
    taxAmount,
    exemptAmount,
    totalAmount,
    items: items.sort((a, b) => a.lineNumber - b.lineNumber),
  }
}

// ── Helpers de lectura tolerante ─────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

/** Lee una clave ignorando prefijos de namespace (`ns:Clave`). */
function child(node: unknown, key: string): unknown {
  const record = asRecord(node)
  if (!record) return undefined
  if (key in record) return record[key]
  const suffix = `:${key}`
  for (const candidate of Object.keys(record)) {
    if (candidate.endsWith(suffix)) return record[candidate]
  }
  return undefined
}

/** Busca en profundidad la primera aparición de una clave. */
function findDescendant(root: unknown, key: string): unknown {
  const queue: unknown[] = [root]
  while (queue.length > 0) {
    const node = queue.shift()
    const direct = child(node, key)
    if (direct !== undefined) return direct
    const record = asRecord(node)
    if (record) {
      for (const value of Object.values(record)) {
        if (value !== null && typeof value === "object") queue.push(value)
      }
    } else if (Array.isArray(node)) {
      queue.push(...node)
    }
  }
  return undefined
}

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === "object") return null
  const asText = String(value).trim()
  return asText.length > 0 ? asText : null
}

function int(value: unknown): number | null {
  const asText = text(value)
  if (asText === null) return null
  const parsedInt = Number.parseInt(asText, 10)
  return Number.isSafeInteger(parsedInt) ? parsedInt : null
}

function num(value: unknown): number | null {
  const asText = text(value)
  if (asText === null) return null
  // Contenido XML usa la sintaxis léxica de XSD decimal (punto = decimal, sin
  // separador de miles). Tratarlo como texto chileno convertía "6.00" en 600;
  // ese tratamiento pertenece solo a parseMonto() del parser HTML del portal.
  const parsedNum = Number(asText)
  return Number.isFinite(parsedNum) ? parsedNum : null
}

function isoDate(value: string | null): string | null {
  if (!value) return null
  const candidate = value.slice(0, 10)
  return ISO_DATE.test(candidate) ? candidate : null
}

/**
 * Normaliza el RUT del XML al formato del maestro interno.
 * `cleanRut` es la misma función que usa el resto de la plataforma, así que el
 * cruce con `clients.rut` y `suppliers.rut` es consistente.
 */
function rut(value: string | null): string | null {
  if (!value) return null
  const cleaned = cleanRut(value)
  // Solo se valida la FORMA, no el dígito verificador: el SII usa RUT
  // convencionales para receptores extranjeros (55.555.555-5) y rechazar un
  // documento real por aritmética de DV sería peor que aceptarlo.
  return /^\d{7,9}-[\dK]$/.test(cleaned) ? cleaned : null
}
