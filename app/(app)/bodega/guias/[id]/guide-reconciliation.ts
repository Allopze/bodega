/**
 * Cotejo en faena de una guía enlazada a una OC: qué impide confirmar, por línea.
 *
 * El botón «Confirmar recepción» se deshabilitaba sin decir por qué. Con tres
 * líneas por debajo de lo despachado, cada una pide su propio motivo; quien lo
 * escribía en una sola veía el botón gris y nada más (OC-2026-0065, 2026-11-20:
 * «marco lo que llegó y lo que no, doy el motivo y no me deja»). Las reglas son
 * las de `confirmDispatchGuideReceipt`, escritas una vez para el botón, el aviso
 * de cada campo y el resumen junto al botón.
 */

import { requiresWholeQuantity } from "@/lib/utils"

export interface ReconciliationLine {
  id: string
  name: string
  quantity: number
  unitOfMeasure: string
  receivedQuantity?: number | null
}

/** Largo mínimo del motivo de una diferencia; el servidor exige lo mismo. */
export const MIN_DIFFERENCE_REASON = 5

export type ReconciliationIssue = "invalid_quantity" | "over_pending" | "fractional" | "missing_reason" | "short_reason"

/** Lo que falta por confirmar de la línea. */
export function pendingQuantity(line: ReconciliationLine): number {
  return Math.max(0, line.quantity - (line.receivedQuantity ?? 0))
}

/** Lo que impide confirmar la línea, o null si está lista. */
export function lineIssue(line: ReconciliationLine, receivedText: string | undefined, reason: string | undefined): ReconciliationIssue | null {
  const received = Number(receivedText)
  const remaining = pendingQuantity(line)
  if (!Number.isFinite(received) || received < 0) return "invalid_quantity"
  if (received > remaining + 1e-9) return "over_pending"
  // Antes que el motivo, como en el servidor: «faltó media unidad» no es un
  // motivo, es una cantidad imposible.
  if (requiresWholeQuantity(line.unitOfMeasure) && !Number.isInteger(received)) return "fractional"
  if (remaining - received > 1e-9) {
    const length = reason?.trim().length ?? 0
    if (length === 0) return "missing_reason"
    if (length < MIN_DIFFERENCE_REASON) return "short_reason"
  }
  return null
}

/** El mensaje bajo el campo de la cantidad, o undefined. */
export function quantityError(line: ReconciliationLine, issue: ReconciliationIssue | null): string | undefined {
  if (issue === "invalid_quantity") return "Indica una cantidad de 0 o más."
  if (issue === "over_pending") return `Supera lo pendiente (${pendingQuantity(line)} ${line.unitOfMeasure}).`
  if (issue === "fractional") return "Va en cantidades enteras"
  return undefined
}

/**
 * El mensaje bajo el motivo. Vacío no se marca en rojo apenas aparece el campo
 * —la ayuda ya dice que es obligatorio y el resumen junto al botón lo nombra—;
 * corto sí, porque ahí la persona ya escribió y cree haber terminado.
 */
export function reasonError(issue: ReconciliationIssue | null): string | undefined {
  return issue === "short_reason" ? `Escribe al menos ${MIN_DIFFERENCE_REASON} caracteres.` : undefined
}

/**
 * Por qué no se puede confirmar todavía, nombrando las líneas; null si se puede.
 * Un mismo producto en varias líneas lleva su posición para distinguirlas.
 */
export function blockingSummary(
  lines: readonly ReconciliationLine[],
  received: Record<string, string>,
  reasons: Record<string, string>,
): string | null {
  const totals = new Map<string, number>()
  for (const line of lines) totals.set(line.name, (totals.get(line.name) ?? 0) + 1)
  const seen = new Map<string, number>()
  const label = (line: ReconciliationLine) => {
    const index = (seen.get(line.name) ?? 0) + 1
    seen.set(line.name, index)
    return (totals.get(line.name) ?? 1) > 1 ? `${line.name} (línea ${index})` : line.name
  }

  const needReason: string[] = []
  const badQuantity: string[] = []
  for (const line of lines) {
    const name = label(line)
    const issue = lineIssue(line, received[line.id], reasons[line.id])
    if (issue === "missing_reason" || issue === "short_reason") needReason.push(name)
    else if (issue) badQuantity.push(name)
  }

  const parts: string[] = []
  if (needReason.length > 0) {
    parts.push(`Falta el motivo de la diferencia (mínimo ${MIN_DIFFERENCE_REASON} caracteres) en ${joinNames(needReason)}.`)
  }
  if (badQuantity.length > 0) parts.push(`Revisa la cantidad recibida de ${joinNames(badQuantity)}.`)
  return parts.length > 0 ? parts.join(" ") : null
}

function joinNames(names: string[]): string {
  if (names.length === 1) return names[0]!
  return `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`
}
