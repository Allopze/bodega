import type { Session } from "next-auth"
import { can, isGlobalRole } from "@/lib/auth/can"
import { PERFORMANCE_FAMILIES, PERFORMANCE_FAMILY_SLUGS } from "@/lib/combustibles/control/contracts"
import { FUEL_CARRY_PARAMS } from "@/lib/combustibles/period/types"
import { FUEL_PATHS, fuelPerformanceHref } from "@/lib/combustibles/routes"
import type { SectionNavItem } from "@/components/ui/section-nav"

/**
 * Pestañas de cada sección de Combustible (rediseño «El mes como hilo»,
 * 2026-10-31). Una sola fuente para que cada página de la sección pinte la
 * misma barra con los mismos permisos que su puerta; la página dice cuál es la
 * activa (`SectionNav.activeKey`). Todas arrastran `FUEL_CARRY_PARAMS`
 * (período y faena).
 */

export { FUEL_CARRY_PARAMS }

export const FIRST_PERFORMANCE_HREF = fuelPerformanceHref(PERFORMANCE_FAMILY_SLUGS[PERFORMANCE_FAMILIES[0]])

export type CargasTab = "cargas" | "tarjetas"
export type RevisarTab = "pendientes" | "decididas"
export type CuadraturaTab = "mandante" | "estanques" | "proveedor" | "tarjeta-y-terreno" | "sellos"
export type ConsumoTab = "rendimiento" | "litros" | "motor-en-vacio"
export type PagosTab = "facturas" | "estados"
export type AjustesSection = "mandantes" | "medios" | "familias" | "umbrales" | "reglas" | "puntos-de-carga" | "integraciones" | "catalogos"

export function cargasNavItems(): SectionNavItem[] {
  return [
    { key: "cargas", href: FUEL_PATHS.cargas, label: "Cargas a equipos" },
    { key: "tarjetas", href: FUEL_PATHS.tarjetas, label: "Tarjetas (total por patente y mes)" },
  ]
}

/** Los contadores son `null` cuando la consulta falló: la pestaña se muestra sin número en vez de afirmar un cero falso. */
export function revisarNavItems(counts: { pendientes: number | null }): SectionNavItem[] {
  return [
    { key: "pendientes", href: FUEL_PATHS.revisar, label: "Pendientes", count: counts.pendientes ?? undefined },
    { key: "decididas", href: `${FUEL_PATHS.revisar}?vista=decididas`, label: "Decididas" },
  ]
}

/** Por mandante, proveedor y tarjeta y terreno exigen `tae_view`; estanques y sellos, sólo `view`. */
export function cuadraturaNavItems(session: Session): SectionNavItem[] {
  const tae = can(session, "combustibles:tae_view")
  const items: SectionNavItem[] = []
  if (tae) items.push({ key: "mandante", href: FUEL_PATHS.cuadraturaMandante, label: "Por mandante" })
  items.push({ key: "estanques", href: FUEL_PATHS.cuadraturaEstanques, label: "Estanques" })
  if (tae) {
    items.push(
      { key: "proveedor", href: FUEL_PATHS.cuadraturaProveedor, label: "Proveedor y terreno" },
      { key: "tarjeta-y-terreno", href: FUEL_PATHS.cuadraturaTarjetaTerreno, label: "Tarjeta y terreno" },
    )
  }
  items.push({ key: "sellos", href: FUEL_PATHS.cuadraturaSellos, label: "Sellos" })
  return items
}

export function firstAllowedCuadraturaHref(session: Session): string {
  return cuadraturaNavItems(session)[0]?.href ?? FUEL_PATHS.cuadraturaEstanques
}

export function consumoNavItems(): SectionNavItem[] {
  return [
    { key: "rendimiento", href: FIRST_PERFORMANCE_HREF, label: "Rendimiento" },
    { key: "litros", href: FUEL_PATHS.consumoLitros, label: "Consumo" },
    { key: "motor-en-vacio", href: FUEL_PATHS.consumoMotorVacio, label: "Motor en vacío (ralentí)" },
  ]
}

/** Los estados de cuenta son globales y monetarios (`assertFuelCostAccess({ global: true })`). */
export function pagosNavItems(session: Session): SectionNavItem[] {
  const items: SectionNavItem[] = [{ key: "facturas", href: FUEL_PATHS.pagos, label: "Facturas" }]
  if (can(session, "combustibles:view_costs") && isGlobalRole(session)) {
    items.push({ key: "estados", href: FUEL_PATHS.estados, label: "Estados de cuenta" })
  }
  return items
}

export interface AjustesNavItem extends SectionNavItem {
  key: AjustesSection
  /** Una línea de lo que hay detrás, para el submenú. */
  hint?: string
  /** Lleva fuera del módulo (catálogos compartidos de Administración). */
  external?: boolean
}

export function ajustesNavItems(session: Session): AjustesNavItem[] {
  const items: AjustesNavItem[] = []
  if (can(session, "combustibles:manage_control")) {
    items.push(
      { key: "mandantes", href: FUEL_PATHS.ajustesMandantes, label: "Mandantes y tolerancias" },
      { key: "medios", href: FUEL_PATHS.ajustesMedios, label: "¿Por dónde llega el combustible?", hint: "Medios de suministro" },
      { key: "familias", href: FUEL_PATHS.ajustesFamilias, label: "Familias de equipos" },
      { key: "umbrales", href: FUEL_PATHS.ajustesUmbrales, label: "¿Cuándo una carga pide revisión?", hint: "Umbrales" },
    )
  }
  if (can(session, "combustibles:manage_anomaly_rules")) items.push({ key: "reglas", href: FUEL_PATHS.ajustesReglas, label: "Reglas de detección" })
  if (can(session, "combustibles:tae_manage_config")) items.push({ key: "puntos-de-carga", href: FUEL_PATHS.ajustesPuntos, label: "Puntos de carga y QR" })
  if (can(session, "combustibles:manage_integrations")) items.push({ key: "integraciones", href: FUEL_PATHS.ajustesIntegraciones, label: "Integraciones" })
  if (can(session, "admin:fleet_catalog") || can(session, "admin:fleet_vehicles") || can(session, "combustibles:manage_suppliers")) {
    items.push({ key: "catalogos", href: "/admin/flota-catalogos", label: "Proveedores y vehículos", hint: "En Catálogos de flota", external: true })
  }
  return items
}

/** Primera sección de Ajustes que el permiso permite (excluye los catálogos externos). */
export function firstAllowedAjustesHref(session: Session): string | null {
  return ajustesNavItems(session).find((item) => !item.external)?.href ?? null
}

export type FuelAddDataKind = "tarjeta" | "planilla" | "telemetria" | "surtidor" | "sellos" | "facturas" | "registrar"

export interface FuelAddDataOption {
  kind: FuelAddDataKind
  label: string
  description: string
  href: string
  allowed: boolean
}

/**
 * «Agregar datos»: un solo botón que pregunta qué tiene la persona en la mano.
 * Cada opción conserva el permiso de su importador. Las que no puede usar se
 * muestran deshabilitadas, para que se sepa que existen. «Registrar una carga a
 * mano» va al final y no basta por sí sola para mostrar el botón: quien sólo
 * registra ya tiene «Registrar carga» a la vista.
 */
export function fuelAddDataOptions(session: Session): FuelAddDataOption[] {
  const canImport = can(session, "combustibles:import")
  return [
    { kind: "planilla", label: "Tengo una planilla de cargas", description: "El consolidado con una fila por carga. Se revisa antes de guardar.", href: `${FUEL_PATHS.fuentes}/agregar/planilla`, allowed: canImport && isGlobalRole(session) },
    { kind: "tarjeta", label: "Tengo un reporte de tarjeta Copec o Aramco", description: "Totales por patente y mes. Normalmente llegan solos cada mañana.", href: `${FUEL_PATHS.fuentes}/agregar/tarjeta`, allowed: canImport },
    { kind: "facturas", label: "Tengo facturas en Excel", description: "La planilla «Control de facturas de combustible».", href: `${FUEL_PATHS.fuentes}?agregar=facturas`, allowed: canImport && can(session, "combustibles:view") && can(session, "combustibles:view_costs") },
    { kind: "telemetria", label: "Tengo telemetría de equipos", description: "Horas de motor y en vacío por día (VisionLink u otra).", href: `${FUEL_PATHS.fuentes}?agregar=telemetria`, allowed: canImport },
    { kind: "surtidor", label: "Tengo despachos de un surtidor", description: "De un surtidor sin integración, como el de CMPC.", href: `${FUEL_PATHS.fuentes}?agregar=surtidor`, allowed: canImport },
    { kind: "sellos", label: "Tengo el histórico de sellos", description: "La planilla antigua del formulario de sellos.", href: `${FUEL_PATHS.fuentes}/agregar/sellos`, allowed: can(session, "combustibles:tae_import") },
    { kind: "registrar", label: "Quiero registrar una carga a mano", description: "Una carga que no viene en ningún archivo: equipo, medidor, litros y sellos.", href: FUEL_PATHS.registrar, allowed: can(session, "combustibles:register_load") },
  ]
}
