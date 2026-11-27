import type { MantViewer } from "../access"
import { loadPlanningData } from "./planning"
import { loadChecklistMatrix, loadPreventiveCompliance } from "./preventive"
import type { ChecklistMatrix, LookerContext, PlanningData, PreventiveCompliance } from "./types"

/**
 * Qué consulta cada pestaña y con qué filtros. Lo comparten las pestañas (`planificacion-tab.tsx`,
 * `correctivo-tab.tsx`, `preventivo-tab.tsx`) y «Exportar Excel», para que el libro traiga exactamente las filas
 * que la pantalla dibuja con los mismos filtros de la URL: la regla «cada bloque ignora la dimensión que él mismo
 * emite» vive aquí y en ningún otro lado.
 */

/**
 * Planificación (una unidad): la tabla y el gráfico de faltantes emiten `x_equipo` y lo ignoran, así siguen
 * completos y se resalta la fila elegida.
 */
export async function loadPlanningTabData(viewer: MantViewer, context: LookerContext): Promise<PlanningData> {
  return loadPlanningData(viewer, context.filters, context.cross, ["equipment"])
}

/** Correctivo: sus cargadores y la regla de qué ignora cada bloque viven en `corrective-tab-data.ts`. */
export { loadCorrectiveTabData, type CorrectiveTabData, type CorrectiveTabOptions } from "./corrective-tab-data"

export interface PreventiveTabOptions {
  /** Pautas de la matriz de checklist (la pantalla muestra las últimas 8). */
  matrixLimit?: number
}

export interface PreventiveTabData {
  /** Todas las pautas con los filtros (sin ignorar nada): es la tira de cifras. */
  summary: PreventiveCompliance
  monthly: PreventiveCompliance
  byWorksite: PreventiveCompliance
  byPlate: PreventiveCompliance
  matrix: ChecklistMatrix
}

/** Preventivo. Cada bloque ignora la dimensión que él mismo emite, así el clic no lo vacía. */
export async function loadPreventiveTabData(
  viewer: MantViewer,
  context: LookerContext,
  options: PreventiveTabOptions = {},
): Promise<PreventiveTabData> {
  const { filters, cross } = context
  const [summary, monthly, byWorksite, byPlate, matrix] = await Promise.all([
    loadPreventiveCompliance(viewer, filters, cross),
    loadPreventiveCompliance(viewer, filters, cross, ["month"]),
    loadPreventiveCompliance(viewer, filters, cross, ["worksite", "mechanic"]),
    loadPreventiveCompliance(viewer, filters, cross, ["equipment"]),
    loadChecklistMatrix(viewer, filters, cross, ["check"], options.matrixLimit),
  ])
  return { summary, monthly, byWorksite, byPlate, matrix }
}
