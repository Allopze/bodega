/**
 * Sincronización diaria VisionLink → `fuel_telemetry_daily`.
 *
 * El equipo se cruza por número de serie (`fuel_vehicles.serial_number`): en
 * VisionLink el nombre del equipo es texto libre y la patente no existe. Un
 * equipo suscrito sin serie cargada en el catálogo no se pierde: vuelve como
 * pendiente en `unmatched` para que alguien lo vincule.
 *
 * Escribe con su propia fuente (`visionlink-api`) y sin lote. Así no pisa ni
 * hereda los lotes importados a mano desde Excel (fuente `visionlink`): revertir
 * un lote no borra lo que trajo la API. Si ambas fuentes informan el mismo día,
 * la consulta de ralentí ya toma una sola (`dailyTelemetry`).
 *
 * Idempotente: la llave es equipo + día + fuente, y cada corrida reescribe la
 * ventana completa, porque VisionLink corrige días ya informados cuando el
 * equipo vuelve a tener señal.
 */
import { isNotNull, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelTelemetryDaily, fuelVehicles } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { todayInChile } from "@/lib/utils"
import { fetchVisionLinkUtilization, type VisionLinkCredentials, type VisionLinkUtilization } from "./visionlink-client"
import { previousDay, visionLinkDayToTelemetry, type VisionLinkDaySkip, type VisionLinkTelemetryRow } from "./visionlink-telemetry"

export const VISIONLINK_API_SOURCE = "visionlink-api"

/** Días hacia atrás que reescribe el cron: cubre equipos que estuvieron sin señal y descargan tarde. */
export const DEFAULT_LOOKBACK_DAYS = 14

/** La API acepta 3 meses por consulta; 89 días queda dentro con cualquier combinación de meses. */
const MAX_WINDOW_DAYS = 89

export interface SyncVisionLinkResult {
  from: string
  to: string
  /** Equipos que informó VisionLink en el rango. */
  assets: number
  /** De esos, los que tienen un vehículo con la misma serie. */
  matched: number
  unmatched: Array<{ serialNumber: string; equipmentId: string | null; model: string | null }>
  inserted: number
  updated: number
  /** Días descartados por motivo. No se llama `skipped`: ese es el aviso de `withCronLock`. */
  skippedDays: Partial<Record<VisionLinkDaySkip, number>>
}

export function splitRange(from: string, to: string, maxDays = MAX_WINDOW_DAYS): Array<{ startDate: string; endDate: string }> {
  const windows: Array<{ startDate: string; endDate: string }> = []
  let end = to
  while (end >= from) {
    const start = previousDay(end, maxDays - 1)
    windows.unshift({ startDate: start < from ? from : start, endDate: end })
    end = previousDay(start)
  }
  return windows
}

/**
 * Cruza lo que trajo la API con el catálogo. Separado de la escritura para
 * probarlo sin base.
 */
export function planVisionLinkRows(
  utilizations: VisionLinkUtilization[],
  vehicleIdBySerial: Map<string, string>,
  lastDay: string,
): Pick<SyncVisionLinkResult, "assets" | "matched" | "unmatched" | "skippedDays"> & { rows: Array<VisionLinkTelemetryRow & { vehicleId: string }> } {
  const rows: Array<VisionLinkTelemetryRow & { vehicleId: string }> = []
  const unmatched: SyncVisionLinkResult["unmatched"] = []
  const skippedDays: SyncVisionLinkResult["skippedDays"] = {}
  let matched = 0
  for (const asset of utilizations) {
    const header = asset.equipmentHeader
    const serial = header?.serialNumber?.trim().toUpperCase()
    if (!serial) continue
    const vehicleId = vehicleIdBySerial.get(serial)
    if (!vehicleId) {
      unmatched.push({ serialNumber: serial, equipmentId: header?.equipmentId ?? null, model: header?.model ?? null })
      continue
    }
    matched++
    for (const daily of asset.dailyUtilizations ?? []) {
      const result = visionLinkDayToTelemetry(daily, lastDay)
      if ("skip" in result) skippedDays[result.skip] = (skippedDays[result.skip] ?? 0) + 1
      else rows.push({ ...result.row, vehicleId })
    }
  }
  return { assets: matched + unmatched.length, matched, unmatched, skippedDays, rows }
}

export async function syncVisionLink(
  credentials: VisionLinkCredentials,
  options: { from?: string; to?: string; lookbackDays?: number; fetchImpl?: typeof fetch } = {},
): Promise<SyncVisionLinkResult> {
  const yesterday = previousDay(todayInChile())
  const to = options.to && options.to < yesterday ? options.to : yesterday
  const from = options.from ?? previousDay(to, (options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS) - 1)

  // Con el rango partido, un equipo vuelve una vez por ventana: se juntan sus
  // días bajo una sola entrada para no contarlo dos veces.
  const bySerial = new Map<string, VisionLinkUtilization & { dailyUtilizations: NonNullable<VisionLinkUtilization["dailyUtilizations"]> }>()
  for (const window of splitRange(from, to)) {
    for (const asset of await fetchVisionLinkUtilization(credentials, window, { fetchImpl: options.fetchImpl })) {
      const serial = asset.equipmentHeader?.serialNumber?.trim().toUpperCase()
      if (!serial) continue
      const entry = bySerial.get(serial) ?? { equipmentHeader: asset.equipmentHeader, dailyUtilizations: [] }
      entry.dailyUtilizations.push(...asset.dailyUtilizations ?? [])
      bySerial.set(serial, entry)
    }
  }
  const utilizations = [...bySerial.values()]

  const vehicles = await db.select({ id: fuelVehicles.id, serialNumber: fuelVehicles.serialNumber })
    .from(fuelVehicles)
    .where(isNotNull(fuelVehicles.serialNumber))
  const vehicleIdBySerial = new Map(vehicles.map((vehicle) => [vehicle.serialNumber!.toUpperCase(), vehicle.id]))

  const plan = planVisionLinkRows(utilizations, vehicleIdBySerial, to)
  // Un INSERT … ON CONFLICT no puede tocar la misma fila dos veces: si dos
  // equipos de VisionLink apuntaran al mismo vehículo, gana el último.
  const unique = new Map(plan.rows.filter((row) => row.day >= from).map((row) => [`${row.vehicleId}|${row.day}`, row]))

  let inserted = 0
  let updated = 0
  const values = [...unique.values()]
  for (let index = 0; index < values.length; index += 500) {
    const part = values.slice(index, index + 500)
    const written = await db.insert(fuelTelemetryDaily).values(part.map((row) => ({
      id: nanoid(), batchId: null, vehicleId: row.vehicleId, source: VISIONLINK_API_SOURCE, day: row.day, month: row.day.slice(0, 7),
      operatingHours: row.operatingHours, idleHours: row.idleHours, litersWorking: row.litersWorking, litersIdle: row.litersIdle,
    }))).onConflictDoUpdate({
      target: [fuelTelemetryDaily.vehicleId, fuelTelemetryDaily.day, fuelTelemetryDaily.source],
      set: {
        operatingHours: sql`excluded.operating_hours`, idleHours: sql`excluded.idle_hours`,
        litersWorking: sql`excluded.liters_working`, litersIdle: sql`excluded.liters_idle`, updatedAt: sql`now()`,
      },
    }).returning({ inserted: sql<boolean>`(xmax = 0)` })
    for (const row of written) {
      if (row.inserted) inserted++
      else updated++
    }
  }

  return { from, to, assets: plan.assets, matched: plan.matched, unmatched: plan.unmatched, inserted, updated, skippedDays: plan.skippedDays }
}
