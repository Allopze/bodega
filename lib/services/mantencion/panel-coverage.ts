import { plural } from "@/lib/mantencion/format"
import type { MantEquipmentState } from "@/lib/mantencion/types"

/**
 * Cuánto de la flota alcanza a calcular el panel. El estado de mantención de un
 * equipo (vencida, próxima, al día) sólo se conoce con pauta Y lectura; los que
 * no tienen alguna de las dos caen en «Sin pauta» o «Sin lecturas» y NO cuentan
 * como «al día»: no se sabe. Sin esta distinción, «0 vencidas» se lee como
 * «todo en orden» aunque casi toda la flota no se haya podido evaluar.
 *
 * Módulo puro (sólo tipos): lo importan el indicador, la tarjeta de flota y el
 * Excel del panel, así los tres hablan de la misma cobertura.
 */
export interface FleetCoverage {
  /** Equipos con pauta y lectura: los únicos cuyo estado se puede calcular. */
  evaluable: number
  /** Con pauta, pero todavía sin ninguna lectura. */
  withoutReadings: number
  /** Sin pauta asignada (o con una pauta sin intervalos activos). */
  withoutSchedule: number
  /** Los dos anteriores juntos: equipos cuyo estado aún se desconoce. */
  unknown: number
}

export function fleetCoverage(counts: Record<MantEquipmentState, number>): FleetCoverage {
  const withoutReadings = counts.sin_lecturas
  const withoutSchedule = counts.sin_pauta
  return {
    evaluable: counts.vencida + counts.proxima + counts.al_dia,
    withoutReadings,
    withoutSchedule,
    unknown: withoutReadings + withoutSchedule,
  }
}

/**
 * Qué decir bajo la cifra de «Mantenciones vencidas». Con vencidas, cuántas
 * están por vencer; con cero, la verdad sobre cuántos equipos se pudieron
 * evaluar: «Todas las pautas al día» sólo vale si no queda ninguno sin evaluar.
 */
export function overdueDetail(counts: Record<MantEquipmentState, number>): string {
  const { evaluable, unknown } = fleetCoverage(counts)
  const upcoming = counts.proxima
  const upcomingText = plural(upcoming, "próxima a vencer", "próximas a vencer")

  if (counts.vencida > 0) return upcoming > 0 ? upcomingText : "Ninguna otra próxima a vencer"
  if (evaluable === 0) return "Aún ningún equipo tiene pauta y lectura para evaluarse"
  const upcomingSuffix = upcoming > 0 ? ` · ${upcomingText}` : ""
  if (unknown === 0) return upcoming > 0 ? `Ninguna vencida${upcomingSuffix}` : "Todas las pautas al día"
  const scope = evaluable === 1 ? "el único con pauta y lectura" : `los ${evaluable} con pauta y lectura`
  return `Ninguna entre ${scope}${upcomingSuffix}`
}
