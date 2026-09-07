/**
 * Selección de los DTE que se le pueden ofrecer a una orden de compra para
 * registrar su factura sin volver a subir el archivo.
 *
 * ## Por qué es una función aparte y probada
 *
 * La primera versión filtraba sólo por RUT del proveedor. En una OC de APRO
 * creada el 2026-08-07 eso ofrecía sus 10 facturas de julio: ninguna podía ser
 * suya —todas emitidas antes de que la orden existiera— y cada una quedaba a un
 * clic de precargar folio, montos y líneas ajenas. El costo de equivocarse pasó
 * de "bajar el archivo equivocado del portal" a "aceptar lo que propone la
 * pantalla", que es mucho más fácil de hacer sin mirar.
 *
 * La regla que evita eso vive acá y no en un comentario junto a la consulta.
 */

import { cleanRut } from "@/lib/rut"
import { normalizeOrderCodeRef } from "./dte-parser"
import { CLP_ROUNDING_TOLERANCE } from "./money-tolerance"
import type { DteCandidateOrderReference } from "./order-reference"
import { areEquivalentUnits } from "./invoice-item-matching"

export interface DteCandidateInput {
  id: string
  rutEmisor: string
  /** 'YYYY-MM-DD' — el portal la entrega así y la columna es texto. */
  fechaEmision: string
  montoTotal: number
  /**
   * Tipo SII del documento. Opcional para no romper a quien ya llamaba sin él;
   * sin tipo se asume factura, que es la lectura conservadora.
   */
  tipoDte?: string
}

export interface DteCandidateFilter {
  /** RUT del proveedor de la OC, sin normalizar: se normaliza acá. */
  supplierRut: string | null
  /**
   * Fecha de creación de la OC, 'YYYY-MM-DD'. Es el piso: un proveedor no puede
   * facturar una orden que todavía no existe.
   *
   * Se usa la creación y no la emisión porque sí puede facturar entre que la
   * orden se crea y se emite formalmente.
   */
  createdOn: string
  /**
   * Monto que la OC espera facturar (su total menos lo ya facturado).
   *
   * La operación factura **una OC por DTE**, así que el documento correcto debe
   * traer ese monto. Se usa para ordenar y para marcar la coincidencia exacta;
   * NO para filtrar: un flete, un redondeo o una factura parcial legítima no
   * pueden desaparecer de la lista por no cuadrar al peso.
   */
  expectedAmount?: number | null
  /** Tope de la lista, para que un proveedor muy activo no la vuelva un muro. */
  limit?: number
}

/** Los únicos tipos que pueden ser la factura de una OC. */
export const DTE_INVOICE_TIPOS = ["33", "34"] as const
/**
 * Nota de crédito. Se registra contra la OC igual que una factura, pero resta:
 * el servicio la guarda con `document_kind = 'credit_note'` y monto negativo.
 *
 * Antes se rechazaba, y una devolución dejaba la OC sobrefacturada sin forma de
 * corregirlo desde la plataforma. Son 20 en dos meses sobre datos reales.
 */
export const DTE_CREDIT_NOTE_TIPOS = ["61"] as const

/** Los tipos que la plataforma sabe colgar de una OC, de cualquier signo. */
export const DTE_ATTACHABLE_TIPOS = [...DTE_INVOICE_TIPOS, ...DTE_CREDIT_NOTE_TIPOS] as const

/** Qué clase de documento crea este tipo de DTE al adjuntarse. */
export function dteDocumentKind(tipoDte: string): "invoice" | "credit_note" {
  return (DTE_CREDIT_NOTE_TIPOS as readonly string[]).includes(tipoDte) ? "credit_note" : "invoice"
}

export interface DteInvoiceEligibilityDoc {
  tipoDte: string
  rutEmisor: string
  /** 'YYYY-MM-DD'. */
  fechaEmision: string
  purchaseOrderInvoiceId: string | null
  fuelLoadId: string | null
}

/**
 * Por qué este DTE **no** puede ser la factura de esta OC, o `null` si sí puede.
 *
 * Es el mismo juicio en dos lugares con propósitos distintos, y por eso vive
 * acá una sola vez: la transacción lo aplica bajo `FOR UPDATE` y es la
 * autoridad; la acción lo aplica antes de salir al portal, sólo para no hacer
 * dos descargas y escribir un PDF en disco que va a haber que borrar. Copiado
 * en ambos lados serían dos verdades destinadas a separarse.
 *
 * `orderCreatedOn` llega ya como fecha CALENDARIO chilena ('YYYY-MM-DD'), igual
 * que `createdOn` en el resto del módulo: la conversión desde el texto UTC de
 * `purchase_orders.created_at` es del llamador.
 */
export function dteInvoiceRejection(
  dte: DteInvoiceEligibilityDoc | null | undefined,
  supplierRut: string | null | undefined,
  orderCreatedOn: string,
): string | null {
  if (!dte || !supplierRut) return "El DTE o proveedor ya no está disponible"
  if (!(DTE_ATTACHABLE_TIPOS as readonly string[]).includes(dte.tipoDte)) {
    return "Este tipo de DTE no puede registrarse contra una OC"
  }
  if (dte.purchaseOrderInvoiceId || dte.fuelLoadId) return "Este DTE ya fue usado por otra operación"
  if (cleanRut(dte.rutEmisor) !== cleanRut(supplierRut)) {
    return "El emisor del DTE no corresponde al proveedor de esta OC"
  }
  if (dte.fechaEmision < orderCreatedOn) return "El DTE fue emitido antes de crear esta orden"
  return null
}

const DEFAULT_LIMIT = 20

/** Diferencia máxima, en pesos, para dar el monto por coincidente. */
const AMOUNT_TOLERANCE_CLP = CLP_ROUNDING_TOLERANCE

export type DteCandidateConfidence = "high" | "medium" | "low" | "unassessed"
export type DteCandidateMatchType = "supplier_alias" | "sku" | "name" | "ambiguous" | "unit_mismatch" | "none"
/** @see order-reference.ts — el vocabulario vive ahí para que el cliente pueda importarlo. */
export type { DteCandidateOrderReference }

export interface DteCandidateLineInput {
  id: string
  lineNumber: number
  productCode: string | null
  productName: string
  unitOfMeasure: string | null
  quantity: number
  unitPrice: number
  amount: number
}

export interface DteCandidateDocumentInput extends DteCandidateInput {
  enrichmentStatus?: "pending" | "ready" | "failed"
  lines?: DteCandidateLineInput[]
  /**
   * Contenido crudo de `dte_documents.referenced_order_codes`: los códigos de
   * OC que el proveedor citó en `<Referencia>`, normalizados y separados por
   * coma. Null en los documentos anteriores a la columna.
   */
  referencedOrderCodes?: string | null
}

export interface DteCandidateOrderItem {
  id: string
  productId: string | null
  productName: string
  productCode: string | null
  unitOfMeasure: string
  quantity: number
  invoicedQuantity: number
}

export interface DteCandidateAlias {
  productId: string
  normalizedCode: string | null
  normalizedName: string | null
}

export interface DteCandidateProposedLink {
  dteItemId: string
  purchaseOrderItemId: string | null
  matchType: DteCandidateMatchType
  quantityStatus: "exact" | "under" | "over" | "not_evaluable"
}

export interface DteCandidateAssessment<T extends DteCandidateDocumentInput = DteCandidateDocumentInput> {
  doc: T
  confidence: DteCandidateConfidence
  /**
   * El proveedor citó el código de ESTA orden en el XML. Es la evidencia más
   * fuerte disponible y se mantiene aparte de `confidence`, que mide otra cosa
   * (cuántas líneas se pudieron vincular): una factura puede nombrar la orden
   * correcta y aun así traer líneas que nadie logró cruzar, y esconder una de
   * las dos señales detrás de la otra deja al operador sin qué discutir.
   */
  referencesOrder: boolean
  /**
   * Clasificación de lo que el proveedor citó. `referencesOrder` es su caso
   * fuerte (`exact`); los demás valores existen para poder mostrar la
   * diferencia entre "no citó" y "citó algo que no sirve".
   */
  orderReference: DteCandidateOrderReference
  amountMatches: boolean
  amountDifference: number | null
  proposedLinks: DteCandidateProposedLink[]
  explanation: {
    totalLines: number
    matchedLines: number
    ambiguousLines: number
    unitMismatches: number
    quantityExactLines: number
    quantityUnderLines: number
    quantityOverLines: number
  }
}

export interface DteCandidateAssessmentFilter extends DteCandidateFilter {
  orderItems: DteCandidateOrderItem[]
  aliases: DteCandidateAlias[]
  /** `purchase_orders.code` ("OC-2026-0025"); se normaliza acá. */
  orderCode?: string | null
  /**
   * Diferencia máxima en pesos para marcar "calza con el saldo". Entra como
   * dato para que el badge de la lista y el veredicto del conciliador respondan
   * lo mismo; ambos salen de `ops.compras.clp_tolerance`. El default es el
   * ruido de redondeo, para quien llame sin configuración a mano.
   */
  clpTolerance?: number
}

/**
 * Evalúa evidencia persistida del XML sin llamar al portal durante el render.
 * La identidad del producto manda sobre monto y cantidad; estos últimos sólo
 * explican cobertura y desempatan documentos que ya identificaron sus líneas.
 */
export function assessDteCandidates<T extends DteCandidateDocumentInput>(
  unlinkedDocs: T[],
  { supplierRut, createdOn, expectedAmount, limit = DEFAULT_LIMIT, orderItems, aliases, orderCode, clpTolerance = AMOUNT_TOLERANCE_CLP }: DteCandidateAssessmentFilter,
): DteCandidateAssessment<T>[] {
  if (!supplierRut || !cleanRut(supplierRut)) return []
  const supplier = cleanRut(supplierRut)
  const target = typeof expectedAmount === "number" && expectedAmount > 0 ? expectedAmount : null
  // Los dos lados del cruce pasan por la misma normalización; ver
  // `normalizeOrderCodeRef`. Un código nuestro ilegible deja la señal apagada,
  // nunca prendida de más.
  const normalizedOrderCode = normalizeOrderCodeRef(orderCode)
  const itemByProductId = new Map<string, DteCandidateOrderItem[]>()

  for (const item of orderItems) {
    if (!item.productId) continue
    const grouped = itemByProductId.get(item.productId) ?? []
    grouped.push(item)
    itemByProductId.set(item.productId, grouped)
  }

  const assessed = unlinkedDocs
    .filter((doc) => cleanRut(doc.rutEmisor) === supplier && doc.fechaEmision >= createdOn)
    .map((doc): DteCandidateAssessment<T> => {
      const amountDifference = target === null ? null : Math.abs(doc.montoTotal - target)
      // Una nota de crédito nunca "calza con el saldo": el saldo es lo que falta
      // por facturar y la NC resta. Decir que calza invitaría a adjuntarla
      // creyendo que cierra la orden, y la deja al revés.
      const amountMatches = dteDocumentKind(doc.tipoDte ?? "") === "invoice"
        && amountDifference !== null && amountDifference <= clpTolerance
      const orderReference = classifyOrderReference(normalizedOrderCode, doc.referencedOrderCodes)
      const referencesOrder = orderReference === "exact"
      const lines = doc.lines ?? []
      if (doc.enrichmentStatus !== "ready" || lines.length === 0) {
        return {
          doc,
          confidence: "unassessed",
          referencesOrder,
          orderReference,
          amountMatches,
          amountDifference,
          proposedLinks: [],
          explanation: emptyExplanation(lines.length),
        }
      }

      const claimedOrderItemIds = new Set<string>()
      const proposedLinks = lines.map((line): DteCandidateProposedLink => {
        const code = normalizeCode(line.productCode)
        const name = normalizeName(line.productName)
        const byAliasCode = code
          ? aliases
              .filter((alias) => alias.normalizedCode === code)
              .flatMap((alias) => itemByProductId.get(alias.productId) ?? [])
          : []
        const bySku = code
          ? orderItems.filter((item) => normalizeCode(item.productCode) === code)
          : []
        const byAliasName = name
          ? aliases
              .filter((alias) => alias.normalizedName === name)
              .flatMap((alias) => itemByProductId.get(alias.productId) ?? [])
          : []
        const byName = name.length >= 3
          ? orderItems.filter((item) => {
              const candidateName = normalizeName(item.productName)
              return candidateName.length >= 3 && (name === candidateName || name.includes(candidateName) || candidateName.includes(name))
            })
          : []

        const stages: Array<[DteCandidateMatchType, DteCandidateOrderItem[]]> = [
          ["supplier_alias", byAliasCode.length > 0 ? byAliasCode : byAliasName],
          ["sku", bySku],
          ["name", byName],
        ]

        for (const [matchType, rawCandidates] of stages) {
          const candidates = uniqueItems(rawCandidates).filter((item) => !claimedOrderItemIds.has(item.id))
          if (candidates.length === 0) continue
          const compatible = line.unitOfMeasure
            ? candidates.filter((item) => areEquivalentUnits(item.unitOfMeasure, line.unitOfMeasure))
            : candidates
          if (compatible.length === 0) {
            return { dteItemId: line.id, purchaseOrderItemId: null, matchType: "unit_mismatch", quantityStatus: "not_evaluable" }
          }
          if (compatible.length !== 1) {
            return { dteItemId: line.id, purchaseOrderItemId: null, matchType: "ambiguous", quantityStatus: "not_evaluable" }
          }

          const [matchedItem] = compatible
          claimedOrderItemIds.add(matchedItem!.id)
          const remaining = Math.max(0, matchedItem!.quantity - matchedItem!.invoicedQuantity)
          const difference = line.quantity - remaining
          const quantityStatus = Math.abs(difference) < 0.01 ? "exact" : difference > 0 ? "over" : "under"
          return { dteItemId: line.id, purchaseOrderItemId: matchedItem!.id, matchType, quantityStatus }
        }

        return { dteItemId: line.id, purchaseOrderItemId: null, matchType: "none", quantityStatus: "not_evaluable" }
      })

      const explanation = proposedLinks.reduce((summary, link) => {
        if (link.purchaseOrderItemId) summary.matchedLines += 1
        if (link.matchType === "ambiguous") summary.ambiguousLines += 1
        if (link.matchType === "unit_mismatch") summary.unitMismatches += 1
        if (link.quantityStatus === "exact") summary.quantityExactLines += 1
        if (link.quantityStatus === "under") summary.quantityUnderLines += 1
        if (link.quantityStatus === "over") summary.quantityOverLines += 1
        return summary
      }, emptyExplanation(lines.length))
      const noHardConflict = explanation.ambiguousLines === 0
        && explanation.unitMismatches === 0
        && explanation.quantityOverLines === 0
      const confidence: DteCandidateConfidence = explanation.matchedLines === explanation.totalLines && noHardConflict
        ? "high"
        : explanation.matchedLines > 0 && noHardConflict
          ? "medium"
          : "low"

      return { doc, confidence, referencesOrder, orderReference, amountMatches, amountDifference, proposedLinks, explanation }
    })

  return assessed
    .sort((left, right) => compareAssessments(left, right))
    .slice(0, limit)
}

function compareAssessments(left: DteCandidateAssessment, right: DteCandidateAssessment) {
  // La cita de la OC manda sobre todo lo demás, incluso sobre un documento sin
  // analizar: que el proveedor haya escrito el código de esta orden en el XML
  // pesa más que cualquier cruce de líneas que podamos inferir nosotros. Va
  // primero en el orden, no en `confidence`, porque son señales distintas.
  if (left.referencesOrder !== right.referencesOrder) return left.referencesOrder ? -1 : 1
  const confidenceOrder: Record<DteCandidateConfidence, number> = { high: 0, medium: 1, low: 2, unassessed: 3 }
  const confidence = confidenceOrder[left.confidence] - confidenceOrder[right.confidence]
  if (confidence !== 0) return confidence
  const leftConflicts = left.explanation.ambiguousLines + left.explanation.unitMismatches + left.explanation.quantityOverLines
  const rightConflicts = right.explanation.ambiguousLines + right.explanation.unitMismatches + right.explanation.quantityOverLines
  if (leftConflicts !== rightConflicts) return leftConflicts - rightConflicts
  const leftRatio = left.explanation.totalLines === 0 ? 0 : left.explanation.matchedLines / left.explanation.totalLines
  const rightRatio = right.explanation.totalLines === 0 ? 0 : right.explanation.matchedLines / right.explanation.totalLines
  if (leftRatio !== rightRatio) return rightRatio - leftRatio
  if (left.explanation.quantityExactLines !== right.explanation.quantityExactLines) {
    return right.explanation.quantityExactLines - left.explanation.quantityExactLines
  }
  // Restar los dos infinitos daba NaN, que el motor trata como "iguales": sin
  // monto esperado (una OC ya facturada por completo) el desempate por fecha de
  // abajo no se ejecutaba nunca. Se comparan antes de restar.
  const leftAmount = left.amountDifference ?? Number.POSITIVE_INFINITY
  const rightAmount = right.amountDifference ?? Number.POSITIVE_INFINITY
  if (leftAmount !== rightAmount) return leftAmount - rightAmount
  return right.doc.fechaEmision.localeCompare(left.doc.fechaEmision)
}

/** El separador es seguro porque la normalización deja sólo `[A-Z0-9]`. */
function splitReferencedOrderCodes(value: string | null | undefined): string[] {
  return value ? value.split(",").filter(Boolean) : []
}

/**
 * Parte un código ya normalizado (`20260020`) en año y correlativo. Devuelve
 * null cuando no tiene esa forma: un `SINOC080426` no se despieza.
 */
function splitOrderCodeParts(normalizedOrderCode: string) {
  const match = /^(20\d{2})(\d{1,6})$/.exec(normalizedOrderCode)
  return match ? { year: match[1]!, correlative: match[2]! } : null
}

/** `0020` y `20` son el mismo correlativo; el proveedor escribe cualquiera de los dos. */
function sameCorrelative(left: string, right: string) {
  return /^\d+$/.test(left) && /^\d+$/.test(right) && Number(left) === Number(right)
}

/**
 * Un documento puede citar varias referencias y sólo una manda: se devuelve la
 * más fuerte. Todo se compara ya normalizado, así que un año o un correlativo
 * sueltos sólo cuentan si son los de ESTA orden — los de otra son tan ajenos
 * como el correlativo interno del proveedor.
 */
export function classifyOrderReference(
  normalizedOrderCode: string | null,
  referencedOrderCodes: string | null | undefined,
): DteCandidateOrderReference {
  const codes = splitReferencedOrderCodes(referencedOrderCodes)
  if (normalizedOrderCode === null || codes.length === 0) return "none"
  if (codes.includes(normalizedOrderCode)) return "exact"
  const parts = splitOrderCodeParts(normalizedOrderCode)
  if (parts === null) return "foreign"
  if (codes.some((code) => sameCorrelative(code, parts.correlative))) return "correlative"
  return codes.includes(parts.year) ? "year" : "foreign"
}

function emptyExplanation(totalLines: number) {
  return {
    totalLines,
    matchedLines: 0,
    ambiguousLines: 0,
    unitMismatches: 0,
    quantityExactLines: 0,
    quantityUnderLines: 0,
    quantityOverLines: 0,
  }
}

function uniqueItems(items: DteCandidateOrderItem[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()]
}

export function normalizeSupplierProductCode(value: string | null | undefined) {
  return normalizeCode(value)
}

export function normalizeSupplierProductName(value: string | null | undefined) {
  return normalizeName(value)
}

function normalizeCode(value: string | null | undefined) {
  return value?.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase() ?? ""
}

function normalizeName(value: string | null | undefined) {
  return value?.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? ""
}
