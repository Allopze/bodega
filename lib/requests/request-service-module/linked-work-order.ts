import { eq } from "drizzle-orm"
import type { Tx } from "@/db"
import { mantWorkOrders } from "@/db/schema"
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
