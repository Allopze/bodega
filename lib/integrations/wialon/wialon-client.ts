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
    { token: credentials.token },
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

function parseSensor(value: unknown): WialonSensor[] {
  const record = asRecord(value)
  const parameter = asString(record?.p)
  if (!parameter) return []
  return [{
    p: parameter,
    name: asString(record?.n),
    type: asNumber(record?.t),
    unit: asString(record?.m),
  }]
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
    ? sensorSource.flatMap(parseSensor)
    : Object.values(asRecord(sensorSource) ?? {}).flatMap(parseSensor)
  return {
    id,
    name: asString(item.nm) ?? id,
    sysName: asString(item.sys_name),
    groupId: asString(item.grp) ?? asString(item.fid),
    uniqueId: asString(item.uid),
    hardwareType: asString(item.hw),
    customProperties: asRecord(item.prp) ?? {},
    sensors,
    position,
    lastMessageParams: asRecord(lastMessage?.p) ?? {},
    lastMessageAt: epochToIso(asNumber(lastMessage?.t) ?? position?.t ?? null),
  }
}

/**
 * Unidades con su último mensaje. La respuesta puede venir paginada; el tope
 * existe para que una cuenta enorme no tumbe la corrida: si se alcanza, la
 * sincronización se reporta parcial y queda el aviso.
 */
export async function fetchWialonUnits(
  credentials: WialonCredentials,
  options: { fetchImpl?: FetchLike; now?: () => number } = {},
): Promise<WialonUnitsResult> {
  const body = await wialonCall<{ items?: unknown }>(credentials, "core/search_items", {
    spec: {
      itemsType: "avl_unit",
      propName: "sys_name",
      propValueMask: "*",
      sortType: "sys_name",
    },
    force: 1,
    flags: 1 | 2 | 1024 | 4096,
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

function resolveFuelLevel(unit: WialonUnit, parameter: string, tankCapacityLiters: number | null): number | null {
  const raw = asNumber(unit.lastMessageParams[parameter])
  if (raw === null || raw < 0) return null
  const sensor = unit.sensors.find((candidate) => candidate.p === parameter)
  // Sin la unidad del sensor no se adivina: 80 litros no son 80 %.
  if (!sensor) return null
  const unitText = (sensor.unit ?? "").trim().toLowerCase()

  if (unitText.includes("%")) {
    return clamp(raw, 0, 100)
  }
  if ((unitText === "l" || unitText.includes("litro")) && tankCapacityLiters != null && tankCapacityLiters > 0) {
    return clamp((raw / tankCapacityLiters) * 100, 0, 100)
  }
  return null
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
  // Wialon no siempre publica `ignition`: muchas cuentas lo configuran como un
  // sensor con nombre «ignición» sobre un `io_*`. Se usa el parámetro estándar
  // si existe; si no, el primer sensor cuyo nombre lo declara.
  const ignitionParam = Object.hasOwn(unit.lastMessageParams, "ignition")
    ? "ignition"
    : unit.sensors.find((sensor) => /ignic|ignition|encendido/i.test(`${sensor.name ?? ""} ${sensor.p}`))?.p
  const ignition = asOptionalBoolean(ignitionParam ? unit.lastMessageParams[ignitionParam] : null)
  const odometerSensor = unit.sensors.find((sensor) => sensor.p === params.odometerParam)
  const hourMeterSensor = unit.sensors.find((sensor) => sensor.p === params.hourMeterParam)

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
    satellites: position.sc === null ? null : Math.max(0, Math.round(position.sc)),
    odometer: normalizeMeterValue(
      positiveNumber(unit.lastMessageParams[params.odometerParam]),
      odometerSensor?.unit,
      "odometer",
    ),
    hourMeter: normalizeMeterValue(
      positiveNumber(unit.lastMessageParams[params.hourMeterParam]),
      hourMeterSensor?.unit,
      "hour",
    ),
    fuelLevel: resolveFuelLevel(unit, params.fuelLevelParam, fuelTankCapacityLiters),
    movementState: speedKph > 0 ? "moving" : "stopped",
  }
}
