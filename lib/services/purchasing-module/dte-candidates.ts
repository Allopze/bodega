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
import { areEquivalentUnits } from "./invoice-item-matching"

export interface DteCandidateInput {
  id: string
  rutEmisor: string
  /** 'YYYY-MM-DD' — el portal la entrega así y la columna es texto. */
  fechaEmision: string
  montoTotal: number
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

const DEFAULT_LIMIT = 20

/** Diferencia máxima, en pesos, para dar el monto por coincidente. */
const AMOUNT_TOLERANCE_CLP = 1

export interface DteCandidate<T> {
  doc: T
  /** True si el monto del DTE calza con lo que la OC espera facturar. */
  amountMatches: boolean
}

export type DteCandidateConfidence = "high" | "medium" | "low" | "unassessed"
export type DteCandidateMatchType = "supplier_alias" | "sku" | "name" | "ambiguous" | "unit_mismatch" | "none"

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
}

/**
 * Devuelve, del conjunto ya acotado a documentos sin vincular, los que pueden
 * corresponder a esta orden: mismo proveedor y emitidos desde que la orden
 * existe. Preserva el orden recibido (la consulta los trae por fecha desc).
 *
 * Una OC cargada de forma retroactiva sobre una compra ya facturada no verá
 * candidatos. Es deliberado: para ese caso queda la subida manual, que es
 * exactamente como se trabajaba antes de que esto existiera.
 */
export function selectDteCandidates<T extends DteCandidateInput>(
  unlinkedDocs: T[],
  { supplierRut, createdOn, expectedAmount, limit = DEFAULT_LIMIT }: DteCandidateFilter,
): DteCandidate<T>[] {
  if (!supplierRut) return []
  const normalized = cleanRut(supplierRut)
  if (!normalized) return []

  const eligible = unlinkedDocs.filter(
    (doc) => cleanRut(doc.rutEmisor) === normalized && doc.fechaEmision >= createdOn,
  )

  const target = typeof expectedAmount === "number" && expectedAmount > 0 ? expectedAmount : null
  const distance = (doc: T) => (target === null ? null : Math.abs(doc.montoTotal - target))

  // Orden: primero el monto que calza, después por cercanía, y a igualdad por
  // fecha descendente (el orden en que llegaron de la consulta). Con un
  // proveedor recurrente eso pone arriba el documento que se está buscando en
  // vez de obligar a leer quince líneas.
  const sorted = target === null
    ? eligible
    : [...eligible].sort((a, b) => (distance(a)! - distance(b)!))

  return sorted.slice(0, limit).map((doc) => ({
    doc,
    amountMatches: target !== null && Math.abs(doc.montoTotal - target) <= AMOUNT_TOLERANCE_CLP,
  }))
}

/**
 * Evalúa evidencia persistida del XML sin llamar al portal durante el render.
 * La identidad del producto manda sobre monto y cantidad; estos últimos sólo
 * explican cobertura y desempatan documentos que ya identificaron sus líneas.
 */
export function assessDteCandidates<T extends DteCandidateDocumentInput>(
  unlinkedDocs: T[],
  { supplierRut, createdOn, expectedAmount, limit = DEFAULT_LIMIT, orderItems, aliases }: DteCandidateAssessmentFilter,
): DteCandidateAssessment<T>[] {
  if (!supplierRut || !cleanRut(supplierRut)) return []
  const supplier = cleanRut(supplierRut)
  const target = typeof expectedAmount === "number" && expectedAmount > 0 ? expectedAmount : null
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
      const amountMatches = amountDifference !== null && amountDifference <= AMOUNT_TOLERANCE_CLP
      const lines = doc.lines ?? []
      if (doc.enrichmentStatus !== "ready" || lines.length === 0) {
        return {
          doc,
          confidence: "unassessed",
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

      return { doc, confidence, amountMatches, amountDifference, proposedLinks, explanation }
    })

  return assessed
    .sort((left, right) => compareAssessments(left, right))
    .slice(0, limit)
}

function compareAssessments(left: DteCandidateAssessment, right: DteCandidateAssessment) {
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
  const amount = (left.amountDifference ?? Number.POSITIVE_INFINITY) - (right.amountDifference ?? Number.POSITIVE_INFINITY)
  if (amount !== 0) return amount
  return right.doc.fechaEmision.localeCompare(left.doc.fechaEmision)
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
