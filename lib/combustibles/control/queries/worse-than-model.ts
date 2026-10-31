import "server-only"
import type { Session } from "next-auth"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"

/**
 * Equipos que rinden más de 10 % peor que su modelo en el período (Panel,
 * paso 4). Contrato de la Fase 0; el cuerpo lo implementa la línea L6 en SQL,
 * sin paginar (hoy `worseThanModel` se calcula en JS después de paginar).
 */
export interface WorseThanModelSummary {
  count: number
  examples: { vehicleId: string; code: string; familyLabel: string; deltaPct: number }[]
}

export async function countEquipmentWorseThanModel(session: Session, period: ResolvedFuelPeriod, limit = 3): Promise<WorseThanModelSummary> {
  void session; void period; void limit
  // TODO(L6)
  return { count: 0, examples: [] }
}
