import { eq } from "drizzle-orm"
import type { Tx } from "@/db"
import { fuelVehicles, mantWorkOrders } from "@/db/schema"
import { OT_OPEN_STATUSES, type OtStatus } from "@/lib/mantencion/work-order-states"

/**
 * La OT vinculada a un ítem de solicitud existe, es del equipo del ítem y sigue
 * abierta. Se llama al guardar el borrador (`persist-draft.ts`) y de nuevo al
 * enviar (`submit-request.ts`): una OT puede cerrarse o anularse entre una cosa y
 * la otra, y la vía rápida de cotizaciones cuelga de que siga abierta.
 *
 * `closedHint` se agrega al mensaje de OT cerrada para decir qué hacer en ese paso.
 */
export async function assertLinkedWorkOrderOpen(
  tx: Tx,
  link: { workOrderId: string; vehicleId: string },
  closedHint = "",
): Promise<void> {
  const [workOrder] = await tx
    .select({ vehicleId: mantWorkOrders.vehicleId, status: mantWorkOrders.status })
    .from(mantWorkOrders)
    .where(eq(mantWorkOrders.id, link.workOrderId))
  if (!workOrder || workOrder.vehicleId !== link.vehicleId) throw new Error("La OT no corresponde al equipo elegido")
  if (!(OT_OPEN_STATUSES as readonly OtStatus[]).includes(workOrder.status as OtStatus)) {
    throw new Error(`La OT ya está cerrada o anulada${closedHint}`)
  }
}

/**
 * Por qué el equipo de flota no puede ir en un ítem de la solicitud de esa faena, o `null` si puede: existe, está activo y
 * es de la faena de la solicitud. Es la regla única del vínculo ítem–equipo: `assertItemFleetLink` (`persist-draft.ts`) la
 * convierte en error, y la línea de una nota de pedido SIN OT la usa para NO imponer su equipo de cargo cuando ya no sirve
 * (se dio de baja o se trasladó a otra faena después de pedir): el ítem va sin equipo y el cargo queda en la línea de la nota.
 */
export async function fleetVehicleProblem(tx: Tx, worksiteId: string, vehicleId: string): Promise<string | null> {
  const [vehicle] = await tx
    .select({ worksiteId: fuelVehicles.worksiteId, isActive: fuelVehicles.isActive })
    .from(fuelVehicles)
    .where(eq(fuelVehicles.id, vehicleId))
  if (!vehicle || !vehicle.isActive) return "El equipo seleccionado no existe o está inactivo"
  if (vehicle.worksiteId !== worksiteId) return "El equipo pertenece a otra faena"
  return null
}
