import {
  FLAG_REASONS,
  type FlagReason,
  type LoadSource,
  type PerformanceControlSettings,
  type PerformanceStatus,
  type PerformanceUnit,
  type ReviewStatus,
} from "../contracts"
import { detectDuplicates } from "./duplicates"
import { mean, sampleStdDev } from "./statistics"

/**
 * Serie de rendimiento de UN equipo (GAP §6, supuestos S-4, S-6, S-7).
 *
 * Método de tanque lleno extendido: entre dos cargas con lectura válida, el
 * rendimiento es avance del medidor ÷ litros acumulados desde el ancla (incluida
 * la carga actual). Las cargas sin lectura, con lectura repetida o con retroceso
 * suman sus litros al tramo siguiente. La unidad y el medidor salen SIEMPRE del
 * equipo, nunca de la fila.
 *
 * Función pura: recibe las cargas ordenadas por (instante, id) y devuelve los
 * campos calculados de cada una. El llamador persiste solo lo que cambió.
 */

export interface SeriesVehicle {
  meterType: string
  performanceUnit: string
  tankCapacityLiters: number | null
}

export interface SeriesLoad {
  id: string
  source: LoadSource
  occurredAt: string
  liters: number
  meterReading: number | null
  meterReset: boolean
  voidedAt: string | null
  reviewStatus: ReviewStatus
  flagReasons: readonly string[]
}

/** Umbrales ya resueltos para el tipo de equipo (k viene de `thresholdForEquipmentType`). */
export type SeriesSettings = PerformanceControlSettings

export interface SeriesResult {
  id: string
  meterType: "odometer" | "hour_meter" | null
  anchorLoadId: string | null
  meterDelta: number | null
  accumulatedLiters: number | null
  performanceUnit: PerformanceUnit | null
  performanceValue: number | null
  performanceStatus: PerformanceStatus
  reviewStatus: ReviewStatus
  flagReasons: FlagReason[]
  duplicateOfId: string | null
}

/** Marcas que pone la proyección según el origen; el recálculo las conserva. */
export const SOURCE_FLAGS: readonly FlagReason[] = ["filler_value", "unknown_vehicle"]

const round = (value: number, digits: number) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function parseInstantMs(value: string): number {
  const ms = Date.parse(value)
  if (Number.isFinite(ms)) return ms
  // Postgres puede entregar "2026-01-15 12:00:00+00"; se normaliza a ISO.
  return Date.parse(value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"))
}

export function orderFlags(flags: Iterable<string>): FlagReason[] {
  const set = new Set(flags)
  return FLAG_REASONS.filter((flag) => set.has(flag))
}

function stickyDecision(status: ReviewStatus): ReviewStatus | null {
  return status === "approved" || status === "rejected" ? status : null
}

function reviewFor(load: SeriesLoad, flags: FlagReason[]): ReviewStatus {
  return stickyDecision(load.reviewStatus) ?? (flags.length > 0 ? "flagged" : "ok")
}

export function vehicleMeterType(vehicle: SeriesVehicle): "odometer" | "hour_meter" | null {
  return vehicle.meterType === "odometer" || vehicle.meterType === "hour_meter" ? vehicle.meterType : null
}

export function vehicleUnit(vehicle: SeriesVehicle): PerformanceUnit | null {
  if (vehicle.meterType === "none") return null
  return vehicle.performanceUnit === "km_per_liter" || vehicle.performanceUnit === "liters_per_hour" ? vehicle.performanceUnit : null
}

export function computeVehicleSeries(
  vehicle: SeriesVehicle,
  loads: readonly SeriesLoad[],
  settings: SeriesSettings,
): SeriesResult[] {
  const meterType = vehicleMeterType(vehicle)
  const unit = vehicleUnit(vehicle)
  const capacity = vehicle.tankCapacityLiters

  const duplicates = detectDuplicates(
    loads.map((load) => ({
      id: load.id,
      source: load.source,
      occurredAtMs: parseInstantMs(load.occurredAt),
      liters: load.liters,
      voided: load.voidedAt !== null,
      reviewStatus: load.reviewStatus,
    })),
    settings,
  )

  let anchor: { id: string; reading: number } | null = null
  let pendingLiters = 0
  /** Rendimientos válidos (calculados, `ok`/`approved`) ya vistos en esta pasada. */
  const history: number[] = []
  const results: SeriesResult[] = []

  for (const load of loads) {
    const flags = new Set<FlagReason>(load.flagReasons.filter((flag): flag is FlagReason => SOURCE_FLAGS.includes(flag as FlagReason)))
    if (capacity != null && capacity > 0 && load.liters > capacity) flags.add("over_capacity")
    const duplicateOfId = duplicates.get(load.id) ?? null
    if (duplicateOfId) flags.add("duplicate")

    const base: Omit<SeriesResult, "performanceStatus" | "reviewStatus" | "flagReasons"> = {
      id: load.id,
      meterType,
      anchorLoadId: null,
      meterDelta: null,
      accumulatedLiters: null,
      performanceUnit: null,
      performanceValue: null,
      duplicateOfId,
    }

    // Un valor de relleno (fecha 1899-12-30, sello 777777) sin aprobar queda fuera
    // del recorrido: con fecha inventada se ordena primero, y si trae una lectura
    // alta todas las cargas siguientes del equipo saldrían como retroceso falso.
    // Sigue en la cola de revisión con su marca; aprobada, vuelve a la serie.
    const fillerPending = flags.has("filler_value") && load.reviewStatus !== "approved"
    const excluded = load.voidedAt !== null || duplicateOfId !== null || load.reviewStatus === "rejected" || fillerPending
    if (excluded) {
      const ordered = orderFlags(flags)
      // Una anulada no espera revisión: no se queda en la cola aunque arrastre marcas.
      const reviewStatus = load.voidedAt !== null ? (stickyDecision(load.reviewStatus) ?? "ok") : reviewFor(load, ordered)
      results.push({ ...base, performanceStatus: "excluded", reviewStatus, flagReasons: ordered })
      continue
    }

    const step = advance(load, unit, anchor, pendingLiters)
    anchor = step.anchor
    pendingLiters = step.pendingLiters
    const result: SeriesResult = {
      ...base,
      ...step.fields,
      performanceUnit: unit,
      performanceStatus: step.status,
      reviewStatus: "ok",
      flagReasons: [],
    }

    if (step.status === "meter_regression") flags.add("meter_regression")
    if (step.status === "computed" && result.performanceValue !== null) {
      const value = result.performanceValue
      const max = unit === "km_per_liter" ? settings.maxKmPerLiter : settings.maxLitersPerHour
      if (value <= 0 || value > max) flags.add("implausible")
      if (history.length >= settings.minSamples) {
        const avg = mean(history)!
        const sd = sampleStdDev(history)
        if (sd !== null && sd > 0 && Math.abs(value - avg) > settings.thresholdStdDevs * sd) flags.add("outlier")
      }
    }

    result.flagReasons = orderFlags(flags)
    result.reviewStatus = reviewFor(load, result.flagReasons)
    if (result.performanceStatus === "computed" && result.performanceValue !== null
      && (result.reviewStatus === "ok" || result.reviewStatus === "approved")) {
      history.push(result.performanceValue)
    }
    results.push(result)
  }
  return results
}

interface Step {
  status: PerformanceStatus
  anchor: { id: string; reading: number } | null
  pendingLiters: number
  fields: Partial<Pick<SeriesResult, "anchorLoadId" | "meterDelta" | "accumulatedLiters" | "performanceValue">>
}

function advance(
  load: SeriesLoad,
  unit: PerformanceUnit | null,
  anchor: { id: string; reading: number } | null,
  pendingLiters: number,
): Step {
  if (unit === null) return { status: "not_applicable", anchor, pendingLiters, fields: {} }
  const reading = load.meterReading
  if (reading === null || !Number.isFinite(reading)) {
    return { status: "no_meter", anchor, pendingLiters: pendingLiters + load.liters, fields: {} }
  }
  const self = { id: load.id, reading }
  if (load.meterReset) return { status: "meter_reset", anchor: self, pendingLiters: 0, fields: {} }
  if (anchor === null) return { status: "first_load", anchor: self, pendingLiters: 0, fields: {} }
  if (reading < anchor.reading) {
    return { status: "meter_regression", anchor, pendingLiters: pendingLiters + load.liters, fields: {} }
  }
  if (reading === anchor.reading) {
    return { status: "zero_delta", anchor, pendingLiters: pendingLiters + load.liters, fields: {} }
  }
  const delta = round(reading - anchor.reading, 2)
  const accumulated = round(pendingLiters + load.liters, 4)
  const value = unit === "km_per_liter" ? delta / accumulated : accumulated / delta
  return {
    status: "computed",
    anchor: self,
    pendingLiters: 0,
    fields: { anchorLoadId: anchor.id, meterDelta: delta, accumulatedLiters: accumulated, performanceValue: round(value, 4) },
  }
}
