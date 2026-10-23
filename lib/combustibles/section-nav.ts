import type { Session } from "next-auth"
import { can, isGlobalRole } from "@/lib/auth/can"
import { PERFORMANCE_FAMILIES, PERFORMANCE_FAMILY_SLUGS } from "@/lib/combustibles/control/contracts"
import type { SectionNavItem } from "@/components/ui/section-nav"

/**
 * Pestañas de cada sección de Combustible en el menú. Una sola fuente para que
 * cada página de la sección pinte la misma barra con los mismos permisos que
 * su gate; la página dice cuál es la activa (`SectionNav.activeKey`).
 *
 * El menú agrupa por lo que la persona viene a hacer —ver consumo, revisar,
 * operar TAE, facturar— y no por la fuente del dato (TCT, TAE, control de
 * cargas), que es como estaban repartidas las pantallas antes.
 */

export type ConsumoTab = "resumen" | "tct" | "equipos" | "rendimiento" | "ralenti" | "ciclo"
export type RevisionTab = "cargas" | "anomalias"
export type TaeTab = "cargas" | "conciliacion" | "sellos-mandante" | "historial-sellos"
export type FacturasTab = "facturas" | "cuenta-corriente"

/**
 * Contexto que viaja entre las pestañas de «Consumo y rendimiento». `faena` lo
 * entienden las dos familias de vistas; `anio`, `meses` y `mandante` son del
 * control de cargas (las vistas TCT filtran por `desde`/`hasta` y los ignoran).
 */
export const CONSUMO_CARRY_PARAMS = ["faena", "anio", "meses", "mandante"] as const

/** El período y la faena del control de cargas: lo que conservaba la barra del control. */
export const CONTROL_CARRY_PARAMS = ["anio", "meses", "faena", "mandante"] as const

export const FIRST_PERFORMANCE_HREF = `/combustibles/control/rendimiento/${PERFORMANCE_FAMILY_SLUGS[PERFORMANCE_FAMILIES[0]]}`

/** Todas exigen `combustibles:view`, que ya es el gate de la sección. */
export function consumoNavItems(): SectionNavItem[] {
  return [
    { key: "resumen", href: "/combustibles", label: "Resumen" },
    { key: "tct", href: "/combustibles?vista=analisis", label: "Consumo por tarjeta (TCT)" },
    { key: "equipos", href: "/combustibles/control", label: "Cargas por equipo" },
    { key: "rendimiento", href: FIRST_PERFORMANCE_HREF, label: "Rendimiento" },
    { key: "ralenti", href: "/combustibles/control/ralenti", label: "Ralentí" },
    { key: "ciclo", href: "/combustibles/ciclo", label: "Ciclo físico" },
  ]
}

/**
 * Las dos colas de revisión. Los contadores son `null` cuando la consulta falló:
 * la pestaña se muestra sin número en vez de afirmar un cero falso.
 */
export function revisionNavItems(counts: { flagged: number | null; anomalies: number | null }): SectionNavItem[] {
  return [
    { key: "cargas", href: "/combustibles/control/revision", label: "Cargas marcadas", count: counts.flagged ?? undefined },
    // `estado=vigentes`: la lista abre con lo mismo que cuenta la pestaña (ver revision-counts.ts).
    { key: "anomalias", href: "/combustibles/anomalias?estado=vigentes", label: "Anomalías", count: counts.anomalies ?? undefined },
  ]
}

/** «TAE y sellos» exige `combustibles:tae_view`; el historial de sellos solo `view`. */
export function taeNavItems(session: Session): SectionNavItem[] {
  const items: SectionNavItem[] = []
  if (can(session, "combustibles:tae_view")) {
    items.push(
      { key: "cargas", href: "/combustibles/tae", label: "Cargas TAE" },
      { key: "conciliacion", href: "/combustibles/tae/conciliacion", label: "Conciliación" },
      { key: "sellos-mandante", href: "/combustibles/control/sellos", label: "Sellos por mandante" },
    )
  }
  if (can(session, "combustibles:view")) {
    items.push({ key: "historial-sellos", href: "/combustibles/sellos", label: "Historial de sellos" })
  }
  return items
}

/** La cuenta corriente es global y monetaria (`assertFuelCostAccess({ global: true })`). */
export function facturasNavItems(session: Session): SectionNavItem[] {
  const items: SectionNavItem[] = [{ key: "facturas", href: "/combustibles/facturas", label: "Facturas" }]
  if (can(session, "combustibles:view_costs") && isGlobalRole(session)) {
    items.push({ key: "cuenta-corriente", href: "/combustibles/cuenta-corriente", label: "Cuenta corriente" })
  }
  return items
}

/** Qué importadores ve la sesión; alimenta el único botón «Importar» (`fuel-import-button.tsx`). */
export interface FuelImportAvailability {
  /** Consumos mensuales Copec/Aramco o reporte Excel (`/combustibles/importar`). */
  tct: boolean
  /** Log operacional, pestaña del mismo importador; hoy solo roles globales. */
  operaciones: boolean
  /** Telemetría y entradas de surtidor o tarjeta (`/combustibles/control/importar`). */
  control: boolean
  /** Histórico TAE (`/combustibles/tae/importar`). */
  tae: boolean
  /**
   * Cargas facturadas desde Excel (diálogo `ImportFuelLoadsModal`, que postea a
   * `/api/combustibles/import`). Crea cargas con montos, así que además de
   * `import` exige el contrato monetario (`view` + `view_costs`), el mismo que
   * aplica la ruta.
   */
  facturas: boolean
}

export function fuelImportAvailability(session: Session): FuelImportAvailability {
  const canImport = can(session, "combustibles:import")
  return {
    tct: canImport,
    operaciones: canImport && isGlobalRole(session),
    control: canImport,
    tae: can(session, "combustibles:tae_import"),
    facturas: canImport && can(session, "combustibles:view") && can(session, "combustibles:view_costs"),
  }
}
