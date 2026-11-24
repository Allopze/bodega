import type { MantViewer } from "../access"
import { loadCorrectiveSummary } from "./corrective"
import { loadPlanningData } from "./planning"
import { loadChecklistMatrix, loadPreventiveCompliance } from "./preventive"
import type { ChecklistMatrix, CorrectiveSummary, LookerContext, PlanningData, PreventiveCompliance } from "./types"

/**
 * Qué consulta cada pestaña y con qué filtros. Lo comparten la pestaña (`planificacion-tab.tsx`, `work-tab.tsx`)
 * y «Exportar Excel», para que el libro traiga exactamente las filas que la pantalla dibuja con los mismos
 * filtros de la URL: la regla «cada bloque ignora la dimensión que él mismo emite» vive aquí y en ningún otro lado.
 */

/**
 * Planificación: la tabla de km ignora el equipo que ella misma emite (queda completa y se resalta la fila); la
 * de horas sí lo aplica y, si es de km, queda vacía con su mensaje contextual.
 */
export async function loadPlanningTabData(
  viewer: MantViewer,
  context: LookerContext,
): Promise<{ kmData: PlanningData; hoursData: PlanningData }> {
  const { filters, cross } = context
  const [kmData, hoursData] = await Promise.all([
    loadPlanningData(viewer, filters, cross, ["equipment"]),
    loadPlanningData(viewer, filters, cross),
  ])
  return { kmData, hoursData }
}

export interface WorkControlOptions {
  /** Pautas de la matriz de checklist (la pantalla muestra las últimas 8). */
  matrixLimit?: number
  /** Equipos de la serie de horas y registros (el gráfico dibuja los 8 con más horas). */
  seriesLimit?: number
}

export interface WorkControlData<TRows> {
  drivers: CorrectiveSummary
  monthly: PreventiveCompliance
  byWorksite: PreventiveCompliance
  byPlate: PreventiveCompliance
  matrix: ChecklistMatrix
  chart: CorrectiveSummary
  /** Las filas de la tabla de trabajos: una página (la pantalla) o todas (el Excel), según `loadRows`. */
  rows: TRows
}

/**
 * Camiones (km) y Máquinas (h). El resumen de conductores se carga primero porque el conductor elegido filtra
 * la tabla de trabajos y el gráfico de equipos; el gráfico ignora el equipo que él mismo emite. `loadRows`
 * recibe los trabajos del conductor elegido (si hay) y devuelve las filas de la tabla: así la pantalla pide una
 * página y el Excel pide todas, sobre el mismo filtro y en paralelo con el gráfico.
 */
export async function loadWorkControlData<TRows>(
  viewer: MantViewer,
  context: LookerContext,
  loadRows: (conductorWorkIds: string[] | undefined) => Promise<TRows>,
  options: WorkControlOptions = {},
): Promise<WorkControlData<TRows>> {
  const { filters, cross } = context
  const [drivers, monthly, byWorksite, byPlate, matrix] = await Promise.all([
    loadCorrectiveSummary(viewer, filters, cross, { ignore: ["conductor"], applyConductor: false }),
    loadPreventiveCompliance(viewer, filters, cross, ["month"]),
    loadPreventiveCompliance(viewer, filters, cross, ["worksite", "mechanic"]),
    loadPreventiveCompliance(viewer, filters, cross, ["equipment"]),
    loadChecklistMatrix(viewer, filters, cross, ["check"], options.matrixLimit),
  ])
  const conductorWorkIds = drivers.selectedDriver?.workIds
  const [chart, rows] = await Promise.all([
    loadCorrectiveSummary(viewer, filters, cross, {
      ignore: ["equipment"],
      applyConductor: true,
      conductorWorkIds,
      ...(options.seriesLimit !== undefined ? { seriesLimit: options.seriesLimit } : {}),
    }),
    loadRows(conductorWorkIds),
  ])
  return { drivers, monthly, byWorksite, byPlate, matrix, chart, rows }
}
