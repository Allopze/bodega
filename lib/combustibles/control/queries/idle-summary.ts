import { idlePct } from "../calc/idle"
import type { IdleEquipmentMonthRow } from "./idle"

/**
 * Motor en vacío resumido por equipo en todo el período (la fila de «Equipos
 * con más tiempo en vacío»). Reordena lo que SQL ya agregó por equipo y mes: el
 * % se recalcula siempre desde las horas (Σ vacío ÷ Σ funcionamiento), nunca
 * promediando porcentajes de meses con horas distintas.
 */
export interface IdleEquipmentSummary {
  vehicleId: string
  equipment: string
  operatingHours: number
  idleHours: number
  /** `null` sin horas de funcionamiento. */
  idlePct: number | null
  /** El día de mayor % en vacío del período; `null` si ninguno tuvo horas. */
  dailyMaxPct: number | null
  /** `null` cuando ningún mes informa litros en vacío (no es lo mismo que cero). */
  litersIdle: number | null
}

export function summarizeIdleByEquipment(rows: readonly IdleEquipmentMonthRow[]): IdleEquipmentSummary[] {
  const byVehicle = new Map<string, IdleEquipmentSummary>()
  for (const row of rows) {
    const entry = byVehicle.get(row.vehicleId) ?? {
      vehicleId: row.vehicleId, equipment: row.equipment, operatingHours: 0, idleHours: 0, idlePct: null, dailyMaxPct: null, litersIdle: null,
    }
    entry.operatingHours += row.operatingHours
    entry.idleHours += row.idleHours
    if (row.dailyMaxPct !== null) entry.dailyMaxPct = Math.max(entry.dailyMaxPct ?? 0, row.dailyMaxPct)
    if (row.litersIdle !== null) entry.litersIdle = (entry.litersIdle ?? 0) + row.litersIdle
    byVehicle.set(row.vehicleId, entry)
  }
  return [...byVehicle.values()]
    .map((entry) => ({ ...entry, idlePct: idlePct(entry.idleHours, entry.operatingHours) }))
    .sort((left, right) => right.idleHours - left.idleHours || left.equipment.localeCompare(right.equipment, "es"))
}
