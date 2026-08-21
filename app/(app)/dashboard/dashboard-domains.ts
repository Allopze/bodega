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
  "finanzas",
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
  /**
   * Rótulo de la pestaña. `title` no sirve: "Control preventivo en terreno" y
   * "Cumplimiento y gobernanza" empujaban la barra a scroll horizontal ya en el
   * primer render a 1366.
   */
  shortTitle: string
  /** `id` de la `<section>` y destino de los enlaces profundos al dominio. */
  anchor: string
  /**
   * Con **ninguno** de estos permisos la sección no existe: no se consulta, no
   * se renderiza y no aparece en el índice.
   */
  permissions: readonly Permission[]
}

export const DASHBOARD_DOMAINS: Record<DashboardDomainKey, DashboardDomain> = {
  finanzas: {
    key: "finanzas",
    title: "Finanzas",
    shortTitle: "Finanzas",
    anchor: "dominio-finanzas",
    /*
     * Cubre las dos direcciones del dinero: `billing:view` la venta
     * (facturación y cobranza), `purchasing:view` la compra (gasto en OC), y
     * `combustibles:view_costs` el costo de combustible y su deuda. Basta uno:
     * quien sólo ve compras entra igual y ve su mitad de la sección.
     */
    permissions: ["billing:view", "purchasing:view", "combustibles:view_costs"],
  },
  adquisiciones: {
    key: "adquisiciones",
    title: "Adquisiciones",
    shortTitle: "Adquisiciones",
    anchor: "dominio-adquisiciones",
    permissions: ["requests:view_own", "requests:view_all", "purchasing:view", "approvals:approve", "receiving:view"],
  },
  bodega: {
    key: "bodega",
    title: "Bodega y entregas",
    shortTitle: "Bodega",
    anchor: "dominio-bodega",
    permissions: ["warehouse:view_stock", "deliveries:view", "deliveries:create", "prevention:epp:view"],
  },
  prevencion: {
    key: "prevencion",
    title: "Prevención y SST",
    shortTitle: "Prevención",
    anchor: "dominio-prevencion",
    permissions: ["prevention:pdtp:view", "prevention:incidents:view", "prevention:capa:view", "prevention:indicadores:view", "prevention:legal:view"],
  },
  flota: {
    key: "flota",
    title: "Flota y combustible",
    shortTitle: "Flota",
    anchor: "dominio-flota",
    permissions: ["combustibles:view", "flota:view", "mantenciones:view"],
  },
  terreno: {
    key: "terreno",
    title: "Control preventivo en terreno",
    shortTitle: "Terreno",
    anchor: "dominio-terreno",
    permissions: ["prevention:inspections:view", "prevention:permits:view", "prevention:emergency:view", "prevention:hygiene:view", "prevention:change:view", "prevention:cphs:view"],
  },
  gobernanza: {
    key: "gobernanza",
    title: "Cumplimiento y gobernanza",
    shortTitle: "Gobernanza",
    anchor: "dominio-gobernanza",
    permissions: ["prevention:docs:view", "prevention:training:view", "ppa:view", "sst:view"],
  },
}

/**
 * Permisos que marcan a alguien como "mira la plata": deciden el orden.
 *
 * Era sólo `purchasing:view`. Con Finanzas hay un perfil nuevo —quien ve la
 * cobranza pero no emite OC— que también debe abrir por dinero.
 */
const MONEY_PERMISSIONS: readonly Permission[] = ["purchasing:view", "billing:view"]

const MONEY_FIRST: readonly DashboardDomainKey[] = ["finanzas", "adquisiciones", "flota", "prevencion", "bodega", "terreno", "gobernanza"]
const PREVENTION_FIRST: readonly DashboardDomainKey[] = ["prevencion", "terreno", "gobernanza", "bodega", "adquisiciones", "flota", "finanzas"]

function domainIsVisibleForPermissions(domain: DashboardDomain, permissions: ReadonlySet<string>) {
  if (domain.key === "finanzas") {
    return permissions.has("billing:view")
      || permissions.has("purchasing:view")
      || (permissions.has("combustibles:view") && permissions.has("combustibles:view_costs"))
  }
  return domain.permissions.some((permission) => permissions.has(permission))
}

export function domainIsVisible(domain: DashboardDomain, permissions: readonly string[]) {
  return domainIsVisibleForPermissions(domain, new Set(permissions))
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
  const permissionSet = new Set(permissions)
  const order = MONEY_PERMISSIONS.some((permission) => permissionSet.has(permission)) ? MONEY_FIRST : PREVENTION_FIRST
  const domains: DashboardDomain[] = []

  for (const key of order) {
    const domain = DASHBOARD_DOMAINS[key]
    if (domainIsVisibleForPermissions(domain, permissionSet)) domains.push(domain)
  }

  return domains
}
