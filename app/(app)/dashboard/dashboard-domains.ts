import type { Permission } from "@/modules/permissions"

/**
 * Los siete dominios ("Por área") en los que se agrupa el tablero.
 *
 * Cada uno es una sección con su fila de KPIs, sus gráficos y su enlace al
 * módulo que los explica. Sustituyen a los tres grupos de
 * `DashboardAnalyticsSection` ("Operación", "Prevención y SST", "Flota"), que
 * cubrían 6 de ~19 dominios y cuyos gráficos no llevaban a ninguna parte (G-03).
 *
 * ── Nombres: qué se llama igual que el sidebar y qué no (INI-09) ─────────────
 * El slug (`?vista=`) es estable —los enlaces guardados siguen resolviendo— y
 * lo único que cambia es el rótulo. Los nombres salen de `components/layout/
 * areas.ts` y de los grupos de `modules/prevention/manifest.ts`:
 *
 *   slug           | rótulo en Inicio           | dónde vive en el sidebar
 *   ---------------|----------------------------|-----------------------------------
 *   finanzas       | Finanzas                   | NO es un área: cruza Facturación
 *                  |                            | (venta y cobranza), Compras (gasto
 *                  |                            | en OC) y Combustibles (costo).
 *                  |                            | Nombre descriptivo propio.
 *   adquisiciones  | Adquisiciones              | Adquisiciones (mismo nombre)
 *   flota          | Control operacional        | Control operacional: Flota,
 *                  |                            | Combustibles y Mantenciones
 *   bodega         | Bodega                     | Bodega (incluye Entregas)
 *   prevencion     | Prevención                 | Prevención (PDTP, incidentes, CAPA,
 *                  |                            | indicadores, requisitos legales)
 *   terreno        | Prevención en terreno      | Prevención: inspecciones, permisos,
 *                  |                            | emergencias, higiene y comités
 *   gobernanza     | Documentación y            | Prevención: Registro documental,
 *                  | capacitación               | Campañas y Capacitación, PPA y
 *                  |                            | Evaluaciones SST
 *
 * "Flota", "Terreno" y "Gobernanza" no existen en ningún menú; eran nombres del
 * código que el usuario no tenía delante en ningún otro sitio.
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
   * Rótulo del selector "Por área" ("Por área: Bodega"). Hoy coincide con
   * `title`: los nombres largos ya no viven en una barra de pestañas con scroll
   * sino en un desplegable, pero se conserva el campo por si vuelven a divergir.
   */
  shortTitle: string
  /** Una línea para el menú "Por área": qué cifras trae. */
  description: string
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
    description: "Facturación de venta, cobranza, gasto en OC y costo de combustible.",
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
    description: "Solicitudes, aprobaciones, órdenes de compra y recepciones.",
    anchor: "dominio-adquisiciones",
    permissions: ["requests:view_own", "requests:view_all", "purchasing:view", "approvals:approve", "receiving:view"],
  },
  bodega: {
    key: "bodega",
    title: "Bodega",
    shortTitle: "Bodega",
    description: "Stock, movimientos, entregas a trabajadores y cobertura de EPP.",
    anchor: "dominio-bodega",
    permissions: ["warehouse:view_stock", "deliveries:view", "deliveries:create", "prevention:epp:view"],
  },
  prevencion: {
    key: "prevencion",
    title: "Prevención",
    shortTitle: "Prevención",
    description: "Programa de trabajo, incidentes, acciones correctivas e indicadores.",
    anchor: "dominio-prevencion",
    permissions: ["prevention:pdtp:view", "prevention:incidents:view", "prevention:capa:view", "prevention:indicadores:view", "prevention:legal:view"],
  },
  flota: {
    key: "flota",
    title: "Control operacional",
    shortTitle: "Control operacional",
    description: "Flota, combustible y mantenciones.",
    anchor: "dominio-flota",
    permissions: ["combustibles:view", "flota:view", "mantenciones:view"],
  },
  terreno: {
    key: "terreno",
    title: "Prevención en terreno",
    shortTitle: "Prevención en terreno",
    description: "Inspecciones, permisos, simulacros, higiene y comité paritario.",
    anchor: "dominio-terreno",
    permissions: ["prevention:inspections:view", "prevention:permits:view", "prevention:emergency:view", "prevention:hygiene:view", "prevention:cphs:view"],
  },
  gobernanza: {
    key: "gobernanza",
    title: "Documentación y capacitación",
    shortTitle: "Documentación y capacitación",
    description: "Documentos vigentes, capacitación, acuses y PPA.",
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

/*
 * Fuera del dominio que abre cada perfil, el resto sigue el orden del sidebar
 * (`areas.ts`: Adquisiciones, Control operacional, Bodega, … Prevención) y las
 * tres vistas de Prevención quedan contiguas. Antes el orden era uno ad hoc
 * (flota, prevención, bodega, terreno…) que no coincidía con ninguna otra
 * superficie.
 */
const MONEY_FIRST: readonly DashboardDomainKey[] = ["finanzas", "adquisiciones", "flota", "bodega", "prevencion", "terreno", "gobernanza"]
const PREVENTION_FIRST: readonly DashboardDomainKey[] = ["prevencion", "terreno", "gobernanza", "adquisiciones", "flota", "bodega", "finanzas"]

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
