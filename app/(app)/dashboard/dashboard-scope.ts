import type { WorksiteScope } from "@/lib/auth/scope"
import type { OperationalPeriodSpan } from "@/lib/services/operational-period-metrics"
import {
  DEFAULT_DASHBOARD_VIEW,
  parseDashboardView,
  type DashboardView,
  type DashboardViewKey,
} from "./dashboard-views"

/**
 * Alcance global del dashboard: **faena + período**, los dos únicos filtros de
 * la pantalla.
 *
 * Vive en `searchParams` y no en `sessionStorage` a diferencia del orden de la
 * cola, y la distinción importa: esto reencuadra consultas de **servidor**, y un
 * Server Component sólo reconsulta si el alcance viaja en la URL. De paso
 * resuelve la pérdida de estado en `router.refresh()` en vez de sufrirla —
 * con el valor en la URL, el refresh de `WorkCommitmentControl` no lo borra.
 * El orden de la cola sigue en `sessionStorage` porque es preferencia de UI, no
 * alcance de datos.
 *
 * Precedente en el repo: `/prevencion/pdtp` pone año y faena en la URL;
 * `/prevencion/indicadores` pone el año.
 */

export const DASHBOARD_PERIODS = [
  { value: "mes", label: "Mes", comparison: "vs. mes anterior" },
  { value: "trimestre", label: "Trimestre", comparison: "vs. trimestre anterior" },
  { value: "anio", label: "Año", comparison: "vs. año anterior" },
] as const satisfies ReadonlyArray<{ value: OperationalPeriodSpan; label: string; comparison: string }>

export const DEFAULT_DASHBOARD_PERIOD: OperationalPeriodSpan = "mes"

export const ALL_WORKSITES = "all"

export interface DashboardScope {
  /** Faena elegida, o `"all"` para todas las autorizadas. */
  worksiteId: string | typeof ALL_WORKSITES
  period: OperationalPeriodSpan
  /** Nombre de la faena elegida; `null` con `"all"`. Para rótulos. */
  worksiteName: string | null
  /**
   * Vista activa. Vive en el mismo objeto que faena y período porque es lo que
   * la URL dice, y porque todo enlace del tablero debe conservar las tres: sin
   * esto, cambiar de faena te devolvía al Resumen.
   */
  view: DashboardViewKey
}

export interface DashboardScopeSearchParams {
  faena?: string | string[]
  periodo?: string | string[]
  vista?: string | string[]
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function isPeriod(value: string | undefined): value is OperationalPeriodSpan {
  return DASHBOARD_PERIODS.some((period) => period.value === value)
}

/**
 * Resuelve el alcance desde la URL contra las faenas que el usuario **sí**
 * tiene autorizadas.
 *
 * Un `?faena=` desconocido o no autorizado cae a `"all"` en vez de dejar el
 * tablero en cero: el permiso ya es el techo en cada consulta, así que esto no
 * es una barrera de seguridad sino de legibilidad — un id inválido produciría
 * una pantalla de ceros indistinguible de "no hay datos".
 */
export function parseDashboardScope(
  searchParams: DashboardScopeSearchParams,
  authorizedWorksites: ReadonlyArray<{ id: string; name: string }>,
  availableViews: readonly DashboardView[],
): DashboardScope {
  const rawPeriod = firstValue(searchParams.periodo)
  const period = isPeriod(rawPeriod) ? rawPeriod : DEFAULT_DASHBOARD_PERIOD

  const rawWorksite = firstValue(searchParams.faena)
  const match = rawWorksite && rawWorksite !== ALL_WORKSITES
    ? authorizedWorksites.find((worksite) => worksite.id === rawWorksite)
    : undefined

  return {
    worksiteId: match?.id ?? ALL_WORKSITES,
    worksiteName: match?.name ?? null,
    period,
    view: parseDashboardView(firstValue(searchParams.vista), availableViews),
  }
}

/** `undefined` cuando el alcance es "todas": las consultas lo leen como "sin filtro extra". */
export function scopedWorksiteId(scope: DashboardScope): string | undefined {
  return scope.worksiteId === ALL_WORKSITES ? undefined : scope.worksiteId
}

/**
 * Intersecta el alcance de permisos con la faena elegida, en la forma que
 * esperan los servicios que reciben `WorksiteScope` (PDTP, indicadores, EPP).
 *
 * Con una faena elegida el modo pasa a `some` con un solo id **sólo si ese id
 * está dentro del alcance del rol**; si no, `none`. El permiso sigue siendo el
 * techo: elegir una faena nunca amplía lo que se ve.
 */
export function intersectWorksiteScope(base: WorksiteScope, scope: DashboardScope): WorksiteScope {
  const worksiteId = scopedWorksiteId(scope)
  if (!worksiteId) return base
  if (base.mode === "all") return { mode: "some", ids: [worksiteId] }
  // `none` ya no ve nada: elegir una faena no puede devolverle acceso.
  if (base.mode === "none") return base
  return base.ids.includes(worksiteId)
    ? { mode: "some", ids: [worksiteId] }
    : { mode: "none", ids: [] }
}

/** Rótulo del comparativo del período en curso ("vs. mes anterior"). */
export function periodComparisonLabel(period: OperationalPeriodSpan) {
  return DASHBOARD_PERIODS.find((entry) => entry.value === period)?.comparison ?? "vs. período anterior"
}

/** Rótulo del período para las cabeceras de sección ("Trimestre en curso"). */
export function periodScopeLabel(period: OperationalPeriodSpan) {
  switch (period) {
    case "anio": return "Año en curso"
    case "trimestre": return "Trimestre en curso"
    default: return "Mes en curso"
  }
}

/**
 * Título de la lista de flujos del aside. Estaba escrito "Flujo del mes" a mano,
 * así que con el trimestre elegido rotulaba una ventana que no era la suya.
 */
export function periodFlowTitle(period: OperationalPeriodSpan) {
  switch (period) {
    case "anio": return "Flujo del año"
    case "trimestre": return "Flujo del trimestre"
    default: return "Flujo del mes"
  }
}

/** Href que conserva el alcance completo y cambia sólo lo que el patch pide. */
export function dashboardScopeHref(
  scope: DashboardScope,
  patch: Partial<Pick<DashboardScope, "worksiteId" | "period" | "view">>,
) {
  const worksiteId = patch.worksiteId ?? scope.worksiteId
  const period = patch.period ?? scope.period
  const view = patch.view ?? scope.view
  const params = new URLSearchParams()
  // `vista` primero: es lo que el usuario acaba de elegir y lo que verá en la
  // barra de direcciones si copia el enlace.
  if (view !== DEFAULT_DASHBOARD_VIEW) params.set("vista", view)
  if (worksiteId !== ALL_WORKSITES) params.set("faena", worksiteId)
  if (period !== DEFAULT_DASHBOARD_PERIOD) params.set("periodo", period)
  const query = params.toString()
  return query ? `/dashboard?${query}` : "/dashboard"
}
