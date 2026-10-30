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

async function accessToken(credentials: VisionLinkCredentials, fetchImpl: FetchLike, now: () => number): Promise<string> {
  const key = credentials.clientId
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt - TOKEN_MARGIN_MS > now()) return cachedToken.token

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
  cachedToken = { key, token: body.access_token, expiresAt: now() + ttlSeconds * 1000 }
  return body.access_token
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
