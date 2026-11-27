import { NEXT_THRESHOLD } from "@/lib/mantencion/status"
import type { MantUnit } from "@/lib/mantencion/types"
import { formatDate, formatQty } from "@/lib/utils"
import type { PlanningRow, PlanningState } from "./types"

/**
 * Semáforos de Planificación, sin dependencias de base de datos: los importa también la
 * tabla cliente (`planning-tables.tsx`). Si vivieran en `planning.ts`, la tabla arrastraría
 * `loadFleet` y `postgres` al bundle del navegador.
 */

export type PlanningTone = "ok" | "warn" | "danger" | "muted"

/** Rojo vencido, ámbar dentro del 15 % de la base, verde el resto. */
export function remainingTone(row: { remaining: number | null; base: number | null }): PlanningTone {
  if (row.remaining == null) return "muted"
  if (row.remaining <= 0) return "danger"
  if (row.base && row.remaining <= row.base * NEXT_THRESHOLD) return "warn"
  return "ok"
}

const STATE_OF_TONE = { danger: "vencida", warn: "proxima", ok: "al_dia", muted: "sin_dato" } as const satisfies Record<PlanningTone, PlanningState>

/** El estado de la tira de cifras de una fila (`estado=`): sale del mismo semáforo de faltantes. */
export function planningStateOf(row: Pick<PlanningRow, "remaining" | "base">): PlanningState {
  return STATE_OF_TONE[remainingTone(row)]
}

/** El estado de UN equipo, en singular (la tira de cifras habla de «Vencidas», la fila dice «Vencida»). */
export const PLANNING_STATE_NAME: Record<PlanningState, string> = {
  vencida: "Vencida",
  proxima: "Próxima",
  al_dia: "Al día",
  sin_dato: "Sin dato",
}

/** Lo que hace falta de una fila para decir si la última mantención se hizo a tiempo. */
export interface TimingRow {
  /** Punto en que tocaba (A). */
  programmed: number | null
  /** Lectura real de ese día (B). */
  real: number | null
  /** A − B: negativo = se hizo después de lo que tocaba. */
  delta: number | null
  base: number | null
}

/** Hasta este atraso (5 % del intervalo base) el tono es ámbar; más allá, rojo. */
const LATE_WARN_MARGIN = 0.05

/** Hasta el 1 % del intervalo base la mantención cuenta «a tiempo»: un odómetro no se lee al kilómetro. */
export function isOnTime(row: Pick<TimingRow, "delta" | "base">): boolean {
  if (row.delta == null) return false
  return Math.abs(row.delta) <= (row.base ? row.base / 100 : 0)
}

const symbolOf = (unit: MantUnit) => (unit === "km" ? "km" : "h")

/** «14.394 km tarde», «360 km antes» o «A tiempo». `delta` es A − B. */
export function timingText(row: Pick<TimingRow, "delta" | "base">, unit: MantUnit): string {
  if (row.delta == null) return "Sin dato"
  if (isOnTime(row)) return "A tiempo"
  const amount = `${formatQty(Math.abs(row.delta), undefined, { maximumFractionDigits: unit === "h" ? 1 : 0 })} ${symbolOf(unit)}`
  return row.delta < 0 ? `${amount} tarde` : `${amount} antes`
}

/** Verde si se hizo a tiempo o antes; ámbar hasta 5 % del intervalo tarde; rojo más tarde. */
export function timingTone(row: Pick<TimingRow, "delta" | "base">): PlanningTone {
  if (row.delta == null) return "muted"
  if (row.delta >= 0 || isOnTime(row)) return "ok"
  if (row.base && row.delta >= -row.base * LATE_WARN_MARGIN) return "warn"
  return "danger"
}

/** «Tocaba a los 400.000 km y se hizo a los 414.394 km». */
export function timingDetail(row: Pick<TimingRow, "programmed" | "real">, unit: MantUnit): string | null {
  if (row.programmed == null || row.real == null) return null
  const digits = unit === "h" ? 1 : 0
  const at = (value: number) => `${formatQty(value, undefined, { maximumFractionDigits: digits })} ${symbolOf(unit)}`
  return `Tocaba a los ${at(row.programmed)} y se hizo a los ${at(row.real)}`
}

/** «Faltan 3.144 km» o «Vencida por 11.801 km»; `null` sin dato. */
export function remainingText(remaining: number | null, unit: MantUnit): string | null {
  if (remaining == null) return null
  const amount = `${formatQty(Math.abs(remaining), undefined, { maximumFractionDigits: unit === "h" ? 1 : 0 })} ${symbolOf(unit)}`
  return remaining <= 0 ? `Vencida por ${amount}` : `Faltan ${amount}`
}

/** «≈ 16-12-2026», «desde ≈ 09-10-2026» si ya venció; sin estimación, «—» con la razón en `title`. */
export function estimateLine(row: Pick<PlanningRow, "estimatedDate" | "estimateNote" | "remaining">): { text: string; title?: string } {
  if (!row.estimatedDate) return { text: "—", title: row.estimateNote ?? "Sin estimación" }
  const since = row.remaining != null && row.remaining <= 0
  return { text: `${since ? "desde " : ""}≈ ${formatDate(row.estimatedDate)}` }
}

/** «≈ 240 km/día»; `null` si no se pudo calcular el uso. */
export function usageText(row: Pick<PlanningRow, "dailyUsage">, unit: MantUnit): string | null {
  if (row.dailyUsage == null) return null
  return `≈ ${formatQty(row.dailyUsage, undefined, { maximumFractionDigits: 1 })} ${symbolOf(unit)}/día`
}
