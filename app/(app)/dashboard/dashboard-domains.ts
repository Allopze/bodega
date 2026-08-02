import type { Permission } from "@/modules/permissions"

/**
 * Los cinco dominios en los que se agrupa el tablero bajo el Centro de Control.
 *
 * Cada uno es una sección anclada con su fila de KPIs, sus gráficos y su enlace
 * al módulo que los explica. Sustituyen a los tres grupos de
 * `DashboardAnalyticsSection` ("Operación", "Prevención y SST", "Flota"), que
 * cubrían 6 de ~19 dominios y cuyos gráficos no llevaban a ninguna parte (G-03).
 */

export const DASHBOARD_DOMAIN_KEYS = [
  "adquisiciones",
  "bodega",
  "prevencion",
  "flota",
  "terreno",
  "gobernanza",
] as const

export type DashboardDomainKey = typeof DASHBOARD_DOMAIN_KEYS[number]

export interface DashboardDomain {
  key: DashboardDomainKey
  title: string
  /** Ancla del índice; también el `id` de la `<section>`. */
  anchor: string
  /**
   * Con **ninguno** de estos permisos la sección no existe: no se consulta, no
   * se renderiza y no aparece en el índice.
   */
  permissions: readonly Permission[]
}

export const DASHBOARD_DOMAINS: Record<DashboardDomainKey, DashboardDomain> = {
  adquisiciones: {
    key: "adquisiciones",
    title: "Adquisiciones",
    anchor: "dominio-adquisiciones",
    permissions: ["requests:view_own", "requests:view_all", "purchasing:view", "approvals:approve", "receiving:view"],
  },
  bodega: {
    key: "bodega",
    title: "Bodega y entregas",
    anchor: "dominio-bodega",
    permissions: ["warehouse:view_stock", "deliveries:view", "deliveries:create", "prevention:epp:view"],
  },
  prevencion: {
    key: "prevencion",
    title: "Prevención y SST",
    anchor: "dominio-prevencion",
    permissions: ["prevention:pdtp:view", "prevention:incidents:view", "prevention:capa:view", "prevention:indicadores:view", "prevention:legal:view"],
  },
  flota: {
    key: "flota",
    title: "Flota y combustible",
    anchor: "dominio-flota",
    permissions: ["combustibles:view", "flota:view", "mantenciones:view"],
  },
  terreno: {
    key: "terreno",
    title: "Control preventivo en terreno",
    anchor: "dominio-terreno",
    permissions: ["prevention:inspections:view", "prevention:permits:view", "prevention:emergency:view", "prevention:hygiene:view", "prevention:change:view", "prevention:cphs:view"],
  },
  gobernanza: {
    key: "gobernanza",
    title: "Cumplimiento y gobernanza",
    anchor: "dominio-gobernanza",
    permissions: ["prevention:docs:view", "prevention:training:view", "ppa:view", "sst:view"],
  },
}

/** Permiso que marca a alguien como "mira la plata": decide el orden. */
const MONEY_PERMISSION: Permission = "purchasing:view"

const MONEY_FIRST: readonly DashboardDomainKey[] = ["adquisiciones", "flota", "prevencion", "bodega", "terreno", "gobernanza"]
const PREVENTION_FIRST: readonly DashboardDomainKey[] = ["prevencion", "terreno", "gobernanza", "bodega", "adquisiciones", "flota"]

export function domainIsVisible(domain: DashboardDomain, permissions: readonly string[]) {
  return domain.permissions.some((permission) => permissions.includes(permission))
}

/**
 * Orden de las secciones según el **perfil de permisos**, no según el slug del
 * rol.
 *
 * Gerencia quiere el gasto primero, pero no todos los roles deben abrir con lo
 * mismo: un prevencionista de faena no necesita empezar por las órdenes de
 * compra. Se decide por permiso —igual que las ranuras de la fila superior— para
 * no acoplar la pantalla a una lista de slugs que cambia en `/admin/roles`.
 *
 * Esto **ordena**, no decide visibilidad: un dominio sin ningún permiso ya
 * queda fuera por `domainIsVisible`.
 */
export function orderDashboardDomains(permissions: readonly string[]): DashboardDomain[] {
  const order = permissions.includes(MONEY_PERMISSION) ? MONEY_FIRST : PREVENTION_FIRST
  return order
    .map((key) => DASHBOARD_DOMAINS[key])
    .filter((domain) => domainIsVisible(domain, permissions))
}
