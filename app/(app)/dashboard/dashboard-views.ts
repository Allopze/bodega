import type { Permission } from "@/modules/permissions"
import {
  DASHBOARD_DOMAIN_KEYS,
  orderDashboardDomains,
  type DashboardDomainKey,
} from "./dashboard-domains"

/**
 * Las vistas del tablero: **una se pinta a la vez**.
 *
 * Reemplazan a las seis secciones apiladas, que sumaban ~8.600 px de scroll en
 * 1920 y ~12.700 px en móvil, y que además consultaban las seis en paralelo cada
 * carga (sólo Adquisiciones dispara ~20 consultas). Con el selector se consulta
 * la vista activa y nada más.
 *
 * `resumen` y `trabajo` son propias; el resto son los dominios de
 * `dashboard-domains.ts`, así que el gating y el orden se heredan de allí en vez
 * de duplicarse.
 */

export const DASHBOARD_VIEW_KEYS = ["resumen", "trabajo", ...DASHBOARD_DOMAIN_KEYS] as const

export type DashboardViewKey = (typeof DASHBOARD_VIEW_KEYS)[number]

export const DEFAULT_DASHBOARD_VIEW = "resumen" satisfies DashboardViewKey

export interface DashboardView {
  key: DashboardViewKey
  /** Rótulo de la pestaña: corto, porque la barra scrollea horizontalmente. */
  title: string
  /** Sin **ninguno** de estos permisos la vista no existe. Vacío = siempre. */
  permissions: readonly Permission[]
}

const RESUMEN: DashboardView = { key: "resumen", title: "Resumen", permissions: [] }

/**
 * `operations:view_work` es el permiso que ya gobierna `/pendientes` y la cola
 * operacional (`modules/operations/manifest.ts`). Sin él la pestaña mostraría
 * una tabla vacía con un contador en cero.
 */
const TRABAJO: DashboardView = { key: "trabajo", title: "Mi trabajo", permissions: ["operations:view_work"] }

export function availableDashboardViews(permissions: readonly string[]): DashboardView[] {
  const granted = new Set(permissions)
  const views: DashboardView[] = [RESUMEN]

  if (TRABAJO.permissions.some((permission) => granted.has(permission))) views.push(TRABAJO)

  for (const domain of orderDashboardDomains(permissions)) {
    views.push({ key: domain.key, title: domain.shortTitle, permissions: domain.permissions })
  }

  return views
}

/**
 * Un `?vista=` que el rol no tiene autorizado cae al Resumen.
 *
 * No es una barrera de seguridad —cada consulta sigue gateada por su permiso—
 * sino de legibilidad: sin esto, escribir `?vista=finanzas` sin `billing:view`
 * pintaba una vista de ceros indistinguible de "no hay datos".
 */
export function parseDashboardView(
  raw: string | undefined,
  available: readonly DashboardView[],
): DashboardViewKey {
  return available.some((view) => view.key === raw)
    ? (raw as DashboardViewKey)
    : DEFAULT_DASHBOARD_VIEW
}

/** Discrimina las dos vistas propias de las que delegan en una sección de dominio. */
export function isDomainView(view: DashboardViewKey): view is DashboardDomainKey {
  return view !== "resumen" && view !== "trabajo"
}
