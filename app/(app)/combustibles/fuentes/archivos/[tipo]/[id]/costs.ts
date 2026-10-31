import type { Session } from "next-auth"
import { can } from "@/lib/auth/can"

/**
 * Los montos de un archivo importado sólo se muestran con acceso a costos
 * (`view` y `view_costs`, igual que `assertFuelCostAccess`): importar no da
 * derecho a ver cifras de dinero.
 */
export function canSeeFuelCosts(session: Session): boolean {
  return can(session, "combustibles:view") && can(session, "combustibles:view_costs")
}
