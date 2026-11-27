import { nameKey } from "@/lib/mantencion/normalize"
import { roundQty } from "@/lib/services/stock-reservations"
import { codeYear } from "@/lib/utils"
import { clip, compactKey, testNoteReason } from "./normalize"
import type { Resolvers } from "./resolvers"
import type { ChargeResolution, ErpItem, ErpNote, ExclusionRule, ExistingNote, InvalidNote, PlannedLine, PlannedNote } from "./types"

/**
 * Decide, SIN tocar la base, qué hace la importación con cada nota del archivo. Es lo que muestra la simulación y lo que
 * `apply.ts` escribe tal cual. Orden de decisión por nota:
 *
 *   inválida → ya importada (por `external_ref`) → de prueba → faena sin calce → se importa
 *
 * Reglas de lo que se importa:
 *  - El estado se copia tal cual (Enviada, Aceptada, En espera, Rechazada, Cerrada); ninguna línea ni cabecera se recalcula.
 *  - Líneas: Enviada/Aceptada/En espera quedan `pendiente`; Rechazada, `rechazada` con el motivo; Cerrada, `en_compra` SIN
 *    compra viva. Es la única resolución que los CHECK de la línea permiten para «llegó a la faena» sin tocar stock:
 *    `desde_stock` exige producto y reserva, y `deriveNoteStatus` con `en_compra` sin compra viva da `cerrada` (no la reabre).
 *  - El texto del artículo se conserva SIEMPRE en `description`. Producto, proveedor y cargo se calzan en exacto o quedan
 *    vacíos (`product_id` null, `supplier_hint`, `charge_text`) y van a los informes de pendientes. El cargo a un equipo sólo calza con
 *    uno activo y de la faena de la nota (`resolvers.charge`): si no, queda como texto con su motivo.
 */

export const NOTES_MAX = 500
export const DESCRIPTION_MAX = 300
const MIGRATED_HOLD_REASON = "Migrada desde CHOME ERP"
const REJECTED_REASON = "Rechazada en CHOME ERP"
const CLOSED_REASON = "Cerrada en CHOME ERP: lo pedido llegó a la faena"

export interface PendingCharge { externalRef: string; createdAt: string; faena: string; articulo: string; cargo: string; reason: string }
export interface UnmatchedArticle { articulo: string; codigo: string | null; lines: number; quantity: number; notes: number }
export interface UnmatchedSupplier { proveedor: string; lines: number; notes: number }
export interface UnmatchedWorksite { faena: string; notes: number; lines: number; refs: string[] }
export interface ExcludedNote { externalRef: string; createdAt: string; solicitante: string | null; observacion: string | null; reason: string }
export interface AlreadyImported extends ExistingNote { createdAt: string }

export interface ImportPlan {
  /** Ordenadas por fecha: el folio `NP` que recibe cada una sigue el orden de CHOME. */
  toImport: PlannedNote[]
  alreadyImported: AlreadyImported[]
  excluded: ExcludedNote[]
  worksiteUnmatched: UnmatchedWorksite[]
  invalid: InvalidNote[]
  pendingCharges: PendingCharge[]
  articlesWithoutMatch: UnmatchedArticle[]
  suppliersWithoutMatch: UnmatchedSupplier[]
  /** Cuántas notas del archivo se leyeron (válidas o no). */
  totalInFile: number
}

interface Accumulators {
  charges: PendingCharge[]
  articles: Map<string, UnmatchedArticle & { refs: Set<string> }>
  suppliers: Map<string, UnmatchedSupplier & { refs: Set<string> }>
}

interface LineOutcome { line: PlannedLine; productMissing: boolean; supplierMissing: boolean; charge: ChargeResolution }

const enoughReason = (value: string | null) => (value && value.length >= 5 ? value : null)

function lineResolution(note: ErpNote): Pick<PlannedLine, "resolution" | "resolutionReason"> {
  if (note.estado === "rechazada") return { resolution: "rechazada", resolutionReason: enoughReason(note.motivo) ?? REJECTED_REASON }
  if (note.estado === "cerrada") return { resolution: "en_compra", resolutionReason: CLOSED_REASON }
  return { resolution: "pendiente", resolutionReason: null }
}

/** La línea lista para escribir, o el motivo (texto) por el que la nota entera no se puede importar. */
function planLine(note: ErpNote, item: ErpItem, index: number, worksiteId: string, resolvers: Resolvers, warnings: string[]): LineOutcome | string {
  const quantity = roundQty(item.cantidad)
  if (quantity <= 0) return `línea ${index + 1}: la cantidad ${item.cantidad} se redondea a cero`
  const description = clip(item.articulo, DESCRIPTION_MAX)
  if (description.clipped) warnings.push(`Línea ${index + 1}: el artículo tenía ${item.articulo.length} caracteres y se recortó a ${DESCRIPTION_MAX}`)
  const product = resolvers.product(item.articulo, item.codigo)
  const supplierId = item.proveedor ? resolvers.supplierId(item.proveedor) : null
  const charge = resolvers.charge(item.cargo, worksiteId)
  return {
    productMissing: !product,
    supplierMissing: !!item.proveedor && !supplierId,
    charge,
    line: {
      sortOrder: index,
      description: description.text,
      quantity,
      unitOfMeasure: product?.unitOfMeasure ?? "unidad",
      partNumber: item.codigo,
      productId: product?.id ?? null,
      chargeVehicleId: charge.kind === "vehicle" ? charge.vehicleId : null,
      chargeCostCenterId: charge.kind === "costCenter" ? charge.costCenterId : null,
      chargeText: charge.kind === "pending" ? charge.chargeText : null,
      suggestedSupplierId: supplierId,
      supplierHint: item.proveedor && !supplierId ? item.proveedor : null,
      ...lineResolution(note),
    },
  }
}

/** Anota en los informes de pendientes lo que quedó sin calce en una línea de una nota que SÍ se importa. */
function record(acc: Accumulators, note: ErpNote, item: ErpItem, outcome: LineOutcome, worksiteName: string) {
  const { line } = outcome
  if (outcome.productMissing) {
    const key = `${nameKey(item.articulo)}|${compactKey(item.codigo)}`
    const entry = acc.articles.get(key) ?? { articulo: item.articulo, codigo: item.codigo, lines: 0, quantity: 0, notes: 0, refs: new Set<string>() }
    entry.lines += 1
    entry.quantity = roundQty(entry.quantity + line.quantity)
    entry.refs.add(note.externalRef)
    entry.notes = entry.refs.size
    acc.articles.set(key, entry)
  }
  if (outcome.supplierMissing && item.proveedor) {
    const key = nameKey(item.proveedor)
    const entry = acc.suppliers.get(key) ?? { proveedor: item.proveedor, lines: 0, notes: 0, refs: new Set<string>() }
    entry.lines += 1
    entry.refs.add(note.externalRef)
    entry.notes = entry.refs.size
    acc.suppliers.set(key, entry)
  }
  if (outcome.charge.kind === "pending") {
    acc.charges.push({ externalRef: note.externalRef, createdAt: note.createdAt, faena: worksiteName, articulo: item.articulo, cargo: outcome.charge.chargeText, reason: outcome.charge.reason })
  }
}

/** La observación (con el motivo de origen cuando no cabe en otro campo), recortada al máximo de la columna. */
function noteText(note: ErpNote, warnings: string[]): string | null {
  const motivoUsed = (note.estado === "rechazada" || note.estado === "en_espera") && enoughReason(note.motivo)
  const parts = [note.observacion, note.motivo && !motivoUsed ? `Motivo en CHOME ERP: ${note.motivo}` : null].filter((part): part is string => !!part)
  if (parts.length === 0) return null
  const text = clip(parts.join(" · "), NOTES_MAX)
  if (text.clipped) warnings.push(`La observación tenía más de ${NOTES_MAX} caracteres y se recortó`)
  return text.text
}

export function planNotes(input: {
  notes: readonly ErpNote[]
  invalid: readonly InvalidNote[]
  resolvers: Resolvers
  existing: ReadonlyMap<string, ExistingNote>
  rule: ExclusionRule
}): ImportPlan {
  const { resolvers } = input
  const acc: Accumulators = { charges: [], articles: new Map(), suppliers: new Map() }
  const plan: ImportPlan = {
    toImport: [], alreadyImported: [], excluded: [], worksiteUnmatched: [], invalid: [...input.invalid],
    pendingCharges: [], articlesWithoutMatch: [], suppliersWithoutMatch: [], totalInFile: input.notes.length + input.invalid.length,
  }
  const unmatchedSites = new Map<string, UnmatchedWorksite>()

  for (const note of input.notes) {
    const existing = input.existing.get(note.externalRef)
    if (existing) { plan.alreadyImported.push({ ...existing, createdAt: note.createdAt }); continue }

    const testReason = testNoteReason(note, input.rule)
    if (testReason) {
      plan.excluded.push({ externalRef: note.externalRef, createdAt: note.createdAt, solicitante: note.solicitante ?? note.usuario, observacion: note.observacion, reason: testReason })
      continue
    }

    const worksiteId = resolvers.worksiteId(note.faena)
    if (!worksiteId) {
      const key = nameKey(note.faena)
      const entry = unmatchedSites.get(key) ?? { faena: note.faena, notes: 0, lines: 0, refs: [] }
      entry.notes += 1
      entry.lines += note.items.length
      entry.refs.push(note.externalRef)
      unmatchedSites.set(key, entry)
      continue
    }

    const warnings: string[] = []
    const worksiteName = resolvers.worksiteName(worksiteId)
    const outcomes: LineOutcome[] = []
    const errors: string[] = []
    note.items.forEach((item, index) => {
      const outcome = planLine(note, item, index, worksiteId, resolvers, warnings)
      if (typeof outcome === "string") errors.push(outcome)
      else outcomes.push(outcome)
    })
    // Una línea imposible deja la nota entera afuera, y entonces ninguna de sus líneas cuenta en los informes de pendientes.
    if (errors.length) { plan.invalid.push({ position: null, externalRef: note.externalRef, errors }); continue }
    outcomes.forEach((outcome, index) => record(acc, note, note.items[index]!, outcome, worksiteName))

    const holdReason = note.estado === "en_espera" ? enoughReason(note.motivo) ?? MIGRATED_HOLD_REASON : null
    const requestedByName = note.solicitante ?? note.usuario
    plan.toImport.push({
      externalRef: note.externalRef,
      erpId: note.erpId,
      createdAt: note.createdAt,
      folioYear: codeYear(note.createdAt),
      worksiteId,
      worksiteName,
      requestedByUserId: resolvers.userId(note.usuario, note.solicitante),
      requestedByName,
      urgent: note.urgente,
      notes: noteText(note, warnings),
      status: note.estado,
      holdReason,
      lines: outcomes.map((outcome) => outcome.line),
      warnings,
    })
  }

  plan.toImport.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || Number(a.erpId) - Number(b.erpId))
  plan.worksiteUnmatched = [...unmatchedSites.values()].sort((a, b) => b.notes - a.notes || a.faena.localeCompare(b.faena, "es"))
  plan.pendingCharges = acc.charges
  plan.articlesWithoutMatch = [...acc.articles.values()].map(({ refs: _refs, ...entry }) => entry).sort((a, b) => b.lines - a.lines || a.articulo.localeCompare(b.articulo, "es"))
  plan.suppliersWithoutMatch = [...acc.suppliers.values()].map(({ refs: _refs, ...entry }) => entry).sort((a, b) => b.lines - a.lines || a.proveedor.localeCompare(b.proveedor, "es"))
  return plan
}
