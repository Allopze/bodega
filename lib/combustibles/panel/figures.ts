import { PERFORMANCE_UNIT_LABELS, PERFORMANCE_UNIT_TITLES } from "@/lib/combustibles/control/contracts"
import { deltaPct, globalRatio } from "@/lib/combustibles/control/view-helpers"
import { fuelPeriodLabels, previousFuelPeriods } from "@/lib/combustibles/period/parse"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import type { DeltaPolarity } from "@/components/ui/delta"
import { formatQty, pluralize, todayInChile } from "@/lib/utils"
import { elapsedPeriodDays, formatPercentText, historyLabel, periodLengthDays } from "./format"

/**
 * «El período en tres cifras» del Panel: litros cargados, kilómetros por litro de
 * los camiones y litros por hora de la maquinaria, cada una con su historia de
 * los últimos cinco períodos y su variación contra el anterior.
 *
 * La consulta (`queries.ts`) devuelve sumas por período; acá se arman las cifras.
 * Un promedio es la razón de las sumas del período (Σkm ÷ Σlitros), igual que en
 * Consumo y rendimiento: nunca un promedio de promedios.
 */

export const HISTORY_PERIODS = 5

export interface PanelFigureBucket {
  from: string
  to: string
  /** Litros de las cargas que cuentan (no anuladas, no duplicadas, no rechazadas). */
  liters: number
  loads: number
  /** Equipos distintos con alguna carga que cuenta. */
  equipment: number
  /** Camiones (km/L): tramos con rendimiento calculado y sin decisión pendiente. */
  truckKm: number
  truckLiters: number
  /** Camiones: cargas con rendimiento calculado que esperan decisión y por eso no entran al promedio. */
  truckExcluded: number
  /** Maquinaria (L/h), igual que los camiones. */
  machineHours: number
  machineLiters: number
  machineExcluded: number
}

export interface PanelFiguresRaw {
  /** `HISTORY_PERIODS` sumas, del período más antiguo al actual (el último). */
  buckets: PanelFigureBucket[]
  /** Litros del período anterior en sus mismos primeros días, para comparar uno en curso. */
  partialPrevLiters: number | null
}

export interface PanelHistoryPoint {
  label: string
  fullLabel: string
  value: number | null
  /** El valor ya formateado, para el texto alternativo. */
  display: string | null
}

export interface PanelFigureVariation {
  /** Porcentaje entero; 0 = igual. */
  pct: number
  polarity: DeltaPolarity
  /** Contra qué se compara: «septiembre», «la semana del 19 de octubre». */
  versus: string
  /** Comparación sobre los mismos primeros N días (período en curso); `null` = período completo. */
  partialDays: number | null
}

export interface PanelFigure {
  key: "liters" | "trucks" | "machinery"
  label: string
  /** Número ya formateado («46.900», «2,8»); `null` = sin dato (nunca un cero falso). */
  value: string | null
  unit: string
  unitTitle?: string
  history: PanelHistoryPoint[]
  variation: PanelFigureVariation | null
  hint: string | null
  /** Qué dice la cifra cuando no hay dato. */
  emptyHint: string
}

export interface PanelFigures {
  liters: PanelFigure
  trucks: PanelFigure
  machinery: PanelFigure
  /** Para la frase del Panel de consulta. */
  litersAmount: number
  equipmentCount: number
  /** Ningún período de la historia tuvo cargas: no hay nada que mostrar. */
  empty: boolean
}

const ratioDisplay = (value: number) => formatQty(value, undefined, { maximumFractionDigits: 1 })
const litersDisplay = (value: number) => formatQty(value, undefined, { maximumFractionDigits: 0 })

function sameSpan(days: number): string {
  return days === 1 ? "el mismo día" : `los mismos ${days} días`
}

/** «vs. septiembre» o «vs. los mismos 14 días de septiembre». */
export function variationLabel(variation: PanelFigureVariation): string {
  return variation.partialDays === null ? `vs. ${variation.versus}` : `vs. ${sameSpan(variation.partialDays)} de ${variation.versus}`
}

/** «4 % menos que en septiembre»: la variación dentro de una frase. */
export function variationSentence(variation: PanelFigureVariation): string {
  const versus = variation.partialDays === null ? `en ${variation.versus}` : `en ${sameSpan(variation.partialDays)} de ${variation.versus}`
  if (variation.pct === 0) return `igual que ${versus}`
  return `${formatPercentText(Math.abs(variation.pct), 0)} ${variation.pct > 0 ? "más" : "menos"} que ${versus}`
}

function excludedNote(count: number): string | null {
  if (count <= 0) return null
  return count === 1
    ? "1 carga por decidir no entra al promedio"
    : `${formatQty(count)} ${pluralize(count, "carga")} por decidir no entran al promedio`
}

function variationOf(
  pct: number | null,
  polarity: DeltaPolarity,
  versus: string,
  partialDays: number | null = null,
): PanelFigureVariation | null {
  if (pct === null || !Number.isFinite(pct)) return null
  return { pct: Math.round(pct), polarity, versus, partialDays }
}

export function buildPanelFigures(raw: PanelFiguresRaw, period: ResolvedFuelPeriod, today = todayInChile()): PanelFigures {
  const { buckets } = raw
  const periods = previousFuelPeriods(period.period, buckets.length)
  const current = buckets[buckets.length - 1]
  const previous = buckets[buckets.length - 2]
  const previousPeriod = periods[periods.length - 2]
  const versus = previousPeriod ? fuelPeriodLabels(previousPeriod, today).inLabel : "el período anterior"

  const points = (valueOf: (bucket: PanelFigureBucket) => number | null, display: (value: number) => string): PanelHistoryPoint[] =>
    buckets.map((bucket, index) => {
      const value = valueOf(bucket)
      const source = periods[index]
      return {
        label: source ? historyLabel(source, today) : "",
        fullLabel: source ? fuelPeriodLabels(source, today).label : "",
        value,
        display: value === null ? null : display(value),
      }
    })

  const truckRatio = (bucket: PanelFigureBucket) => globalRatio("km_per_liter", bucket.truckKm, bucket.truckLiters)
  const machineRatio = (bucket: PanelFigureBucket) => globalRatio("liters_per_hour", bucket.machineHours, bucket.machineLiters)

  const inProgress = period.status === "en_curso"
  const elapsed = inProgress ? elapsedPeriodDays(period.from, period.to, today) : 0
  const length = periodLengthDays(period.from, period.to)

  let litersVariation: PanelFigureVariation | null = null
  if (current && previous) {
    if (inProgress) {
      // Comparar un período a medio andar contra el anterior completo mostraría una caída falsa:
      // se compara contra los mismos primeros días del anterior.
      const partialPrev = raw.partialPrevLiters
      litersVariation = partialPrev && partialPrev > 0 && elapsed > 0
        ? variationOf(deltaPct(current.liters, partialPrev), "neutral", versus, elapsed)
        : null
    } else {
      litersVariation = variationOf(deltaPct(current.liters, previous.liters), "neutral", versus)
    }
  }

  const trucksNow = current ? truckRatio(current) : null
  const machineNow = current ? machineRatio(current) : null
  const equipmentCount = current?.equipment ?? 0
  const litersNow = current?.liters ?? 0

  const liters: PanelFigure = {
    key: "liters",
    label: current && current.equipment > 0 ? `Litros cargados a ${formatQty(current.equipment)} ${pluralize(current.equipment, "equipo")}` : "Litros cargados",
    value: current && current.loads > 0 ? litersDisplay(current.liters) : null,
    unit: "L",
    history: points((bucket) => (bucket.loads > 0 ? bucket.liters : null), litersDisplay),
    variation: litersVariation,
    hint: inProgress ? `Lleva ${elapsed} de ${length} días del período.` : null,
    emptyHint: "Todavía no hay cargas en este período.",
  }
  const trucks: PanelFigure = {
    key: "trucks",
    label: "Camiones · kilómetros por litro (más es mejor)",
    value: trucksNow === null ? null : ratioDisplay(trucksNow),
    unit: PERFORMANCE_UNIT_LABELS.km_per_liter,
    unitTitle: PERFORMANCE_UNIT_TITLES.km_per_liter,
    history: points(truckRatio, ratioDisplay),
    variation: current && previous ? variationOf(deltaPct(trucksNow, truckRatio(previous)), "up-good", versus) : null,
    hint: current ? excludedNote(current.truckExcluded) : null,
    emptyHint: "Aparece cuando hay cargas de camiones con lectura de medidor.",
  }
  const machinery: PanelFigure = {
    key: "machinery",
    label: "Maquinaria · litros por hora (menos es mejor)",
    value: machineNow === null ? null : ratioDisplay(machineNow),
    unit: PERFORMANCE_UNIT_LABELS.liters_per_hour,
    unitTitle: PERFORMANCE_UNIT_TITLES.liters_per_hour,
    history: points(machineRatio, ratioDisplay),
    variation: current && previous ? variationOf(deltaPct(machineNow, machineRatio(previous)), "up-bad", versus) : null,
    hint: current ? excludedNote(current.machineExcluded) : null,
    emptyHint: "Aparece cuando hay cargas de maquinaria con lectura de horómetro.",
  }

  return {
    liters,
    trucks,
    machinery,
    litersAmount: litersNow,
    equipmentCount,
    empty: buckets.every((bucket) => bucket.loads === 0),
  }
}
