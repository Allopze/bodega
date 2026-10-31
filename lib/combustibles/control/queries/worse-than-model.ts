import "server-only"
import type { Session } from "next-auth"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { PERFORMANCE_FAMILY_LABELS, type PerformanceFamily } from "@/lib/combustibles/control/contracts"
import { getEquipmentWorseSummary } from "./performance"
import { controlFiltersFromPeriod } from "./period-filters"

/**
 * Equipos que rinden más de 10 % peor que su modelo o que su propio historial
 * de 12 meses en el período (Panel, paso 4). Contrato de la Fase 0: la firma es
 * la del Panel; el cuerpo es de la línea L6 y calcula todo en SQL, sin paginar
 * (antes `worseThanModel` se calculaba en JS después de paginar).
 *
 * km/L: menos es peor; L/h: más es peor. No cuentan las cargas por decidir, las
 * que no cuentan (rechazadas) ni las anuladas o duplicadas. El alcance de faena
 * del usuario manda; `options` sólo lo acota más.
 */
export interface WorseThanModelSummary {
  count: number
  examples: { vehicleId: string; code: string; familyLabel: string; deltaPct: number }[]
}

export interface WorseThanModelOptions {
  worksiteId?: string
  mandanteId?: string
}

export async function countEquipmentWorseThanModel(
  session: Session,
  period: ResolvedFuelPeriod,
  limit = 3,
  options: WorseThanModelOptions = {},
): Promise<WorseThanModelSummary> {
  const filters = { ...controlFiltersFromPeriod(period), worksiteId: options.worksiteId, mandanteId: options.mandanteId }
  const summary = await getEquipmentWorseSummary(session, filters, limit)
  return {
    count: summary.worse,
    examples: summary.examples.map((example) => ({
      vehicleId: example.vehicleId,
      code: example.code ?? example.plate,
      familyLabel: (example.family && PERFORMANCE_FAMILY_LABELS[example.family as PerformanceFamily]) || example.typeName || "Sin familia",
      deltaPct: example.deltaPct,
    })),
  }
}
