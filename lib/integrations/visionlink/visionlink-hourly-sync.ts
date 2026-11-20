/**
 * Sincronización VisionLink (Asset Operations) → `fuel_telemetry_hourly`.
 *
 * Los tramos de operación (idle / working / running) se reparten entre las horas
 * de reloj de Chile que atraviesan (`splitSegmentByChileHour`) y se guardan por
 * equipo, día y hora: de ahí salen el % de ralentí por turno y por operador.
 *
 * Idempotente por equipo y rango: en una transacción se borran las filas del
 * equipo en `[from, to]` y se reinsertan las que trae la API. Así una hora que
 * VisionLink corrigió —o que ya no trae tramos— queda como la API la ve hoy, y
 * correr dos veces deja lo mismo. Además deja constancia de la consulta
 * (`segments_fetched_at`) para cada día del rango aunque no haya tramos: sin ella
 * no se puede distinguir «motor apagado» de «el dato aún no llega».
 *
 * Un equipo que falla no detiene a los demás ni deja constancia (su rango queda
 * como estaba): se anota en `failedVehicles` con el código del cliente, nunca con
 * el cuerpo de la respuesta ni las credenciales.
 */
import { and, between, eq, isNotNull } from "drizzle-orm"
import { db } from "@/db"
import { fuelTelemetryFetches, fuelTelemetryHourly, fuelVehicles } from "@/db/schema"
import { HOURLY_LOOKBACK_DAYS, HOURLY_SOURCE, SEGMENT_WINDOW_DAYS, VISIONLINK_MAKE } from "@/lib/fleet/shifts/constants"
import { daysBetween, hourKeyId, splitSegmentByChileHour } from "@/lib/fleet/shifts/hours"
import type { HourSeconds, SegmentType } from "@/lib/fleet/shifts/types"
import { logger } from "@/lib/logger"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { fetchVisionLinkSegments, VisionLinkClientError, type VisionLinkCredentials, type VisionLinkSegment } from "./visionlink-client"
import { splitRange } from "./visionlink-sync"

const SEGMENT_TYPES: readonly SegmentType[] = ["idle", "working", "running"]
const BATCH = 500

export interface SyncVisionLinkHourlyResult {
  from: string
  to: string
  /** Equipos con serie vinculada que se consultaron (los que fallaron también cuentan). */
  vehicles: number
  /** Tramos distintos recibidos y sumados (sin repetidos ni de tipo desconocido). */
  segments: number
  /** Filas por hora escritas. */
  hoursWritten: number
  failedVehicles: Array<{ vehicleCode: string; errorCode: string }>
}

function isSegmentType(value: string): value is SegmentType {
  return (SEGMENT_TYPES as readonly string[]).includes(value)
}

export async function syncVisionLinkHourly(
  credentials: VisionLinkCredentials,
  options: { from?: string; to?: string; lookbackDays?: number; fetchImpl?: typeof fetch; now?: () => Date } = {},
): Promise<SyncVisionLinkHourlyResult> {
  const now = options.now ?? (() => new Date())
  // Incluye hoy: las horas de hoy ya cerradas sirven para los turnos del día.
  const to = options.to ?? todayInChile(now())
  const from = options.from ?? addDaysToPlainDate(to, -((options.lookbackDays ?? HOURLY_LOOKBACK_DAYS) - 1))
  const days = daysBetween(from, to)

  const vehicles = await db.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, serialNumber: fuelVehicles.serialNumber })
    .from(fuelVehicles)
    .where(isNotNull(fuelVehicles.serialNumber))

  const result: SyncVisionLinkHourlyResult = { from, to, vehicles: vehicles.length, segments: 0, hoursWritten: 0, failedVehicles: [] }
  // Se consulta un día de más a cada lado (sin pasar de hoy): no se sabe con certeza si la API lee
  // `startDate`/`endDate` en hora del equipo o en UTC, y un tramo que cruza la medianoche debe llegar
  // entero. Las horas fuera de `[from, to]` se descartan abajo, así que el margen no escribe nada de más.
  const queryFrom = addDaysToPlainDate(from, -1)
  const todayChile = todayInChile(now())
  const queryTo = addDaysToPlainDate(to, 1) <= todayChile ? addDaysToPlainDate(to, 1) : to

  for (const vehicle of vehicles) {
    try {
      const segments = new Map<string, VisionLinkSegment>()
      for (const window of splitRange(queryFrom, queryTo, SEGMENT_WINDOW_DAYS)) {
        const fetched = await fetchVisionLinkSegments(credentials, {
          serialNumber: vehicle.serialNumber!, startDate: window.startDate, endDate: window.endDate, make: VISIONLINK_MAKE,
        }, { fetchImpl: options.fetchImpl })
        // Un tramo que cruza el límite entre dos ventanas puede venir en ambas.
        for (const segment of fetched) segments.set(`${segment.startStateUtc}|${segment.segmentType}`, segment)
      }

      const hours = new Map<string, { day: string; hour: number } & HourSeconds>()
      const unknownTypes = new Set<string>()
      let counted = 0
      for (const segment of segments.values()) {
        if (!isSegmentType(segment.segmentType)) {
          unknownTypes.add(segment.segmentType)
          continue
        }
        counted++
        for (const piece of splitSegmentByChileHour({ startUtc: segment.startStateUtc, endUtc: segment.endStateUtc, type: segment.segmentType })) {
          // La ventana de la API puede traer horas de los días vecinos: no se tocan.
          if (piece.day < from || piece.day > to) continue
          const id = hourKeyId(piece)
          const entry = hours.get(id) ?? { day: piece.day, hour: piece.hour, idle: 0, working: 0, running: 0 }
          entry[piece.type] += piece.seconds
          hours.set(id, entry)
        }
      }
      for (const segmentType of unknownTypes) {
        logger.warn("[visionlink-hourly] Se ignora un tipo de tramo desconocido: no se suma", { vehicleCode: vehicle.code, segmentType })
      }

      const rows = [...hours.values()].map((hour) => ({
        vehicleId: vehicle.id,
        day: hour.day,
        hour: hour.hour,
        source: HOURLY_SOURCE,
        idleSeconds: Math.round(hour.idle),
        workingSeconds: Math.round(hour.working),
        runningSeconds: Math.round(hour.running),
      }))
      const fetchedAt = now().toISOString()

      await db.transaction(async (tx) => {
        await tx.delete(fuelTelemetryHourly).where(and(
          eq(fuelTelemetryHourly.vehicleId, vehicle.id),
          eq(fuelTelemetryHourly.source, HOURLY_SOURCE),
          between(fuelTelemetryHourly.day, from, to),
        ))
        for (let index = 0; index < rows.length; index += BATCH) {
          await tx.insert(fuelTelemetryHourly).values(rows.slice(index, index + BATCH).map((row) => ({ ...row, updatedAt: fetchedAt })))
        }
        await tx.insert(fuelTelemetryFetches)
          .values(days.map((day) => ({ vehicleId: vehicle.id, day, segmentsFetchedAt: fetchedAt })))
          .onConflictDoUpdate({
            target: [fuelTelemetryFetches.vehicleId, fuelTelemetryFetches.day],
            set: { segmentsFetchedAt: fetchedAt },
          })
      })

      result.segments += counted
      result.hoursWritten += rows.length
    } catch (error) {
      const errorCode = error instanceof VisionLinkClientError ? error.code : "VISIONLINK_HOURLY_SYNC_FAILED"
      logger.error("[visionlink-hourly] Falló un equipo", { vehicleCode: vehicle.code, errorCode })
      result.failedVehicles.push({ vehicleCode: vehicle.code ?? vehicle.plate, errorCode })
    }
  }

  return result
}
