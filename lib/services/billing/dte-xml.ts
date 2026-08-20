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
 *
 * Un sobre `EnvioDTE` puede traer VARIOS `<Documento>`. Por eso el parser
 * selecciona por identidad (tipo, folio, RUT emisor) en vez de asumir que el
 * pedido es el primero: injertar otro DTE reescribiría el RUT del cliente, el
 * vencimiento y los montos de una venta ajena sobre la fila equivocada.
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
  /** Moneda declarada por el documento, en ISO 4217. `null` si no la declara o no se reconoce. */
  currency:      string | null
  /** Nombre de moneda tal como lo trae el XML (tabla del SII), para reportar los desconocidos. */
  currencyDeclared: string | null
  items:         DteXmlItem[]
}

/** Identidad del documento buscado dentro de un sobre con varios `<Documento>`. */
export interface DteXmlSelector {
  docType:      string
  folio:        number
  /** Opcional: si se entrega, el emisor tiene que coincidir. */
  issuerTaxId?: string | null
}

/**
 * Nombres de la tabla de monedas del SII → ISO 4217.
 * Sólo lo que el portal emite de verdad; un nombre fuera de la tabla NO se
 * traduce (ver `currencyDeclared`): inventar un código ISO sería peor que no
 * saber la moneda.
 */
const SII_CURRENCY_ISO: Record<string, string> = {
  "PESO CL":              "CLP",
  "PESO CHILENO":         "CLP",
  "DOLAR USA":            "USD",
  "DOLAR ESTADOUNIDENSE": "USD",
  EURO:                   "EUR",
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" })

/**
 * Convención de signo del módulo, en un solo lugar.
 *
 * Una Nota de Crédito (TipoDTE 61) tiene que quedar NEGATIVA para restar de la
 * cuenta por cobrar (`derivePaymentStatus`, `db/schema/billing.ts:74`). Las
 * fuentes no coinciden: el XML del SII declara magnitudes sin signo, el libro
 * de ventas de FacturaEnLínea ya entrega la NC en negativo y Chipax la entrega
 * positiva. Por eso es **idempotente** (`-Math.abs`, nunca `* -1`): aplicarla
 * dos veces, o sobre un valor que ya venía negativo, da lo mismo.
 */
export function applyCreditSign(docType: string, amount: number): number
export function applyCreditSign(docType: string, amount: number | null): number | null
export function applyCreditSign(docType: string, amount: number | null): number | null {
  if (amount === null) return null
  return docType === "61" ? -Math.abs(amount) : amount
}

/** "YYYY-MM-DD" estricto. El portal y el SII usan ISO en los XML. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parsea un XML DTE. Devuelve `null` si falta la identidad mínima
 * (tipo, folio, fecha, emisor, receptor, total) — nunca inventa valores.
 *
 * Con `select` busca ESE documento dentro del sobre (que puede traer varios) y
 * devuelve `null` si no está: quien pidió un folio no puede recibir otro. Sin
 * `select` se lee el primer `<Documento>`, como siempre.
 */
export function parseSaleDteXml(xml: string, select?: DteXmlSelector): DteXmlDocument | null {
  let parsed: unknown
  try {
    parsed = parser.parse(xml)
  } catch {
    return null
  }
  if (!parsed) return null

  const documentos = collectDescendants(parsed, "Documento")
  if (documentos.length === 0) return null
  if (!select) return parseDocumento(documentos[0])

  // El tipo se compara normalizado porque el portal lo entrega indistintamente
  // como "33" o "033"; el RUT, por `cleanRut`, igual que el resto del maestro.
  const wantedDocType   = select.docType.padStart(3, "0")
  const wantedIssuerRut = select.issuerTaxId ? cleanRut(select.issuerTaxId) : null
  for (const node of documentos) {
    const candidate = parseDocumento(node)
    if (!candidate) continue
    if (candidate.docType.padStart(3, "0") !== wantedDocType) continue
    if (candidate.folio !== select.folio) continue
    if (wantedIssuerRut !== null && candidate.issuerTaxId !== wantedIssuerRut) continue
    return candidate
  }
  return null
}

/** Un `<Documento>` ya ubicado dentro del sobre → modelo normalizado. */
function parseDocumento(documento: unknown): DteXmlDocument | null {
  const encabezado = asRecord(child(documento, "Encabezado"))
  if (!encabezado) return null

  const idDoc    = asRecord(child(encabezado, "IdDoc")) ?? {}
  const emisor   = asRecord(child(encabezado, "Emisor")) ?? {}
  const receptor = asRecord(child(encabezado, "Receptor")) ?? {}
  const totales  = asRecord(child(encabezado, "Totales")) ?? {}
  const otraMoneda = asRecord(child(encabezado, "OtraMoneda")) ?? {}

  const docType = text(child(idDoc, "TipoDTE"))
  const folio   = int(child(idDoc, "Folio"))
  const issueDate = isoDate(text(child(idDoc, "FchEmis")))
  const dueDate   = isoDate(text(child(idDoc, "FchVenc")))

  const issuerTaxId   = rut(text(child(emisor, "RUTEmisor")))
  const issuerName    = text(child(emisor, "RznSoc")) ?? text(child(emisor, "RznSocEmisor"))
  const receiverTaxId = rut(text(child(receptor, "RUTRecep")))
  const receiverName  = text(child(receptor, "RznSocRecep"))

  // La moneda del documento vive en `Totales` (documentos de exportación);
  // algunos emisores sólo la declaran en `OtraMoneda`, así que ésa es el
  // respaldo. Se conserva además el nombre crudo para poder reportar una
  // moneda que no está en la tabla en vez de etiquetarla en silencio.
  const currencyDeclared = text(child(totales, "TpoMoneda"))
    ?? text(child(otraMoneda, "TpoMoneda"))
  const currency = currencyDeclared
    ? SII_CURRENCY_ISO[currencyDeclared.toUpperCase()] ?? null
    : null

  // El XML del SII declara los montos como magnitud sin signo; el signo de una
  // Nota de Crédito (TipoDTE 61) es convención contable externa al documento.
  const asCredit = (v: number | null) => applyCreditSign(docType ?? "", v)
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
        // El detalle sigue el mismo signo que el encabezado: una NC con total
        // negativo y líneas positivas es un documento que no cuadra consigo mismo.
        unitPrice:   asCredit(num(child(item, "PrcItem"))),
        discount:    asCredit(num(child(item, "DescuentoMonto"))),
        amount:      asCredit(num(child(item, "MontoItem"))),
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
    currency,
    currencyDeclared,
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

/**
 * Busca en profundidad TODAS las apariciones de una clave, en orden de aparición.
 * Un sobre `EnvioDTE` reparte los `<Documento>` en un `<DTE>` por documento, así
 * que quedarse con el primero perdía los demás.
 */
function collectDescendants(root: unknown, key: string): unknown[] {
  const found: unknown[] = []
  const queue: unknown[] = [root]
  while (queue.length > 0) {
    const node = queue.shift()
    const direct = child(node, key)
    if (direct !== undefined) {
      // Un `<Documento>` no contiene otro: no se sigue bajando por esta rama.
      found.push(...asArray(direct))
      continue
    }
    const record = asRecord(node)
    if (record) {
      for (const value of Object.values(record)) {
        if (value !== null && typeof value === "object") queue.push(value)
      }
    } else if (Array.isArray(node)) {
      queue.push(...node)
    }
  }
  return found
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
