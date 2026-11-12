import {
  estimatedRequestTotal,
  evaluateQuotationRequirement,
  fastPathCoversRequest,
  quotationRequirementMessage,
} from "@/lib/requests/quotation-requirement"
import { formatCLP } from "@/lib/utils"

/** Estados en los que la regla de cotizaciones todavía describe algo: antes de aprobar. */
const OPEN_STATUSES = new Set(["draft", "submitted", "in_review"])

/**
 * Texto que los paneles de cotización muestran en vez del «mínimo 3…» fijo:
 * cuenta cómo está la solicitud frente a la regla única de cotizaciones
 * (`lib/requests/quotation-requirement.ts`), con lo que hay en la base.
 *
 * - La regla falla → el mismo mensaje que daría el servidor al enviar.
 * - La regla pasa y es repuestos bajo el umbral → aviso de que la jefatura puede
 *   aprobar con una cotización o sin ella.
 * - Cualquier otro caso, o una solicitud que ya no está abierta → `null` (el panel
 *   no agrega nada).
 *
 * Servicios usa `thresholdClp: null`: conserva la regla legada, sin umbral ni
 * precios estimados.
 */
export function buildRequirementHint(input: {
  requestType: string
  status: string
  urgency: string
  notes: string | null
  /** Umbral de repuestos en CLP (Parámetros operativos). */
  thresholdClp: number
  /** Totales de las cotizaciones pendientes. */
  quotationTotals: readonly number[]
  items: ReadonlyArray<{
    quantity: number
    estimatedUnitPrice: number | null
    vehicleId: string | null
    workOrderId: string | null
  }>
  /** Estado operacional de los vehículos de los ítems, por id. */
  vehicleStatusById: ReadonlyMap<string, string>
}): string | null {
  if (input.requestType !== "repuestos" && input.requestType !== "servicios") return null
  if (!OPEN_STATUSES.has(input.status)) return null

  const thresholdClp = input.requestType === "repuestos" ? input.thresholdClp : null
  const estimatedTotal = estimatedRequestTotal(input.items)
  // Vía rápida por ítem: una OT vinculada o un equipo que no está operativo.
  const fastPathEligible = fastPathCoversRequest(input.items.map((item) => ({
    quantity: item.quantity,
    estimatedUnitPrice: item.estimatedUnitPrice,
    fastPath: !!item.workOrderId
      || !!(item.vehicleId && (input.vehicleStatusById.get(item.vehicleId) ?? "operativo") !== "operativo"),
  })), thresholdClp)

  const result = evaluateQuotationRequirement({
    quotationTotals: input.quotationTotals,
    estimatedTotal,
    thresholdClp,
    urgency: input.urgency,
    fastPathEligible,
    hasJustification: !!input.notes?.trim(),
  })
  if (!result.ok) return quotationRequirementMessage(result.reason, thresholdClp)

  if (thresholdClp !== null && thresholdClp > 0) {
    const totals = input.quotationTotals.filter((total) => Number.isFinite(total))
    const amount = totals.length > 0 ? Math.max(...totals) : estimatedTotal
    if (amount !== null && amount <= thresholdClp) {
      return `Bajo ${formatCLP(thresholdClp)}: la jefatura puede aprobar con una cotización o sin ella.`
    }
  }
  return null
}
