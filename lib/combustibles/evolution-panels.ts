import { countOf, formatDate, formatQty } from "@/lib/utils"
import type { VehicleEvolutionPoint } from "./consumption-dashboard"
import { niceAxisMax } from "@/lib/chart-scale"

/**
 * Evolución de los litros por equipo como *small multiples*: un panel por
 * equipo, todos con el mismo eje de tiempo y la misma escala vertical.
 *
 * Antes eran 8 líneas de 8 colores en un solo gráfico, con la leyenda oculta
 * sobre 6 series: el color decoraba (ninguno significaba algo) y distinguir una
 * línea de otra pedía seguirla con el ojo. Con un panel por equipo el título lo
 * identifica, el color deja de hacer ese trabajo y la comparación se hace por
 * posición, que es lo que el ojo hace mejor. Por eso la escala vertical es común:
 * un panel con eje propio haría parecer igual a un equipo que consume diez veces
 * menos.
 *
 * Esta pieza es pura: la forma de los paneles y las frases. El dibujo está en
 * `evolution-by-vehicle-chart.tsx`.
 */

/** Cuántos paneles caben sin volverse una pared: 4 columnas × 2 filas. */
export const EVOLUTION_MAX_PANELS = 8

export interface EvolutionPanelPoint {
  /** Inicio del período del reporte de tarjeta («YYYY-MM-DD»). */
  periodo: string
  /** `null`: el equipo no tiene registro ese período (no es lo mismo que 0 L). */
  liters: number | null
}

export interface EvolutionPanel {
  /** Patente normalizada: es la clave de la serie. */
  plate: string
  /** «KA-1 · AA-0001», o sólo la patente si el equipo no tiene código. */
  label: string
  /** `null` si la patente no es un equipo de la flota: no hay ficha a la que enlazar. */
  vehicleId: string | null
  total: number
  series: EvolutionPanelPoint[]
}

export interface EvolutionPanels {
  panels: EvolutionPanel[]
  /** Períodos del eje común, en orden. Sólo los que alguno de los equipos mostrados tiene. */
  periods: string[]
  /** Tope común del eje vertical. */
  axisMax: number
  /** Equipos con litros en la ventana, se muestren o no. */
  totalEquipment: number
  /** Equipos que no entraron en los paneles. */
  hiddenCount: number
  shownLiters: number
  allLiters: number
}

export function buildEvolutionPanels(points: readonly VehicleEvolutionPoint[], maxPanels = EVOLUTION_MAX_PANELS): EvolutionPanels {
  const byPlate = new Map<string, { label: string; vehicleId: string | null; total: number; byPeriod: Map<string, number> }>()
  for (const point of points) {
    const entry = byPlate.get(point.plate) ?? {
      label: point.vehicleCode ? `${point.vehicleCode} · ${point.plate}` : point.plate,
      vehicleId: point.vehicleId,
      total: 0,
      byPeriod: new Map<string, number>(),
    }
    entry.total += point.liters
    entry.byPeriod.set(point.periodo, (entry.byPeriod.get(point.periodo) ?? 0) + point.liters)
    byPlate.set(point.plate, entry)
  }

  // Un equipo sin un solo litro no merece un panel: sería una línea plana sobre el piso.
  const ranked = [...byPlate.entries()]
    .filter(([, entry]) => entry.total > 0)
    .sort((a, b) => b[1].total - a[1].total || a[1].label.localeCompare(b[1].label, "es") || a[0].localeCompare(b[0]))
  const shown = ranked.slice(0, Math.max(0, maxPanels))

  const periods = [...new Set(shown.flatMap(([, entry]) => [...entry.byPeriod.keys()]))].sort()
  const panels: EvolutionPanel[] = shown.map(([plate, entry]) => ({
    plate,
    label: entry.label,
    vehicleId: entry.vehicleId,
    total: entry.total,
    series: periods.map((periodo) => ({ periodo, liters: entry.byPeriod.get(periodo) ?? null })),
  }))
  const biggest = panels.reduce((max, panel) => panel.series.reduce((inner, item) => Math.max(inner, item.liters ?? 0), max), 0)

  return {
    panels,
    periods,
    axisMax: niceAxisMax(biggest * 1.05),
    totalEquipment: ranked.length,
    hiddenCount: Math.max(0, ranked.length - shown.length),
    shownLiters: panels.reduce((sum, panel) => sum + panel.total, 0),
    allLiters: ranked.reduce((sum, [, entry]) => sum + entry.total, 0),
  }
}

const liters = (value: number) => `${formatQty(value, undefined, { maximumFractionDigits: 0 })} L`

/**
 * La frase que responde el gráfico, o `null` sin paneles. Con un solo período dice
 * que no hay evolución (una línea necesita dos puntos). Los porcentajes son siempre
 * del total de todos los equipos con litros, se muestren o no, y con equipos que no
 * caben dice cuánto de ese total cubren los paneles.
 */
export function describeEvolution(view: EvolutionPanels): string | null {
  const top = view.panels[0]
  if (!top) return null
  if (view.periods.length < 2) {
    return `Todos los registros son de un solo período (${formatDate(view.periods[0] ?? "")}): hace falta al menos otro para ver cómo evoluciona cada equipo.`
  }
  const pct = (part: number) => `${Math.round(view.allLiters > 0 ? (part / view.allLiters) * 100 : 0)} %`
  const lead = view.hiddenCount > 0
    ? `Los ${view.panels.length} equipos que más consumen, de ${view.totalEquipment}, suman ${liters(view.shownLiters)} (${pct(view.shownLiters)} de los litros de todos)`
    : `${countOf(view.panels.length, "equipo", "equipos")} suman ${liters(view.shownLiters)}`
  return `${lead}. ${top.label} consume más: ${liters(top.total)}, ${pct(top.total)} del total.`
}

/** «Ver datos»: equipo, período y litros; el período sin registro lo dice con palabras. */
export function evolutionTable(view: EvolutionPanels): { headers: string[]; rows: string[][] } {
  return {
    headers: ["Equipo", "Período", "Litros"],
    rows: view.panels.flatMap((panel) => panel.series.map((item) => [
      panel.label,
      formatDate(item.periodo),
      item.liters === null ? "Sin registro" : formatQty(item.liters, undefined, { maximumFractionDigits: 0 }),
    ])),
  }
}
