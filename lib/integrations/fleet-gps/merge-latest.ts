/**
 * Un vehículo puede reportar por OnWay y por Wialon al mismo tiempo. El panel
 * necesita una sola fila por equipo, pero no puede inventar una lectura: la
 * posición sale del dispositivo con la hora de mensaje más reciente y cada
 * medidor, de su propio valor no nulo más reciente. Nunca se suman medidores de
 * fuentes distintas.
 */

export interface LatestGpsRow {
  id: string
  provider: string
  externalDeviceId: string
  vehicleId: string | null
  worksiteId: string | null
  sourcePlate: string
  normalizedPlate: string
  latitude: number
  longitude: number
  speedKph: number
  headingDegrees: number
  ignition: boolean
  sourceStatus: string | null
  gpsReportedAt: string | null
  gprsReportedAt: string | null
  gpsStatus: string | null
  gprsStatus: string | null
  movementState: string | null
  odometer: number | null
  hourMeter: number | null
  internalBatteryLevel: number | null
  externalPowerVolts: number | null
  engineRpm: number | null
  coolantTemperature: number | null
  fuelLevel: number | null
  temperature1: number | null
  humidity1: number | null
  driverMappingId: string | null
  observedAt: string
}

export interface MergedGpsSource {
  provider: string
  externalDeviceId: string
  observedAt: string
  gpsReportedAt: string | null
}

export interface MergedVehicleGps {
  id: string
  vehicleId: string
  worksiteId: string
  provider: string
  primaryProvider: string
  providers: string[]
  sources: MergedGpsSource[]
  latitude: number
  longitude: number
  speedKph: number
  headingDegrees: number
  ignition: boolean
  /** false cuando ninguna fuente informó el encendido en este ciclo. */
  ignitionKnown: boolean
  sourceStatus: string | null
  gpsReportedAt: string | null
  gprsReportedAt: string | null
  gpsStatus: string | null
  gprsStatus: string | null
  movementState: string | null
  odometer: number | null
  odometerAt: string | null
  hourMeter: number | null
  hourMeterAt: string | null
  /** Proveedor del que salieron odómetro y horómetro; nunca se mezclan. */
  meterProvider: string | null
  fuelLevel: number | null
  fuelLevelAt: string | null
  internalBatteryLevel: number | null
  externalPowerVolts: number | null
  engineRpm: number | null
  coolantTemperature: number | null
  temperature1: number | null
  humidity1: number | null
  driverMappingId: string | null
  observedAt: string
  gpsIsStale: boolean
}

/** OnWay manda en un empate: es la fuente con más vehículos y la que ya estaba en producción. */
const PROVIDER_PRIORITY: Record<string, number> = { onway: 0, wialon: 1 }

function providerRank(provider: string): number {
  return PROVIDER_PRIORITY[provider] ?? 99
}

function asTimestamp(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}

function effectiveTime(row: LatestGpsRow): string {
  return row.gpsReportedAt ?? row.observedAt
}

function newerFirst(a: LatestGpsRow, b: LatestGpsRow): number {
  const byTime = asTimestamp(effectiveTime(b)) - asTimestamp(effectiveTime(a))
  if (byTime !== 0) return byTime
  const byProvider = providerRank(a.provider) - providerRank(b.provider)
  if (byProvider !== 0) return byProvider
  return a.externalDeviceId.localeCompare(b.externalDeviceId)
}

function newestValue<K extends keyof LatestGpsRow>(
  rows: readonly LatestGpsRow[],
  key: K,
): { value: LatestGpsRow[K] | null; at: string | null } {
  for (const row of rows) {
    if (row[key] !== null && row[key] !== undefined) return { value: row[key], at: effectiveTime(row) }
  }
  return { value: null, at: null }
}

/**
 * Colapsa las filas de todas las fuentes a una por vehículo. Las filas sin
 * `vehicleId` no entran: son equipos sin vincular y se muestran aparte.
 */
export function mergeLatestGpsByVehicle(
  rows: readonly LatestGpsRow[],
  options: { now?: Date; staleMinutes?: number } = {},
): MergedVehicleGps[] {
  const byVehicle = new Map<string, LatestGpsRow[]>()
  for (const row of rows) {
    if (!row.vehicleId) continue
    byVehicle.set(row.vehicleId, [...(byVehicle.get(row.vehicleId) ?? []), row])
  }

  const now = options.now?.getTime() ?? Date.now()
  const staleMs = (options.staleMinutes ?? 15) * 60_000
  const merged: MergedVehicleGps[] = []

  for (const [vehicleId, group] of byVehicle) {
    const ordered = [...group].sort(newerFirst)
    const position = ordered[0]!
    // Los medidores salen de UN proveedor: el que reportó el medidor más
    // reciente. Tomar el odómetro de uno y el horómetro de otro hace que el
    // salto dependa de quién habló último.
    const meterProvider = ordered.find((row) => row.odometer != null || row.hourMeter != null)?.provider ?? null
    const meterRows = meterProvider ? ordered.filter((row) => row.provider === meterProvider) : []
    const odometer = newestValue(meterRows, "odometer")
    const hourMeter = newestValue(meterRows, "hourMeter")
    const fuelLevel = newestValue(ordered, "fuelLevel")
    const ignitionRow = ordered.find((row) => row.sourceStatus !== "ignition_unknown" && row.ignition != null)
    const providers = [...new Set(ordered.map((row) => row.provider))]
      .sort((a, b) => providerRank(a) - providerRank(b) || a.localeCompare(b))
    const positionAt = asTimestamp(effectiveTime(position))

    merged.push({
      id: position.id,
      vehicleId,
      worksiteId: position.worksiteId ?? "",
      provider: position.provider,
      primaryProvider: position.provider,
      providers,
      sources: ordered.map((row) => ({
        provider: row.provider,
        externalDeviceId: row.externalDeviceId,
        observedAt: row.observedAt,
        gpsReportedAt: row.gpsReportedAt,
      })),
      latitude: position.latitude,
      longitude: position.longitude,
      speedKph: position.speedKph,
      headingDegrees: position.headingDegrees,
      ignition: ignitionRow?.ignition ?? position.ignition,
      ignitionKnown: ignitionRow != null,
      sourceStatus: ignitionRow?.sourceStatus ?? position.sourceStatus,
      gpsReportedAt: position.gpsReportedAt,
      gprsReportedAt: position.gprsReportedAt,
      gpsStatus: position.gpsStatus,
      gprsStatus: position.gprsStatus,
      movementState: position.movementState,
      odometer: odometer.value as number | null,
      odometerAt: odometer.at,
      hourMeter: hourMeter.value as number | null,
      hourMeterAt: hourMeter.at,
      meterProvider,
      fuelLevel: fuelLevel.value as number | null,
      fuelLevelAt: fuelLevel.at,
      internalBatteryLevel: position.internalBatteryLevel,
      externalPowerVolts: position.externalPowerVolts,
      engineRpm: position.engineRpm,
      coolantTemperature: position.coolantTemperature,
      temperature1: position.temperature1,
      humidity1: position.humidity1,
      driverMappingId: ordered.find((row) => row.driverMappingId != null)?.driverMappingId ?? null,
      observedAt: position.observedAt,
      gpsIsStale: Number.isFinite(positionAt) && now - positionAt > staleMs,
    })
  }

  return merged.sort((a, b) => a.vehicleId.localeCompare(b.vehicleId))
}
