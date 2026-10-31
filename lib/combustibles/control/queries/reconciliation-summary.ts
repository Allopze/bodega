import "server-only"
import type { Session } from "next-auth"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"

/**
 * Cuadratura de todos los mandantes activos del alcance en el período (Panel,
 * paso 3, y Cuadratura › Por mandante). Contrato de la Fase 0; el cuerpo lo
 * implementa la línea L5 sobre `getReconciliationFlow`.
 */
export interface MandanteReconciliationSummary {
  mandanteId: string
  name: string
  worksiteNames: string[]
  tolerancePct: number
  inLiters: number
  directLiters: number
  viaTankLiters: number
  differenceLiters: number
  /** `null` cuando no entró nada (base cero). */
  differencePct: number | null
  overTolerance: boolean | null
}

export async function getMandantesReconciliationSummary(session: Session, period: ResolvedFuelPeriod): Promise<MandanteReconciliationSummary[]> {
  void session; void period
  // TODO(L5): un resumen por mandante activo, en orden de diferencia absoluta.
  return []
}
