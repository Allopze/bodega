import type { Tx } from "@/db"
import { recordAudit } from "@/lib/audit"

/**
 * Cargas cuya decisión de revisión (aprobada/rechazada) se reinició porque
 * cambió el dato del que se proyectan: queda auditado en la misma transacción.
 */
export async function auditResetDecisions(
  tx: Tx,
  loadIds: string[],
  actor: { userId: string | null; userEmail?: string },
  worksiteId: string | null,
) {
  for (const loadId of loadIds) {
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "fuel_equipment_load",
      entityId: loadId,
      worksiteId,
      reason: "Cambió la carga de origen; la decisión de revisión vuelve a evaluarse",
    }, tx)
  }
}
