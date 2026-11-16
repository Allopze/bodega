import { OT_STATUS_LABELS } from "@/lib/mantencion/work-order-states"
import type { FichaFuelSummary, FichaMaintenanceSummary } from "@/lib/services/vehicle-ficha-summary"
import { formatQty } from "@/lib/utils"

/** «Sin órdenes de trabajo abiertas», «OT-0412 asignada» o «3 abiertas; la más reciente, OT-0412 asignada». `null` sin permiso de OT. */
export function openOrdersText(openOrders: FichaMaintenanceSummary["openOrders"]): string | null {
  if (!openOrders) return null
  const { count, latest } = openOrders
  if (count === 0 || !latest) return "sin órdenes de trabajo abiertas"
  const order = `${latest.folio} ${OT_STATUS_LABELS[latest.status].toLowerCase()}`
  return count === 1 ? `orden abierta: ${order}` : `${formatQty(count)} órdenes abiertas; la más reciente, ${order}`
}

/** Lo pendiente del vehículo con la definición del Panel operacional: cargas y pedidos por decidir; los casos, aparte. */
export function fuelPendingText(pending: FichaFuelSummary["pending"]): string {
  const toDecide = pending.carga + pending.pedido
  const parts = [
    toDecide > 0 ? `${formatQty(toDecide)} por decidir` : null,
    pending.caso > 0 ? `${formatQty(pending.caso)} ${pending.caso === 1 ? "caso" : "casos"} en seguimiento` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : "nada pendiente"
}

