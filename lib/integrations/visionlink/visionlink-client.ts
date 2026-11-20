/**
 * Cliente de la API VisionLink (Cat Digital). Sólo lectura: hoy se usa el
 * endpoint Utilization History, que trae por equipo y día las horas de
 * funcionamiento, ralentí y trabajo, con sus litros.
 *
 * Autenticación: client credentials contra Entra ID (tenant de Caterpillar).
 * El token dura 60 min y se reutiliza en memoria mientras le queden más de
 * cinco minutos. Límites del proveedor: 50.000 llamadas al día por client id y
 * 50 por segundo; una corrida diaria usa un puñado.
 */

const TOKEN_URL = "https://login.microsoftonline.com/ceb177bf-013b-49ab-8a9c-4abce32afc1e/oauth2/v2.0/token"
const UTILIZATION_URL = "https://services.cat.com/catDigital/utilizationHistory/v1/utilization"
const ASSET_OPERATIONS_URL = "https://services.cat.com/catDigital/assetOperationHistory/v2/assetOperations"
const API_HOST = "services.cat.com"
const REQUEST_TIMEOUT_MS = 30_000
const TOKEN_MARGIN_MS = 5 * 60_000
/** Tope de páginas por consulta: con 500 registros por página es holgado, y corta un cursor que nunca termina. */
const MAX_PAGES = 50

export type VisionLinkErrorCode =
  | "VISIONLINK_AUTH_FAILED"
  | "VISIONLINK_RATE_LIMITED"
  | "VISIONLINK_HTTP_ERROR"
  | "VISIONLINK_BAD_RESPONSE"
  | "VISIONLINK_TIMEOUT"
  /** La paginación no terminó dentro del tope: los datos están incompletos y no se deben guardar como completos. */
  | "VISIONLINK_TRUNCATED"

export class VisionLinkClientError extends Error {
  constructor(readonly code: VisionLinkErrorCode, readonly status?: number) {
    super(status ? `${code} (HTTP ${status})` : code)
    this.name = "VisionLinkClientError"
  }
}

export interface VisionLinkCredentials {
  clientId: string
  clientSecret: string
  /** Vacío = `<clientId>/.default`, que es lo que exige el tenant desde 2025. */
  scope?: string
}

export interface VisionLinkEquipmentHeader {
  make?: string | null
  model?: string | null
  serialNumber?: string | null
  equipmentId?: string | null
  productFamily?: string | null
}

export interface VisionLinkDailyUtilization {
  assetLocalDate?: string | null
  hourMeter?: number | null
  runtimeHours?: number | null
  idleHours?: number | null
  workingHours?: number | null
  runtimeFuelBurnedLiters?: number | null
  idleFuelBurnedLiters?: number | null
  workingFuelBurnedLiters?: number | null
  /** Cada clave trae `null` o el motivo por el que el valor no es confiable. */
  hourCallouts?: Record<string, string | null> | null
  fuelCallouts?: Record<string, string | null> | null
}

export interface VisionLinkUtilization {
  equipmentHeader?: VisionLinkEquipmentHeader | null
  dailyUtilizations?: VisionLinkDailyUtilization[] | null
}

/** Un tramo de operación de un equipo (Asset Operations): el motor en un estado entre dos instantes UTC. */
export interface VisionLinkSegment {
  /** UTC, sin la `Z` final (`2026-11-20T14:32:51`): se lee con `parseVisionLinkUtc`. */
  startStateUtc: string
  endStateUtc: string
  durationSeconds: number
  /** `idle`, `working` o `running`; quien consume decide qué hacer con otro valor. */
  segmentType: string
}

type FetchLike = typeof fetch

let cachedToken: { key: string; token: string; expiresAt: number } | null = null

/** Sólo para pruebas. */
export function resetVisionLinkTokenCache() {
  cachedToken = null
}

async function request(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new VisionLinkClientError("VISIONLINK_TIMEOUT")
    }
    throw error
  }
}

/** Pide un token nuevo al proveedor. Sin caché: quien llama decide si lo guarda. */
async function requestAccessToken(
  credentials: VisionLinkCredentials,
  fetchImpl: FetchLike,
): Promise<{ token: string; ttlSeconds: number }> {
  const response = await request(fetchImpl, TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: credentials.scope?.trim() || `${credentials.clientId}/.default`,
    }),
  })
  // El cuerpo de un error de Entra ID trae el client id y un trace: no se propaga.
  if (!response.ok) throw new VisionLinkClientError("VISIONLINK_AUTH_FAILED", response.status)
  const body = await response.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown } | null
  if (!body || typeof body.access_token !== "string") throw new VisionLinkClientError("VISIONLINK_AUTH_FAILED")
  const ttlSeconds = typeof body.expires_in === "number" ? body.expires_in : Number(body.expires_in) || 3600
  return { token: body.access_token, ttlSeconds }
}

async function accessToken(credentials: VisionLinkCredentials, fetchImpl: FetchLike, now: () => number): Promise<string> {
  const key = credentials.clientId
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt - TOKEN_MARGIN_MS > now()) return cachedToken.token

  const { token, ttlSeconds } = await requestAccessToken(credentials, fetchImpl)
  cachedToken = { key, token, expiresAt: now() + ttlSeconds * 1000 }
  return token
}

/**
 * «Probar conexión» de Ajustes › Integraciones: pide únicamente el token OAuth
 * con las credenciales dadas y lo descarta. No lee la caché ni la escribe: un
 * token en memoria de un secreto anterior habría dado por buena una credencial
 * que el proveedor ya no acepta, y probar no debe cambiar lo que usa el cron.
 *
 * No consulta ningún endpoint de datos (no gasta del cupo de 50.000 llamadas) y
 * lanza `VisionLinkClientError`, cuyo mensaje es sólo un código: nunca el cuerpo
 * de la respuesta ni las credenciales.
 */
export async function verifyVisionLinkCredentials(
  credentials: VisionLinkCredentials,
  options: { fetchImpl?: FetchLike } = {},
): Promise<void> {
  await requestAccessToken(credentials, options.fetchImpl ?? fetch)
}

/**
 * Uso diario de toda la flota suscrita entre `startDate` y `endDate`
 * (`YYYY-MM-DD`, fecha local del equipo, ambos inclusive). La API acepta hasta
 * 3 meses por consulta y 24 meses hacia atrás; quien llama parte el rango.
 *
 * Las páginas pueden repetir registros: el resultado viene deduplicado por
 * marca + serie + día (la llave que recomienda el proveedor), quedándose con la
 * última aparición.
 */
export async function fetchVisionLinkUtilization(
  credentials: VisionLinkCredentials,
  range: { startDate: string; endDate: string },
  options: { fetchImpl?: FetchLike; now?: () => number } = {},
): Promise<VisionLinkUtilization[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now
  const token = await accessToken(credentials, fetchImpl, now)

  const byAsset = new Map<string, { header: VisionLinkEquipmentHeader; days: Map<string, VisionLinkDailyUtilization> }>()
  let cursor: string | null = null
  let pages = 0
  do {
    const url = new URL(UTILIZATION_URL)
    url.searchParams.set("startDate", range.startDate)
    url.searchParams.set("endDate", range.endDate)
    if (cursor) url.searchParams.set("cursor", cursor)
    const response = await request(fetchImpl, url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    })
    if (response.status === 401 || response.status === 403) {
      cachedToken = null
      throw new VisionLinkClientError("VISIONLINK_AUTH_FAILED", response.status)
    }
    if (response.status === 429) throw new VisionLinkClientError("VISIONLINK_RATE_LIMITED", 429)
    if (!response.ok) throw new VisionLinkClientError("VISIONLINK_HTTP_ERROR", response.status)

    const body = await response.json().catch(() => null) as {
      utilizations?: unknown
      responseMetadata?: { nextCursor?: unknown } | null
    } | null
    if (!body || !Array.isArray(body.utilizations)) throw new VisionLinkClientError("VISIONLINK_BAD_RESPONSE")

    for (const item of body.utilizations as VisionLinkUtilization[]) {
      const header = item?.equipmentHeader
      const serial = header?.serialNumber?.trim().toUpperCase()
      if (!header || !serial) continue
      const key = `${(header.make ?? "").trim().toUpperCase()}|${serial}`
      const entry = byAsset.get(key) ?? { header, days: new Map() }
      for (const day of item.dailyUtilizations ?? []) {
        if (day?.assetLocalDate) entry.days.set(day.assetLocalDate, day)
      }
      byAsset.set(key, entry)
    }

    const next = body.responseMetadata?.nextCursor
    cursor = typeof next === "string" && next.length > 0 ? next : null
    pages++
  } while (cursor && pages < MAX_PAGES)

  return [...byAsset.values()].map(({ header, days }) => ({
    equipmentHeader: header,
    dailyUtilizations: [...days.values()].sort((a, b) => (a.assetLocalDate ?? "").localeCompare(b.assetLocalDate ?? "")),
  }))
}

interface SegmentsPage {
  assetOperations?: unknown
  assetOperationDateInfo?: unknown
  responseMetadata?: { nextCursor?: unknown } | null
}

interface RawSegment {
  startStateUtc?: unknown
  endStateUtc?: unknown
  durationSeconds?: unknown
  segmentType?: unknown
}

/**
 * Tramos de operación (idle / working / running) de UN equipo entre `startDate` y
 * `endDate` (`YYYY-MM-DD`, ambos inclusive; la API acepta hasta un mes por
 * consulta, quien llama parte el rango). Sólo existen con el motor encendido.
 *
 * La primera respuesta trae hasta 100 tramos y un `nextSegmentUrl`; esa URL
 * trae el resto, paginado con `responseMetadata.nextCursor` (se agrega como
 * `cursor` a la misma URL). Un tramo puede repetirse entre páginas: el resultado
 * viene deduplicado por inicio + tipo.
 *
 * Si la paginación no termina en `MAX_PAGES` páginas, o una URL se repite, lanza
 * `VISIONLINK_TRUNCATED` en vez de devolver lo juntado: quien sincroniza guardaría
 * días incompletos como conocidos (horas en 0 que en realidad no llegaron).
 *
 * Se sigue `nextSegmentUrl` sólo si apunta al mismo servidor: el token no debe
 * salir de Cat si la respuesta trae otra cosa.
 */
export async function fetchVisionLinkSegments(
  credentials: VisionLinkCredentials,
  query: { serialNumber: string; startDate: string; endDate: string; make?: string },
  options: { fetchImpl?: FetchLike; now?: () => number } = {},
): Promise<VisionLinkSegment[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const token = await accessToken(credentials, fetchImpl, options.now ?? Date.now)

  const first = new URL(ASSET_OPERATIONS_URL)
  first.searchParams.set("makeSerialNumbers", `${(query.make ?? "CAT").trim().toUpperCase()}|${query.serialNumber.trim()}`)
  first.searchParams.set("startDate", query.startDate)
  first.searchParams.set("endDate", query.endDate)

  const segments = new Map<string, VisionLinkSegment>()
  const visited = new Set<string>()
  let base = first
  let next: URL | null = first
  let pages = 0
  while (next) {
    const url = next.toString()
    if (pages >= MAX_PAGES || visited.has(url)) throw new VisionLinkClientError("VISIONLINK_TRUNCATED")
    visited.add(url)
    const response = await request(fetchImpl, url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    })
    if (response.status === 401 || response.status === 403) {
      cachedToken = null
      throw new VisionLinkClientError("VISIONLINK_AUTH_FAILED", response.status)
    }
    if (response.status === 429) throw new VisionLinkClientError("VISIONLINK_RATE_LIMITED", 429)
    if (!response.ok) throw new VisionLinkClientError("VISIONLINK_HTTP_ERROR", response.status)

    const body = await response.json().catch(() => null) as SegmentsPage | null
    if (!body || (!Array.isArray(body.assetOperations) && !Array.isArray(body.assetOperationDateInfo))) {
      throw new VisionLinkClientError("VISIONLINK_BAD_RESPONSE")
    }

    const lists: unknown[] = []
    let nextSegmentUrl: string | null = null
    for (const operation of Array.isArray(body.assetOperations) ? body.assetOperations as Array<Record<string, unknown> | null> : []) {
      if (Array.isArray(operation?.assetOperationDateInfo)) lists.push(operation.assetOperationDateInfo)
      if (!nextSegmentUrl && typeof operation?.nextSegmentUrl === "string" && operation.nextSegmentUrl) nextSegmentUrl = operation.nextSegmentUrl
    }
    if (Array.isArray(body.assetOperationDateInfo)) lists.push(body.assetOperationDateInfo)
    for (const list of lists) {
      for (const raw of list as RawSegment[]) {
        if (typeof raw?.startStateUtc !== "string" || typeof raw.endStateUtc !== "string" || typeof raw.segmentType !== "string") continue
        segments.set(`${raw.startStateUtc}|${raw.segmentType}`, {
          startStateUtc: raw.startStateUtc,
          endStateUtc: raw.endStateUtc,
          durationSeconds: Number(raw.durationSeconds) || 0,
          segmentType: raw.segmentType,
        })
      }
    }

    pages++
    const cursor = body.responseMetadata?.nextCursor
    if (nextSegmentUrl) {
      let target: URL
      try {
        target = new URL(nextSegmentUrl, base)
      } catch {
        throw new VisionLinkClientError("VISIONLINK_BAD_RESPONSE")
      }
      if (target.protocol !== "https:" || target.hostname !== API_HOST) throw new VisionLinkClientError("VISIONLINK_BAD_RESPONSE")
      target.searchParams.delete("cursor")
      base = target
      next = target
    } else if (typeof cursor === "string" && cursor.length > 0) {
      const target = new URL(base)
      target.searchParams.set("cursor", cursor)
      next = target
    } else {
      next = null
    }
  }
  return [...segments.values()].sort((a, b) => a.startStateUtc.localeCompare(b.startStateUtc))
}
