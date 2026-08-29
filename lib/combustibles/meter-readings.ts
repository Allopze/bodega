/**
 * Lecturas de medidor que llegan en el detalle por transacción de cada proveedor.
 *
 * El mismo lector sirve para la sincronización en vivo y para el backfill: el
 * detalle de Copec se guarda tal cual en `fuel_consumption_records.raw_row`, así
 * que reconstruir el histórico es releer ese JSON, no volver a bajar el informe.
 * Por eso los lectores aceptan la fecha como `Date` (ExcelJS, en vivo) o como
 * string ISO (jsonb, backfill).
 */

import { and, desc, eq, inArray, isNotNull, lte, ne, sql } from "drizzle-orm"
import type { DB } from "@/db"
import { fuelLoads, fuelMeterReadings } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { normKey, normalizePlate, parseChileanNumber, santiagoInstant } from "./xlsx-utils"
import { ACCOUNTABLE_FUEL_LOAD_STATUSES } from "./load-status"

export const METER_READING_SOURCES = ["copec_tct", "aramco", "gps_onway"] as const
export type MeterReadingSource = (typeof METER_READING_SOURCES)[number]

export interface ParsedMeterReading {
  plate: string
  /** Clave natural de la transacción en su fuente. Da la idempotencia. */
  sourceRef: string
  occurredAt: string
  /** `null` cuando la transacción no trae lectura: la fila sigue sirviendo para
   *  acumular litros en el tramo siguiente, pero no se persiste como lectura. */
  value: number | null
  liters: number | null
  stationName: string | null
  cardNumber: string | null
  providerPerformance: number | null
  rawPayload: Record<string, unknown>
}

/** Columnas del informe que identifican personas: no se copian a ninguna tabla. */
const PERSONAL_COLUMNS = new Set(["rut chofer", "rut atendedor"].map(normKey))

/**
 * Fila del informe sin los identificadores de persona.
 *
 * Exportada porque el detalle crudo de Copec se guarda en DOS tablas: acá, en
 * `fuel_meter_readings.raw_payload`, y —completo— en
 * `fuel_consumption_records.raw_row.detalle`. La minimización se aplicaba sólo
 * a la primera, así que los mismos RUT que se decidió no persistir seguían
 * entrando por la otra puerta, y a la tabla más consultada de las dos.
 */
export function withoutPersonalData(record: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (PERSONAL_COLUMNS.has(normKey(key))) continue
    clean[key] = value
  }
  return clean
}

function reader(record: Record<string, unknown>) {
  const byKey = new Map<string, unknown>()
  for (const [key, value] of Object.entries(record)) byKey.set(normKey(key), value)
  return (...names: string[]): unknown => {
    for (const name of names) {
      const value = byKey.get(normKey(name))
      if (value !== undefined && value !== null && value !== "") return value
    }
    return null
  }
}

/** Acepta el `Date` que decodifica ExcelJS y el string ISO que devuelve jsonb. */
function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === "string") {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ""
  const raw = String(value).trim()
  return raw === "-" ? "" : raw
}

/**
 * Una fila del informe de detalle de Copec (canal TCT).
 *
 * Devuelve `null` sólo cuando la fila no se puede situar en la serie: sin
 * patente no hay equipo y sin fecha no hay orden. La guía y el odómetro sí
 * pueden faltar — la fila igual aporta sus litros al tramo siguiente y el
 * rendimiento que declara el proveedor —; lo que no tiene guía simplemente no se
 * persiste, porque la guía ES la clave de idempotencia.
 */
export function copecDetailReading(record: Record<string, unknown>): ParsedMeterReading | null {
  const get = reader(record)
  const plate = normalizePlate(text(get("Patente")))
  const sourceRef = text(get("Guía de Despacho", "Guia de Despacho"))
  const date = asDate(get("Fecha Transacción", "Fecha Transaccion"))
  if (!plate || !date) return null

  const value = parseChileanNumber(get("Odómetro (Kms.)", "Odometro (Kms.)", "Odómetro", "Odometro"))
  const liters = parseChileanNumber(get("Volumen", "Litros"))
  const providerPerformance = parseChileanNumber(get("Rendimiento (Kms. por Litro)", "Rendimiento"))
  return {
    plate,
    sourceRef,
    occurredAt: santiagoInstant(date, asDate(get("Hora Transacción", "Hora Transaccion"))),
    value: value > 0 ? value : null,
    liters: liters > 0 ? liters : null,
    stationName: text(get("Estación de Servicio", "Estacion de Servicio")) || null,
    cardNumber: text(get("Tarjeta")) || null,
    providerPerformance: providerPerformance > 0 ? providerPerformance : null,
    rawPayload: withoutPersonalData(record),
  }
}

/**
 * Instante UTC de una fecha-hora de pared chilena sin zona (`2026-08-18T07:49:32`).
 *
 * `fuel_meter_readings.occurred_at` es la MISMA serie para las tres fuentes, y
 * `copec_tct` y `gps_onway` guardan instantes UTC reales. Aramco guardaba su
 * `transactionDate` tal cual —hora de pared, sin zona—, así que un mismo equipo
 * con cargas en los dos proveedores quedaba con la serie desordenada en ~4 h y,
 * como la columna es `text`, con dos formatos de distinta longitud que se
 * comparan lexicográficamente. Se normaliza al mismo instante UTC que el resto.
 *
 * Un valor que YA trae zona (`Z` u offset) se respeta: sólo se interpreta como
 * hora chilena lo que viene sin ella.
 */
export function chileanWallClockToInstant(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed)) {
    const zoned = new Date(trimmed)
    return Number.isNaN(zoned.getTime()) ? null : zoned.toISOString()
  }
  // `Z` postizo para que los getters UTC devuelvan los componentes de pared tal
  // como vinieron; `santiagoInstant` les aplica el desfase real de la fecha.
  const wall = new Date(`${trimmed}${/T\d{2}:\d{2}/.test(trimmed) ? "" : "T00:00:00"}Z`)
  if (Number.isNaN(wall.getTime())) return null
  return santiagoInstant(wall, wall)
}

/**
 * Un movimiento de la API de Aramco. El portal entrega el odómetro como string y
 * a veces nulo, y `transactionId` es la clave estable de la transacción.
 */
export function aramcoMovementReading(movement: Record<string, unknown>): ParsedMeterReading | null {
  const plate = normalizePlate(text(movement["vehicleRegistrationPlate"]))
  const sourceRef = text(movement["transactionId"])
  const occurredAtRaw = text(movement["transactionDate"])
  if (!plate || !sourceRef || !occurredAtRaw) return null
  // `transactionDate` viene como hora de pared chilena sin zona: se convierte al
  // mismo instante UTC que guardan `copec_tct` y `gps_onway`. La PROYECCIÓN
  // mensual sigue usando la hora de pared cruda a propósito (ver `monthOf` en
  // `aramco-sync`): ahí lo que importa es el mes civil, no el instante.
  const occurredAt = chileanWallClockToInstant(occurredAtRaw)
  if (!occurredAt) return null

  const value = Number(movement["vehicleOdometer"] ?? Number.NaN)
  const liters = Number(movement["quantity"] ?? 0)
  return {
    plate,
    sourceRef,
    occurredAt,
    value: Number.isFinite(value) && value > 0 ? value : null,
    liters: liters > 0 ? liters : null,
    stationName: text(movement["serviceStationName"]) || null,
    cardNumber: text(movement["cardNumber"]) || null,
    providerPerformance: null,
    rawPayload: movement,
  }
}

type ReadingsTx = Pick<DB, "insert">

export interface SaveMeterReadingsResult {
  saved: number
  /** Lecturas descartadas porque su patente no tiene vehículo en el catálogo. */
  unresolved: number
}

/**
 * Persiste lecturas, idempotente por `(source, sourceRef)`.
 *
 * Una lectura sin vehículo resuelto NO se guarda: el tipo de medidor sale del
 * catálogo (`fuel_vehicles.meterType`) y no del archivo — Copec rotula la
 * columna "Odómetro (Kms.)" incluso en las filas de maquinaria que se mide por
 * horómetro— así que sin vehículo no hay forma honesta de clasificarla. Las
 * recoge el backfill (o el refresco del período abierto) cuando el equipo se dé
 * de alta; la patente sin vincular ya genera su propio work item en el ledger.
 *
 * En conflicto ACTUALIZA en vez de ignorar: si el proveedor corrige una fila de
 * un período todavía abierto, la lectura guardada tiene que seguirla.
 */
export async function saveMeterReadings(
  tx: ReadingsTx,
  source: MeterReadingSource,
  readings: ParsedMeterReading[],
  resolveVehicle: (plate: string) => { id: string; meterType?: string } | undefined,
): Promise<SaveMeterReadingsResult> {
  const values: (typeof fuelMeterReadings.$inferInsert)[] = []
  let unresolved = 0

  for (const reading of readings) {
    // Sin lectura no hay nada que guardar; sin clave natural no hay idempotencia
    // y reimportar el mes duplicaría la fila.
    if (reading.value === null || !reading.sourceRef) continue
    const vehicle = resolveVehicle(reading.plate)
    const meterType = vehicle?.meterType
    if (!vehicle || (meterType !== "odometer" && meterType !== "hour_meter")) {
      unresolved++
      continue
    }
    values.push({
      id: nanoid(),
      vehicleId: vehicle.id,
      plate: reading.plate,
      source,
      sourceRef: reading.sourceRef,
      occurredAt: reading.occurredAt,
      meterType,
      value: reading.value,
      liters: reading.liters,
      stationName: reading.stationName,
      cardNumber: reading.cardNumber,
      providerPerformance: reading.providerPerformance,
      rawPayload: reading.rawPayload,
    })
  }

  if (values.length > 0) {
    await tx.insert(fuelMeterReadings).values(values).onConflictDoUpdate({
      target: [fuelMeterReadings.source, fuelMeterReadings.sourceRef],
      set: {
        vehicleId: sqlExcluded("vehicle_id"),
        occurredAt: sqlExcluded("occurred_at"),
        meterType: sqlExcluded("meter_type"),
        value: sqlExcluded("value"),
        liters: sqlExcluded("liters"),
        stationName: sqlExcluded("station_name"),
        cardNumber: sqlExcluded("card_number"),
        providerPerformance: sqlExcluded("provider_performance"),
        rawPayload: sqlExcluded("raw_payload"),
        updatedAt: new Date().toISOString(),
      },
    })
  }

  return { saved: values.length, unresolved }
}

/** Instante UTC del último segundo del día civil chileno `YYYY-MM-DD`. */
function endOfChileanDayUtc(plainDate: string): string {
  return santiagoInstant(new Date(`${plainDate}T00:00:00Z`), new Date("1970-01-01T23:59:59Z"))
}

/** `excluded.<col>` — la fila que el INSERT intentó meter. */
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`)
}

/* ── Validación en la captura ─────────────────────────────────────────────── */

export interface KnownMeterReading {
  value: number
  /** Fecha civil de la lectura, para el mensaje de error. */
  on: string
}

/**
 * Última lectura conocida de un equipo antes de una fecha, mirando las dos
 * fuentes que tienen serie: las cargas propias y el detalle del proveedor.
 *
 * Existe para validar en la captura y no sólo en la detección nocturna: el
 * detector crea un caso que alguien tiene que revisar, mientras que un error de
 * tipeo cazado en el formulario no llega a existir.
 */
export async function lastKnownMeterReading(
  client: Pick<DB, "select">,
  vehicleId: string,
  meterType: "odometer" | "hour_meter",
  options: { before?: string; excludeLoadId?: string } = {},
): Promise<KnownMeterReading | null> {
  const column = meterType === "hour_meter" ? fuelLoads.hourMeterReading : fuelLoads.odometerReading
  const [fromLoads] = await client.select({ value: column, on: fuelLoads.loadDate })
    .from(fuelLoads)
    .where(and(
      eq(fuelLoads.vehicleId, vehicleId),
      isNotNull(column),
      inArray(fuelLoads.status, [...ACCOUNTABLE_FUEL_LOAD_STATUSES]),
      options.before ? lte(fuelLoads.loadDate, options.before) : undefined,
      options.excludeLoadId ? ne(fuelLoads.id, options.excludeLoadId) : undefined,
    ))
    .orderBy(desc(fuelLoads.loadDate), desc(fuelLoads.createdAt))
    .limit(1)

  const [fromProvider] = await client.select({ value: fuelMeterReadings.value, on: fuelMeterReadings.occurredAt })
    .from(fuelMeterReadings)
    .where(and(
      eq(fuelMeterReadings.vehicleId, vehicleId),
      eq(fuelMeterReadings.meterType, meterType),
      // Fin del día CIVIL chileno expresado en UTC, no `T23:59:59.999Z`: la
      // columna guarda instantes UTC, así que una carga chilena de las 21:30 se
      // graba al día siguiente en UTC y el corte ingenuo la dejaba fuera del
      // día que el operador declaró.
      options.before ? lte(fuelMeterReadings.occurredAt, endOfChileanDayUtc(options.before)) : undefined,
    ))
    .orderBy(desc(fuelMeterReadings.occurredAt))
    .limit(1)

  const candidates: KnownMeterReading[] = []
  if (fromLoads?.value != null) candidates.push({ value: Number(fromLoads.value), on: fromLoads.on })
  if (fromProvider?.value != null) candidates.push({ value: Number(fromProvider.value), on: fromProvider.on.slice(0, 10) })
  if (candidates.length === 0) return null
  // La MAYOR y no la más reciente: las dos series pueden llegar desfasadas (el
  // informe del proveedor entra a fin de mes) y el piso honesto es el techo de
  // lo ya observado.
  return candidates.reduce((best, item) => (item.value > best.value ? item : best))
}

/**
 * Mensaje de error si la lectura declarada retrocede respecto a lo ya conocido,
 * o `null` si es aceptable.
 *
 * NO se valida el salto hacia arriba acá: sin conocer el equipo, cualquier techo
 * en el formulario sería inventado, y de ese lado sí hay una regla batch
 * (`salto_medidor_implausible`) que lo mira con la serie completa a la vista.
 */
export function meterRegressionMessage(
  declared: number,
  known: KnownMeterReading | null,
  meterType: "odometer" | "hour_meter",
): string | null {
  if (!known || declared >= known.value) return null
  const unit = meterType === "hour_meter" ? "h" : "km"
  return `La lectura (${declared.toLocaleString("es-CL")} ${unit}) es menor que la última registrada del equipo (${known.value.toLocaleString("es-CL")} ${unit} al ${known.on}). Corrige el número, o marca "medidor reemplazado" si el equipo estrenó medidor.`
}

/**
 * Errores de campo para las lecturas declaradas en una carga, con la forma que
 * ya consumen los formularios (`state.fieldErrors`).
 *
 * Devuelve `null` cuando no hay nada que objetar. El llamador salta esta
 * validación cuando el operador declaró que el medidor fue reemplazado: ahí la
 * lectura baja es un hecho, no un error.
 */
export async function meterReadingFieldErrors(
  client: Pick<DB, "select">,
  input: { vehicleId: string; loadDate: string; odometerReading?: number | null; hourMeterReading?: number | null },
  options: { excludeLoadId?: string } = {},
): Promise<Record<string, string[]> | null> {
  const checks: Array<{ field: "odometerReading" | "hourMeterReading"; meterType: "odometer" | "hour_meter"; value: number | null | undefined }> = [
    { field: "odometerReading", meterType: "odometer", value: input.odometerReading },
    { field: "hourMeterReading", meterType: "hour_meter", value: input.hourMeterReading },
  ]
  const errors: Record<string, string[]> = {}
  for (const check of checks) {
    if (check.value == null) continue
    const known = await lastKnownMeterReading(client, input.vehicleId, check.meterType, {
      before: input.loadDate,
      excludeLoadId: options.excludeLoadId,
    })
    const message = meterRegressionMessage(check.value, known, check.meterType)
    if (message) errors[check.field] = [message]
  }
  return Object.keys(errors).length > 0 ? errors : null
}
