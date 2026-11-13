/**
 * Cliente de Wialon Remote API (Wialon Hosting / Wialon Local).
 *
 * Sólo lectura: inicia sesión con un token, lista las unidades con su último
 * mensaje y normaliza posición y medidores. No persiste el payload del
 * proveedor ni el token; la sesión (`sid`) vive únicamente en memoria del
 * proceso y se descarta si el proveedor la invalida.
 */

import { isIP } from "node:net"
import type {
  WialonCredentials,
  WialonPosition,
  WialonProfile,
  WialonSensor,
  WialonTelemetry,
  WialonTelemetryParams,
  WialonUnit,
  WialonUnitsResult,
} from "./wialon-contract"

export const DEFAULT_WIALON_BASE_URL = "https://hst-api.wialon.com"
export const MAX_UNITS = 5_000
const REQUEST_TIMEOUT_MS = 20_000
/** Wialon mata la sesión a los 5 minutos sin requests. */
const SESSION_TTL_MS = 4 * 60_000
const SESSION_MARGIN_MS = 60_000

export type WialonClientErrorCode =
  | "WIALON_AUTH_FAILED"
  | "WIALON_SESSION_EXPIRED"
  | "WIALON_ACCESS_DENIED"
  | "WIALON_RATE_LIMITED"
  | "WIALON_HTTP_ERROR"
  | "WIALON_BAD_RESPONSE"
  | "WIALON_TIMEOUT"
  | "WIALON_API_ERROR"
  | "WIALON_INVALID_BASE_URL"

export class WialonClientError extends Error {
  constructor(
    readonly code: WialonClientErrorCode,
    readonly status?: number,
    readonly providerCode?: number,
  ) {
    super(status ? `${code} (HTTP ${status})` : code)
    this.name = "WialonClientError"
  }
}

type FetchLike = typeof fetch

let cachedSession: { key: string; sid: string; expiresAt: number } | null = null

/** Sólo para pruebas. */
export function resetWialonSessionCache(): void {
  cachedSession = null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function asOptionalBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (["1", "true", "on", "yes", "si", "sí"].includes(normalized)) return true
    if (["0", "false", "off", "no"].includes(normalized)) return false
  }
  return null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function positiveNumber(value: unknown): number | null {
  const parsed = asNumber(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

function epochToIso(value: number | null): string | null {
  if (value === null || value <= 0) return null
  const milliseconds = value > 1e12 ? value : value * 1000
  const date = new Date(milliseconds)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

/**
 * Hosts adicionales permitidos, definidos por el servidor (Wialon Local o una
 * región distinta de `*.wialon.com`). Lista separada por comas; se aceptan el
 * host exacto y sus subdominios.
 */
function allowedHosts(): string[] {
  return (process.env.WIALON_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
}

function isAllowedWialonHost(hostname: string, port: string): boolean {
  const host = hostname.toLowerCase()
  // Una IP literal nunca es Wialon Hosting y es el camino clásico de SSRF.
  if (isIP(host) !== 0) return false
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false
  // Wialon Hosting: sólo el dominio del proveedor y sus subdominios, por 443.
  if (host === "wialon.com" || host.endsWith(".wialon.com")) {
    return port === "" || port === "443"
  }
  // Wialon Local / región explícita: sólo si el servidor la declaró.
  return allowedHosts().some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

export function normalizeWialonBaseUrl(value?: string | null): string {
  const raw = value?.trim() || DEFAULT_WIALON_BASE_URL
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new WialonClientError("WIALON_INVALID_BASE_URL")
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !isAllowedWialonHost(url.hostname, url.port)
  ) {
    throw new WialonClientError("WIALON_INVALID_BASE_URL")
  }
  return url.origin
}

function ajaxUrl(credentials: WialonCredentials): string {
  return `${normalizeWialonBaseUrl(credentials.baseUrl)}/wialon/ajax.html`
}

function mapProviderError(body: unknown): WialonClientError | null {
  const record = asRecord(body)
  const error = asNumber(record?.error)
  if (error === null || error === 0) return null
  if (error === 1) return new WialonClientError("WIALON_SESSION_EXPIRED", undefined, error)
  if (error === 7 || error === 101) return new WialonClientError("WIALON_ACCESS_DENIED", undefined, error)
  if (error === 8) return new WialonClientError("WIALON_AUTH_FAILED", undefined, error)
  return new WialonClientError("WIALON_API_ERROR", undefined, error)
}

async function request<T>(
  credentials: WialonCredentials,
  svc: string,
  params: Record<string, unknown>,
  sid: string | null,
  fetchImpl: FetchLike,
): Promise<T> {
  const form = new URLSearchParams()
  form.set("svc", svc)
  if (sid) form.set("sid", sid)
  form.set("params", JSON.stringify(params))

  let response: Response
  try {
    response = await fetchImpl(ajaxUrl(credentials), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form,
      // Un 3xx podría llevar el token a otro host. Wialon no redirige sus
      // endpoints: si lo hace, es un error, no una instrucción a seguir.
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new WialonClientError("WIALON_TIMEOUT")
    }
    throw error
  }

  if (response.status === 401) throw new WialonClientError("WIALON_AUTH_FAILED", 401)
  if (response.status === 403) throw new WialonClientError("WIALON_ACCESS_DENIED", 403)
  if (response.status === 429) throw new WialonClientError("WIALON_RATE_LIMITED", 429)
  if (!response.ok) throw new WialonClientError("WIALON_HTTP_ERROR", response.status)

  const body = await response.json().catch(() => null)
  const providerError = mapProviderError(body)
  if (providerError) throw providerError
  if (body === null) throw new WialonClientError("WIALON_BAD_RESPONSE")
  return body as T
}

/** Login fresco, sin caché: lo usa «Probar conexión» y el primer request del proceso. */
export async function loginWialon(
  credentials: WialonCredentials,
  options: { fetchImpl?: FetchLike } = {},
): Promise<string> {
  if (!credentials.token.trim()) throw new WialonClientError("WIALON_AUTH_FAILED")
  const body = await request<Record<string, unknown>>(
    credentials,
    "token/login",
    // `fl` es obligatorio en token/login; 1 = sesión básica (sólo se leen unidades).
    { token: credentials.token, fl: 1 },
    null,
    options.fetchImpl ?? fetch,
  )
  const sid = asString(body.sid) ?? asString(body.eid)
  if (!sid) throw new WialonClientError("WIALON_BAD_RESPONSE")
  return sid
}

export async function logoutWialon(
  credentials: WialonCredentials,
  sid: string,
  options: { fetchImpl?: FetchLike } = {},
): Promise<void> {
  await request(credentials, "core/logout", {}, sid, options.fetchImpl ?? fetch).catch(() => undefined)
}

/** Cierra la sesión cacheada de ESTAS credenciales y vacía la caché. */
export async function logoutWialonSession(
  credentials: WialonCredentials,
  options: { fetchImpl?: FetchLike } = {},
): Promise<void> {
  const key = sessionKey(credentials)
  if (!cachedSession || cachedSession.key !== key) return
  const sid = cachedSession.sid
  cachedSession = null
  await logoutWialon(credentials, sid, options)
}

function sessionKey(credentials: WialonCredentials): string {
  return `${normalizeWialonBaseUrl(credentials.baseUrl)}\u0000${credentials.token}`
}

async function sessionFor(
  credentials: WialonCredentials,
  fetchImpl: FetchLike,
  now: () => number,
): Promise<string> {
  const key = sessionKey(credentials)
  if (cachedSession && cachedSession.key === key && cachedSession.expiresAt - SESSION_MARGIN_MS > now()) {
    return cachedSession.sid
  }
  const sid = await loginWialon(credentials, { fetchImpl })
  cachedSession = { key, sid, expiresAt: now() + SESSION_TTL_MS }
  return sid
}

export async function wialonCall<T = unknown>(
  credentials: WialonCredentials,
  svc: string,
  params: Record<string, unknown>,
  options: { fetchImpl?: FetchLike; now?: () => number } = {},
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now
  const sid = await sessionFor(credentials, fetchImpl, now)

  try {
    return await request<T>(credentials, svc, params, sid, fetchImpl)
  } catch (error) {
    if (error instanceof WialonClientError && error.code === "WIALON_SESSION_EXPIRED") {
      cachedSession = null
      const fresh = await sessionFor(credentials, fetchImpl, now)
      return await request<T>(credentials, svc, params, fresh, fetchImpl)
    }
    throw error
  }
}

function parsePosition(value: unknown): WialonPosition | null {
  const record = asRecord(value)
  if (!record) return null
  const x = asNumber(record.x)
  const y = asNumber(record.y)
  if (x === null || y === null) return null
  return {
    x,
    y,
    s: asNumber(record.s) ?? 0,
    c: asNumber(record.c) ?? 0,
    sc: asNumber(record.sc),
    t: asNumber(record.t) ?? 0,
  }
}

function parseSensor(value: unknown, key?: string): WialonSensor[] {
  const record = asRecord(value)
  const parameter = asString(record?.p)
  if (!parameter) return []
  const type = typeof record?.t === "string" ? record.t.trim().toLowerCase() : null
  return [{
    id: asString(record?.id) ?? key ?? null,
    p: parameter,
    name: asString(record?.n),
    type: type || null,
    unit: asString(record?.m),
  }]
}

/** Tipos de sensor de Wialon que la plataforma reconoce sin configuración. */
export const WIALON_SENSOR_TYPE = {
  ignition: "engine operation",
  fuelLevel: "fuel level",
} as const

/** Valor que Wialon devuelve cuando no puede calcular un sensor («N/A»). */
const WIALON_SENSOR_NA = -348_201.3876

/** Nombres de los campos de perfil (`pflds`) que la plataforma lee. Se buscan por `n`: el id numérico lo asigna cada cuenta. */
const PROFILE_FIELD_NAMES = {
  registrationPlate: "registration_plate",
  vin: "vin",
  brand: "brand",
  model: "model",
} as const

function parseProfile(value: unknown): WialonProfile {
  const byName = new Map<string, string>()
  // `pflds` llega como objeto por id; se acepta también un arreglo.
  for (const entry of Object.values(asRecord(value) ?? (Array.isArray(value) ? value : {}))) {
    const field = asRecord(entry)
    const name = asString(field?.n)?.trim().toLowerCase()
    const fieldValue = asString(field?.v)?.trim()
    if (name && fieldValue) byName.set(name, fieldValue)
  }
  return {
    registrationPlate: byName.get(PROFILE_FIELD_NAMES.registrationPlate) ?? null,
    vin: byName.get(PROFILE_FIELD_NAMES.vin) ?? null,
    brand: byName.get(PROFILE_FIELD_NAMES.brand) ?? null,
    model: byName.get(PROFILE_FIELD_NAMES.model) ?? null,
  }
}

function parseUnit(value: unknown): WialonUnit | null {
  const item = asRecord(value)
  if (!item) return null
  const id = asString(item.id) ?? asString(item.uid)
  if (!id) return null

  const lastMessage = asRecord(item.lmsg)
  const position = parsePosition(item.pos) ?? parsePosition(lastMessage?.pos)
  const sensorSource = item.sens
  const sensors = Array.isArray(sensorSource)
    ? sensorSource.flatMap((sensor) => parseSensor(sensor))
    : Object.entries(asRecord(sensorSource) ?? {}).flatMap(([key, sensor]) => parseSensor(sensor, key))
  return {
    id,
    name: asString(item.nm) ?? id,
    uniqueId: asString(item.uid),
    hardwareType: asString(item.hw),
    customProperties: asRecord(item.prp) ?? {},
    counters: {
      mileageKm: positiveNumber(item.cnm),
      engineHours: positiveNumber(item.cneh),
    },
    connected: asOptionalBoolean(item.netconn),
    profile: parseProfile(item.pflds),
    sensors,
    position,
    lastMessageParams: asRecord(lastMessage?.p) ?? {},
    // `lmsg.t` manda; `pos.t` sólo cuando el mensaje no trae hora propia.
    lastMessageAt: epochToIso(asNumber(lastMessage?.t) ?? position?.t ?? null),
  }
}

/**
 * Flags de `avl_unit` (help.wialon.com/en/api): 0x1 base (nm, id), 0x2 prp
 * (propiedades internas de la interfaz, NO la patente), 0x100 avanzadas (uid,
 * hw), 0x400 posición y último mensaje, 0x1000 sensores, 0x2000 contadores
 * (cnm km, cneh horas), 0x200000 netconn, 0x800000 campos de perfil (pflds).
 */
const UNIT_FLAGS_FULL = 0x1 | 0x2 | 0x100 | 0x400 | 0x1000 | 0x2000 | 0x200000 | 0x800000
/** Refresco en vivo: sólo lo que mueve el mapa (base, posición y mensaje, sensores para el encendido). */
const UNIT_FLAGS_POSITIONS = 0x1 | 0x400 | 0x1000

/**
 * Unidades con su último mensaje. La respuesta puede venir paginada; el tope
 * existe para que una cuenta enorme no tumbe la corrida: si se alcanza, la
 * sincronización se reporta parcial y queda el aviso.
 */
export async function fetchWialonUnits(
  credentials: WialonCredentials,
  options: { fetchImpl?: FetchLike; now?: () => number; positionsOnly?: boolean } = {},
): Promise<WialonUnitsResult> {
  const body = await wialonCall<{ items?: unknown }>(credentials, "core/search_items", {
    spec: {
      itemsType: "avl_unit",
      propName: "sys_name",
      propValueMask: "*",
      sortType: "sys_name",
    },
    force: 1,
    flags: options.positionsOnly ? UNIT_FLAGS_POSITIONS : UNIT_FLAGS_FULL,
    from: 0,
    to: 0,
  }, options)

  if (!Array.isArray(body.items)) throw new WialonClientError("WIALON_BAD_RESPONSE")
  const parsed = body.items
    .slice(0, MAX_UNITS)
    .map(parseUnit)
    .filter((unit): unit is WialonUnit => unit !== null)
  return { units: parsed, truncated: body.items.length > MAX_UNITS }
}

/**
 * «Probar conexión»: sólo token/login + logout. No lee unidades, no toca la
 * caché de sesión y no devuelve ni registra el token.
 */
export async function verifyWialonCredentials(
  credentials: WialonCredentials,
  options: { fetchImpl?: FetchLike } = {},
): Promise<void> {
  const sid = await loginWialon(credentials, options)
  await logoutWialon(credentials, sid, options)
}

function fuelPercent(value: number, sensorUnit: string | null, tankCapacityLiters: number | null): number | null {
  if (value < 0) return null
  // Sin la unidad del sensor no se adivina: 80 litros no son 80 %.
  const unitText = (sensorUnit ?? "").trim().toLowerCase()
  if (unitText.includes("%")) return clamp(value, 0, 100)
  if ((unitText === "l" || unitText.includes("litro")) && tankCapacityLiters != null && tankCapacityLiters > 0) {
    return clamp((value / tankCapacityLiters) * 100, 0, 100)
  }
  return null
}

/**
 * Nivel de combustible en %. Un parámetro configurado que viene en el mensaje
 * manda (crudo, como siempre). Si no, se usa el sensor de tipo «fuel level» de
 * la cuenta, pero SÓLO con su valor calculado por Wialon: el crudo de un `io_*`
 * de combustible suele necesitar la tabla de calibración y leerlo directo
 * inventaría litros.
 */
function resolveFuelLevel(unit: WialonUnit, parameter: string, tankCapacityLiters: number | null): number | null {
  const configured = parameter.trim()
  if (configured && Object.hasOwn(unit.lastMessageParams, configured)) {
    const sensor = unit.sensors.find((candidate) => candidate.p === configured)
    if (!sensor) return null
    // Si Wialon calculó el sensor (calibración incluida), ese valor gana sobre el crudo.
    const calculated = sensor.id ? unit.calculatedSensors?.[sensor.id] : undefined
    const value = calculated ?? asNumber(unit.lastMessageParams[configured])
    return value === null ? null : fuelPercent(value, sensor.unit, tankCapacityLiters)
  }
  const sensor = unit.sensors.find((candidate) => candidate.type === WIALON_SENSOR_TYPE.fuelLevel && candidate.id)
  const calculated = sensor?.id ? unit.calculatedSensors?.[sensor.id] : undefined
  return sensor && calculated != null ? fuelPercent(calculated, sensor.unit, tankCapacityLiters) : null
}

/** Sensores de combustible por unidad, para pedir su valor calculado. */
export function wialonFuelSensorRequests(units: readonly WialonUnit[]): Array<{ unitId: string; sensorIds: string[] }> {
  return units.flatMap((unit) => {
    const sensorIds = unit.sensors
      .filter((sensor) => sensor.type === WIALON_SENSOR_TYPE.fuelLevel && sensor.id)
      .map((sensor) => sensor.id!)
    return sensorIds.length > 0 ? [{ unitId: unit.id, sensorIds }] : []
  })
}

/** Tope de pedidos por `core/batch`: Wialon rechaza los lotes demasiado grandes. */
const CALC_BATCH_SIZE = 50

/**
 * Valores calculados del último mensaje (`unit/calc_last_message`, con
 * `flags: 1` = usar el último valor válido si el mensaje no trae el
 * parámetro), en lotes de `core/batch`. Devuelve unidad → sensor → valor; los
 * «N/A» de Wialon y las respuestas con error se omiten.
 */
export async function fetchWialonCalculatedSensors(
  credentials: WialonCredentials,
  requests: ReadonlyArray<{ unitId: string; sensorIds: string[] }>,
  options: { fetchImpl?: FetchLike; now?: () => number } = {},
): Promise<Map<string, Record<string, number>>> {
  const result = new Map<string, Record<string, number>>()
  for (let offset = 0; offset < requests.length; offset += CALC_BATCH_SIZE) {
    const chunk = requests.slice(offset, offset + CALC_BATCH_SIZE)
    const body = await wialonCall<unknown>(credentials, "core/batch", {
      params: chunk.map((request) => ({
        svc: "unit/calc_last_message",
        params: { unitId: Number(request.unitId), sensors: request.sensorIds.map(Number), flags: 1 },
      })),
      flags: 0,
    }, options)
    if (!Array.isArray(body)) throw new WialonClientError("WIALON_BAD_RESPONSE")
    chunk.forEach((request, index) => {
      const values = asRecord(body[index])
      if (!values || asNumber(values.error) != null) return
      const parsed: Record<string, number> = {}
      for (const sensorId of request.sensorIds) {
        const value = asNumber(values[sensorId])
        if (value !== null && Math.abs(value - WIALON_SENSOR_NA) > 1e-6) parsed[sensorId] = value
      }
      if (Object.keys(parsed).length > 0) result.set(request.unitId, parsed)
    })
  }
  return result
}

function normalizeMeterValue(value: number | null, unit: string | null | undefined, kind: "odometer" | "hour"): number | null {
  if (value == null) return null
  const normalized = (unit ?? "").trim().toLowerCase()
  if (kind === "odometer" && ["m", "metro", "metros"].includes(normalized)) return value / 1_000
  if (kind === "odometer" && ["mi", "milla", "millas"].includes(normalized)) return value * 1.609_344
  if (kind === "hour" && ["s", "seg", "segundo", "segundos"].includes(normalized)) return value / 3_600
  if (kind === "hour" && ["min", "minuto", "minutos"].includes(normalized)) return value / 60
  return value
}

/**
 * ¿La unidad mide con el parámetro configurado? Sí si lo trae en el último
 * mensaje o tiene un sensor sobre él (un mensaje puntual sin el parámetro no
 * cambia la serie de fuente: queda sin dato, no salta al contador).
 */
function usesParam(unit: WialonUnit, parameter: string, sensor: WialonSensor | undefined): boolean {
  return parameter !== "" && (Object.hasOwn(unit.lastMessageParams, parameter) || sensor !== undefined)
}

/**
 * Normaliza el último mensaje de una unidad. Devuelve `null` si no hay una
 * posición válida; un sensor ausente no se convierte en 0.
 */
export function extractWialonTelemetry(
  unit: WialonUnit,
  params: WialonTelemetryParams,
  fuelTankCapacityLiters: number | null = null,
): WialonTelemetry | null {
  const position = unit.position
  if (!position) return null
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null
  if (position.y < -90 || position.y > 90 || position.x < -180 || position.x > 180) return null

  const speedKph = clamp(asNumber(position.s) ?? 0, 0, 400)
  const headingDegrees = ((asNumber(position.c) ?? 0) % 360 + 360) % 360
  // Wialon no siempre publica `ignition`: las cuentas lo configuran como un
  // sensor de tipo «engine operation» sobre un `io_*` (en la cuenta real,
  // `io_239`). Orden: parámetro estándar, sensor de ese tipo y, como último
  // respaldo, un sensor cuyo nombre lo declara.
  const ignitionParam = Object.hasOwn(unit.lastMessageParams, "ignition")
    ? "ignition"
    : unit.sensors.find((sensor) => sensor.type === WIALON_SENSOR_TYPE.ignition)?.p
      ?? unit.sensors.find((sensor) => /ignic|ignition|encendido/i.test(`${sensor.name ?? ""} ${sensor.p}`))?.p
  const ignition = asOptionalBoolean(ignitionParam ? unit.lastMessageParams[ignitionParam] : null)
  const odometerParam = params.odometerParam.trim()
  const hourMeterParam = params.hourMeterParam.trim()
  const odometerSensor = odometerParam ? unit.sensors.find((sensor) => sensor.p === odometerParam) : undefined
  const hourMeterSensor = hourMeterParam ? unit.sensors.find((sensor) => sensor.p === hourMeterParam) : undefined

  return {
    latitude: position.y,
    longitude: position.x,
    speedKph,
    headingDegrees,
    ignition,
    // `lmsg.t` es la hora del último mensaje (puede ser un evento sin GPS);
    // `pos.t` es la hora de la posición que se está mostrando. Si la unidad
    // lleva días sin señal, la posición es vieja aunque el mensaje sea nuevo.
    gpsReportedAt: epochToIso(position.t) ?? unit.lastMessageAt,
    // Los medidores salen del último mensaje y de los contadores del servidor,
    // no de la posición: una unidad parada en un túnel sigue sumando horas.
    metersReportedAt: unit.lastMessageAt,
    satellites: position.sc === null ? null : Math.max(0, Math.round(position.sc)),
    // Un parámetro configurado manda en las unidades que lo traen; en las que
    // no (otro hardware, o el `mileage`/`engine_hours` que el `.env.example`
    // traía de ejemplo y que la cuenta real no publica), el contador de Wialon.
    odometer: usesParam(unit, odometerParam, odometerSensor)
      ? normalizeMeterValue(positiveNumber(unit.lastMessageParams[odometerParam]), odometerSensor?.unit, "odometer")
      : unit.counters.mileageKm,
    hourMeter: usesParam(unit, hourMeterParam, hourMeterSensor)
      ? normalizeMeterValue(positiveNumber(unit.lastMessageParams[hourMeterParam]), hourMeterSensor?.unit, "hour")
      : unit.counters.engineHours,
    fuelLevel: resolveFuelLevel(unit, params.fuelLevelParam, fuelTankCapacityLiters),
    movementState: speedKph > 0 ? "moving" : "stopped",
  }
}
