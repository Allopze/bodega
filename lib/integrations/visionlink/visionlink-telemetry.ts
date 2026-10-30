/**
 * Traduce un día de Utilization History a una fila de `fuel_telemetry_daily`.
 *
 * Funcionamiento = `runtimeHours` y vacío = `idleHours`, las mismas dos columnas
 * que pide el importador de Excel. Un *callout* del proveedor significa que el
 * valor no es confiable (falta precisión del horómetro, valor inválido en el
 * rango): ese dato queda como faltante, nunca como cero, porque un cero sí
 * entra a los promedios de ralentí.
 */
import type { VisionLinkDailyUtilization } from "./visionlink-client"

export interface VisionLinkTelemetryRow {
  day: string
  operatingHours: number
  idleHours: number
  litersWorking: number | null
  litersIdle: number | null
}

export type VisionLinkDaySkip = "missing_hours" | "over_24_hours" | "idle_over_runtime" | "future_day"

const round = (value: number, decimals: number) => Number(value.toFixed(decimals))

function callout(map: Record<string, string | null> | null | undefined, key: string): boolean {
  const value = map?.[key]
  return typeof value === "string" && value.trim().length > 0
}

function reliable(value: number | null | undefined, flagged: boolean): number | null {
  if (flagged || value === null || value === undefined || !Number.isFinite(value) || value < 0) return null
  return value
}

/**
 * `lastDay` es el último día que se acepta (normalmente ayer): el día en curso
 * todavía está acumulando horas y guardarlo dejaría un parcial.
 */
export function visionLinkDayToTelemetry(
  daily: VisionLinkDailyUtilization,
  lastDay: string,
): { row: VisionLinkTelemetryRow } | { skip: VisionLinkDaySkip } {
  const day = daily.assetLocalDate ?? ""
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > lastDay) return { skip: "future_day" }

  const runtime = reliable(daily.runtimeHours, callout(daily.hourCallouts, "runtimeHours"))
  const idle = reliable(daily.idleHours, callout(daily.hourCallouts, "idleHours"))
  if (runtime === null || idle === null) return { skip: "missing_hours" }

  const operatingHours = round(runtime, 2)
  const idleHours = round(idle, 2)
  if (operatingHours > 24) return { skip: "over_24_hours" }
  // Pasa con los equipos ConnectPro, que miden el ralentí con menos precisión
  // que el horómetro. La base lo rechaza, y elegir cuál de las dos cifras está
  // mal sería inventar.
  if (idleHours > operatingHours) return { skip: "idle_over_runtime" }

  const litersIdle = reliable(daily.idleFuelBurnedLiters, callout(daily.fuelCallouts, "idleFuelBurned"))
  let litersWorking = reliable(daily.workingFuelBurnedLiters, callout(daily.fuelCallouts, "workingFuelBurned"))
  if (litersWorking === null && litersIdle !== null) {
    const total = reliable(daily.runtimeFuelBurnedLiters, callout(daily.fuelCallouts, "runtimeFuelBurned"))
    if (total !== null && total >= litersIdle) litersWorking = total - litersIdle
  }

  return {
    row: {
      day,
      operatingHours,
      idleHours,
      litersWorking: litersWorking === null ? null : round(litersWorking, 4),
      litersIdle: litersIdle === null ? null : round(litersIdle, 4),
    },
  }
}

/** Día anterior a `day` (`YYYY-MM-DD`), en calendario puro. */
export function previousDay(day: string, days = 1): string {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, date - days)).toISOString().slice(0, 10)
}
