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
 * `resumen` es propia; el resto son los dominios de `dashboard-domains.ts`, así
 * que el gating y el orden se heredan de allí en vez de duplicarse.
 *
 * La vista "Mi trabajo" **ya no existe** (decisión de producto, ronda UI/UX
 * 2026-10-05): duplicaba `/pendientes` y se comportaba distinto (INI-07). Su
 * lugar lo toma el bloque "Hoy" del Resumen, y `?vista=trabajo` redirige a
 * `/pendientes` (ver `page.tsx`, `LEGACY_WORK_VIEW`).
 */

export const DASHBOARD_VIEW_KEYS = ["resumen", ...DASHBOARD_DOMAIN_KEYS] as const

/** Slug retirado: se conserva sólo para redirigir los enlaces guardados. */
export const LEGACY_WORK_VIEW = "trabajo"

export type DashboardViewKey = (typeof DASHBOARD_VIEW_KEYS)[number]

export const DEFAULT_DASHBOARD_VIEW = "resumen" satisfies DashboardViewKey

export interface DashboardView {
  key: DashboardViewKey
  /** Rótulo de la pestaña: corto, porque la barra scrollea horizontalmente. */
  title: string
  /** Una línea para el menú "Por área": qué cifras trae la vista. */
  description: string
  /** Sin **ninguno** de estos permisos la vista no existe. Vacío = siempre. */
  permissions: readonly Permission[]
}

const RESUMEN: DashboardView = {
  key: "resumen",
  title: "Resumen",
  description: "Lo urgente de hoy y el panorama de todas tus áreas.",
  permissions: [],
}

export function availableDashboardViews(permissions: readonly string[]): DashboardView[] {
  const views: DashboardView[] = [RESUMEN]

  for (const domain of orderDashboardDomains(permissions)) {
    views.push({ key: domain.key, title: domain.shortTitle, description: domain.description, permissions: domain.permissions })
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

/** Discrimina la vista propia (Resumen) de las que delegan en una sección de dominio. */
export function isDomainView(view: DashboardViewKey): view is DashboardDomainKey {
  return view !== "resumen"
}

/**
 * INI-05 (auditoría 2026-10-05): qué vistas tienen **al menos una cifra** que
 * cambia con el período Mes/Trimestre/Año.
 *
 * El selector se mostraba siempre y en Mi trabajo, Prevención y Gobernanza no
 * cambiaba nada (en Flota sólo una cifra). Un control que no hace nada enseña a
 * desconfiar de los que sí. Esta tabla se deriva del código de cada sección:
 *
 * - `resumen`: los flujos del período (solicitudes, OC, recepciones, entregas).
 * - `finanzas`, `adquisiciones`, `bodega`: consultas acotadas por `scope.period`.
 * - `terreno`: sólo el cumplimiento de inspecciones, pero es una cifra real.
 * - `flota`: sólo la brecha TAE vs. facturado (`combustibles:tae_view`); sin ese
 *   permiso la vista entera es estado actual o 6 meses fijos.
 * - `prevencion`: tasas y eventos anuales por norma, el PDTP del año.
 * - `gobernanza`: documentos, acuses y capacitación son estado actual y los PPA
 *   no se acotan por fecha.
 *
 * Una sección nueva que lea `scope.period` debe sumarse acá; el test de esta
 * tabla recorre todas las vistas para que no quede una sin decidir.
 */
const PERIOD_RESPONSE: Record<DashboardViewKey, { responsive: boolean; requires?: Permission }> = {
  resumen: { responsive: true },
  finanzas: { responsive: true },
  adquisiciones: { responsive: true },
  bodega: { responsive: true },
  prevencion: { responsive: false },
  flota: { responsive: true, requires: "combustibles:tae_view" },
  terreno: { responsive: true },
  gobernanza: { responsive: false },
}

export function viewRespondsToPeriod(view: DashboardViewKey, permissions: readonly string[]): boolean {
  const entry = PERIOD_RESPONSE[view]
  if (!entry.responsive) return false
  return entry.requires ? permissions.includes(entry.requires) : true
}

/** Rótulo fijo que ocupa el lugar del selector cuando la vista no responde al período. */
export const PERIOD_FIXED_LABEL = "Estado al día de hoy"
