/**
 * Regla única de cotizaciones para enviar una solicitud de repuestos o servicios.
 *
 * Hasta el 2026-11-07 la regla («al menos una cotización; con menos de 3, una
 * justificación») vivía copiada en el servidor (`submit-request.ts`) y en tres
 * superficies del cliente, y exigía lo mismo a un filtro de $20.000 que a un
 * motor. La decisión de ese día:
 *
 * - **Repuestos** tiene un umbral configurable (`ops.repuestos.quotation_threshold_clp`).
 *   Hasta ese monto basta una cotización o, sin ninguna, el precio estimado de
 *   todos los ítems. Sobre él vuelve la regla de 3 cotizaciones o justificación.
 * - **Vía rápida de repuestos:** urgencia crítica con el equipo detenido o con
 *   una OT vinculada permite enviar con menos de 3 cotizaciones (incluso sin
 *   ninguna, si hay estimados), pero con la justificación obligatoria.
 * - **Servicios** conserva la regla anterior (sin umbral ni vía rápida):
 *   `thresholdClp: null`.
 *
 * Es pura y no lee la base: el servidor la evalúa dentro de la transacción de
 * envío con los datos bloqueados, y el cliente con lo que tiene en pantalla
 * sólo para avisar antes.
 */

import { formatCLP } from "@/lib/utils"

export type QuotationRequirementReason =
  /** Ni cotización ni precio estimado en todos los ítems. */
  | "no_quotation_or_estimate"
  /** Sobre el umbral (o servicios) sin cotización alguna. */
  | "needs_quotation"
  /** Menos de 3 cotizaciones sin justificación. */
  | "needs_three"
  /** Vía rápida usada sin justificación. */
  | "needs_justification"

export interface QuotationRequirementInput {
  /** Totales de las cotizaciones vigentes (pendientes) de la solicitud. */
  quotationTotals: readonly number[]
  /** Σ cantidad × precio estimado; `null` si algún ítem no tiene precio. */
  estimatedTotal: number | null
  /**
   * Umbral de repuestos en CLP. `null` = regla legada sin umbral ni vía rápida
   * (servicios). `0` = el umbral nunca exime.
   */
  thresholdClp: number | null
  urgency: string
  /** La vía rápida cubre la solicitud (ver `fastPathCoversRequest`). */
  fastPathEligible: boolean
  /** La solicitud trae notas (la justificación vive en las notas generales). */
  hasJustification: boolean
}

export type QuotationRequirementResult =
  | { ok: true }
  | { ok: false; reason: QuotationRequirementReason }

const OK: QuotationRequirementResult = { ok: true }

/** Σ cantidad × precio estimado, o `null` si no hay ítems o a alguno le falta el precio. */
export function estimatedRequestTotal(
  items: ReadonlyArray<{ quantity: number; estimatedUnitPrice: number | null | undefined }>,
): number | null {
  if (items.length === 0) return null
  let total = 0
  for (const item of items) {
    const price = item.estimatedUnitPrice
    if (price == null || !Number.isFinite(price) || !Number.isFinite(item.quantity)) return null
    total += item.quantity * price
  }
  return total
}

/**
 * ¿La vía rápida cubre la solicitud entera?
 *
 * La vía rápida la habilita un ítem con una OT vinculada o con un equipo que no
 * está operativo, pero no puede arrastrar a los demás: una línea barata de una OT
 * no exime del umbral a otra línea de $2.000.000 sin OT. Cubre la solicitud sólo
 * si todos los ítems son de vía rápida, o si los que no lo son suman, por sí
 * solos, un monto estimado conocido bajo el umbral (los que están sobre él
 * siguen exigiendo sus cotizaciones). Sin umbral (servicios) o con umbral 0 los
 * ítems fuera de la vía rápida nunca quedan bajo él.
 */
export function fastPathCoversRequest(
  items: ReadonlyArray<{
    quantity: number
    estimatedUnitPrice: number | null | undefined
    /** Ítem con OT vinculada abierta o con equipo no operativo. */
    fastPath: boolean
  }>,
  thresholdClp: number | null,
): boolean {
  if (!items.some((item) => item.fastPath)) return false
  const rest = items.filter((item) => !item.fastPath)
  if (rest.length === 0) return true
  if (thresholdClp === null || thresholdClp <= 0) return false
  const restTotal = estimatedRequestTotal(rest)
  return restTotal !== null && restTotal <= thresholdClp
}

export function evaluateQuotationRequirement(input: QuotationRequirementInput): QuotationRequirementResult {
  const totals = input.quotationTotals.filter((total) => Number.isFinite(total))

  // Servicios: la regla de siempre, sin umbral, sin estimados y sin vía rápida.
  if (input.thresholdClp === null) {
    if (totals.length === 0) return { ok: false, reason: "needs_quotation" }
    if (totals.length < 3 && !input.hasJustification) return { ok: false, reason: "needs_three" }
    return OK
  }

  if (totals.length === 0 && input.estimatedTotal === null) {
    return { ok: false, reason: "no_quotation_or_estimate" }
  }
  // Con cotizaciones manda la mayor: es el compromiso más caro que se está
  // pidiendo aprobar. Sin ellas, lo que estimó quien pide.
  const amount = totals.length > 0 ? Math.max(...totals) : (input.estimatedTotal as number)
  if (input.thresholdClp > 0 && amount <= input.thresholdClp) return OK
  if (totals.length >= 3) return OK

  const fastPath = input.urgency === "critical" && input.fastPathEligible
  if (totals.length === 0 && !fastPath) return { ok: false, reason: "needs_quotation" }
  if (!input.hasJustification) return { ok: false, reason: fastPath ? "needs_justification" : "needs_three" }
  return OK
}

/** Mensaje en español para el motivo; el mismo en servidor y cliente. */
export function quotationRequirementMessage(
  reason: QuotationRequirementReason,
  thresholdClp: number | null,
): string {
  const over = thresholdClp != null && thresholdClp > 0 ? `Sobre ${formatCLP(thresholdClp)} ` : null
  switch (reason) {
    case "no_quotation_or_estimate":
      return "Adjunta al menos una cotización o indica el precio unitario estimado de todos los ítems."
    case "needs_quotation":
      return over
        ? `${over}se necesita al menos una cotización adjunta.`
        : "Adjunta al menos una cotización antes de enviar la solicitud."
    case "needs_three":
      return over
        ? `${over}se requieren 3 cotizaciones. Si no es posible, agrega una justificación en las notas de la solicitud.`
        : "Se requieren al menos 3 cotizaciones. Si no es posible, agrega una justificación en las notas de la solicitud."
    case "needs_justification":
      return "Urgencia crítica con el equipo detenido o en una OT: puedes enviar con menos de 3 cotizaciones, pero debes justificarlo en las notas de la solicitud."
  }
}
