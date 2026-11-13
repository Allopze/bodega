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
  /** Id del sensor dentro de la unidad (clave de `sens`); lo pide `unit/calc_last_message`. */
  id: string | null
  /** Parámetro (o expresión) del mensaje al que está asociado. */
  p: string
  name: string | null
  /**
   * Tipo de sensor como lo entrega Wialon, en texto: `"engine operation"`,
   * `"fuel level"`, `"voltage"`, `"mileage"`… (verificado contra la cuenta real
   * el 2026-11-12; antes se parseaba como número y se perdía).
   */
  type: string | null
  unit: string | null
}

/**
 * Contadores que mantiene el servidor de Wialon (flag 0x2000). A diferencia de
 * un sensor configurado en la cuenta, existen en toda unidad: `cnm` es el
 * kilometraje en km y `cneh` las horas de motor. Un contador en 0 es «sin
 * dato», no una lectura.
 */
export interface WialonCounters {
  mileageKm: number | null
  engineHours: number | null
}

/** Campos de perfil de la unidad (flag 0x800000), buscados por nombre. */
export interface WialonProfile {
  registrationPlate: string | null
  vin: string | null
  brand: string | null
  model: string | null
}

export interface WialonUnit {
  id: string
  name: string
  /** Identificador único del dispositivo (IMEI). */
  uniqueId: string | null
  hardwareType: string | null
  /** Propiedades internas de la interfaz de Wialon (`prp`): claves libres, no es la patente. */
  customProperties: Record<string, unknown>
  counters: WialonCounters
  /** `netconn`: la unidad tiene conexión con el servidor. `null` si no se informó. */
  connected: boolean | null
  profile: WialonProfile
  sensors: WialonSensor[]
  position: WialonPosition | null
  lastMessageParams: Record<string, unknown>
  /**
   * Valores YA calculados por Wialon (`unit/calc_last_message`) por id de
   * sensor: aplican la tabla de calibración y la validación del sensor, cosa
   * que el parámetro crudo no hace. Sólo los pide el cron, para los sensores de
   * combustible; ausente = no se pidió o Wialon no lo pudo calcular.
   */
  calculatedSensors?: Record<string, number>
  /** Hora del último mensaje (`lmsg.t`); puede ser posterior a la de la posición (`pos.t`). */
  lastMessageAt: string | null
}

export interface WialonUnitsResult {
  units: WialonUnit[]
  /** La respuesta superó `MAX_UNITS`: la corrida se reporta parcial. */
  truncated: boolean
}

export interface WialonTelemetryParams {
  /** Vacío = usar el contador de kilometraje de Wialon. */
  odometerParam: string
  /** Vacío = usar el contador de horas de motor de Wialon. */
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
  /** Hora del último mensaje: de él salen los medidores, no de la hora de la posición. */
  metersReportedAt: string | null
  satellites: number | null
  odometer: number | null
  hourMeter: number | null
  fuelLevel: number | null
  movementState: "moving" | "stopped"
}
