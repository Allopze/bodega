import type { Tx } from "@/db"
import type { SystemWorkOrderInput, WorkOrderActor } from "./types"

/**
 * Fase 0: firmas fijas. La implementación la escribe la línea de servidor (L1);
 * las inspecciones (L5) ya pueden llamarlas.
 */

/**
 * Crea una OT dentro de la transacción del llamador (p. ej. al derivar un
 * hallazgo de inspección). No valida permisos de OT: el llamador ya validó los
 * suyos. Devuelve el id y el folio; el aviso se dispara después del commit con
 * `notifyWorkOrderCreated`.
 */
export async function createWorkOrderWithClient(
  _tx: Tx,
  _input: SystemWorkOrderInput,
  _actor: Pick<WorkOrderActor, "userId" | "name">,
): Promise<{ id: string; folio: string; worksiteId: string }> {
  throw new Error("createWorkOrderWithClient: no implementado (fase 0)")
}

/** Aviso «OT nueva» a la jefatura de mantención de la faena. Llamar DESPUÉS del commit. */
export async function notifyWorkOrderCreated(_workOrderId: string): Promise<void> {
  throw new Error("notifyWorkOrderCreated: no implementado (fase 0)")
}
