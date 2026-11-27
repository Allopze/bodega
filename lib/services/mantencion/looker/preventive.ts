import type { MantViewer } from "../access"
import { loadComplianceChecks } from "./preventive-checks"
import { summarizeCompliance } from "./preventive-summary"
import type { CrossDimension, LookerFilters, PreventiveCompliance, ResolvedCrossFilters } from "./types"

/**
 * Pestaña Preventivo. Histórico y nativo no se solapan: los formularios cuentan hasta el corte y los registros
 * firmados desde el corte (misma regla que «Trabajos de mantención»). Las pautas se cargan en `preventive-checks.ts`,
 * la matriz en `preventive-matrix.ts` y la ficha de un equipo en `equipment-check-detail.ts`; este módulo es la
 * puerta de entrada de lo que ya existía.
 */
export { loadComplianceChecks } from "./preventive-checks"
export { loadChecklistMatrix } from "./preventive-matrix"

export async function loadPreventiveCompliance(
  viewer: MantViewer,
  filters: LookerFilters,
  cross: ResolvedCrossFilters,
  ignore: readonly CrossDimension[] = [],
): Promise<PreventiveCompliance> {
  const checks = await loadComplianceChecks(viewer, filters, cross, ignore)
  return summarizeCompliance(checks, filters.from, filters.to)
}
