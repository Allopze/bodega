/** Tipos del contrato Wialon Remote API que la plataforma normaliza. */

export interface WialonCredentials {
  baseUrl: string
  token: string
}

export interface WialonPosition {
  /** Longitud. */
  x: number
  /** Latitud. */
  y: number
  /** Velocidad km/h. */
  s: number
  /** Rumbo en grados. */
  c: number
  /** Satélites. */
  sc: number | null
  /** Epoch del mensaje. */
  t: number
}

export interface WialonSensor {
  /** Parámetro del mensaje al que está asociado. */
  p: string
  name: string | null
  type: number | null
  unit: string | null
}

export interface WialonUnit {
  id: string
  name: string
  sysName: string | null
  groupId: string | null
  uniqueId: string | null
  hardwareType: string | null
  customProperties: Record<string, unknown>
  sensors: WialonSensor[]
  position: WialonPosition | null
  lastMessageParams: Record<string, unknown>
  lastMessageAt: string | null
}

export interface WialonUnitsResult {
  units: WialonUnit[]
  /** La respuesta superó `MAX_UNITS`: la corrida se reporta parcial. */
  truncated: boolean
}

export interface WialonTelemetryParams {
  odometerParam: string
  hourMeterParam: string
  fuelLevelParam: string
}

export interface WialonTelemetry {
  latitude: number
  longitude: number
  speedKph: number
  headingDegrees: number
  ignition: boolean | null
  gpsReportedAt: string | null
  satellites: number | null
  odometer: number | null
  hourMeter: number | null
  fuelLevel: number | null
  movementState: "moving" | "stopped"
}
