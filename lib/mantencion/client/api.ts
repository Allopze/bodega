import type {
  DeviceCredentialResponse,
  MantCatalog,
  MantCatalogOthers,
  ObservationReply,
  SyncRecord,
  SyncRecordResponse,
  SyncWarning,
  WorkshopUpdatePayload,
} from "../contracts"
import type { StoredPhoto } from "./types"

/**
 * Cliente HTTP de la sincronización. Una sola regla de clasificación para toda
 * la app (ver el comentario de `SyncRecordResponse`):
 *  - 401/403 → la credencial venció, la revocaron o no hay permiso: `auth`.
 *  - red caída, 408, 429, 5xx → `retry` (backoff).
 *  - cualquier otro 4xx (409/422 incluidos) → `reject`: rechazo definitivo; el
 *    registro queda «Rechazado» con su motivo y nunca se descarta.
 */

export type ApiFailure =
  | { kind: "auth"; status: number; message: string }
  | { kind: "retry"; message: string; retryAfterMs: number | null; network: boolean }
  | { kind: "reject"; status: number; code: string | null; field: string | null; message: string }
export type ApiResult<T> = { kind: "ok"; value: T } | ApiFailure

type FetchFn = typeof fetch

const DEFAULT_TIMEOUT_MS = 45_000
const PHOTO_TIMEOUT_MS = 120_000

export const NETWORK_MESSAGE = "Sin señal o la plataforma no responde."

export function classifyStatus(status: number): "auth" | "retry" | "reject" {
  if (status === 401 || status === 403) return "auth"
  if (status === 408 || status === 425 || status === 429 || status >= 500) return "retry"
  return "reject"
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await response.json()
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function messageFrom(body: Record<string, unknown> | null, fallback: string): string {
  const text = body?.message ?? body?.error
  return typeof text === "string" && text.trim() ? text : fallback
}

function retryAfter(response: Response): number | null {
  const raw = response.headers.get("retry-after")
  if (!raw) return null
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) * 1000 : null
}

async function failureFrom(response: Response, fallback: string): Promise<ApiFailure> {
  const body = await readJson(response)
  const message = messageFrom(body, fallback)
  const kind = classifyStatus(response.status)
  if (kind === "auth") return { kind, status: response.status, message }
  if (kind === "retry") return { kind, message, retryAfterMs: retryAfter(response), network: false }
  return {
    kind,
    status: response.status,
    code: typeof body?.code === "string" ? body.code : null,
    field: typeof body?.field === "string" ? body.field : null,
    message,
  }
}

async function send(fetchImpl: FetchFn, url: string, init: RequestInit, timeoutMs: number): Promise<Response | ApiFailure> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } catch {
    return { kind: "retry", message: NETWORK_MESSAGE, retryAfterMs: null, network: true }
  } finally {
    clearTimeout(timer)
  }
}

function isFailure(value: Response | ApiFailure): value is ApiFailure {
  return !(value instanceof Response) && "kind" in value
}

function bearer(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` }
}

/** `POST /api/mantencion/dispositivo`: con la sesión de la plataforma (cookie), pide la credencial de este equipo. */
export async function requestCredential(deviceId: string, label: string, fetchImpl: FetchFn = fetch): Promise<ApiResult<DeviceCredentialResponse>> {
  const response = await send(fetchImpl, "/api/mantencion/dispositivo", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId, label }),
  }, DEFAULT_TIMEOUT_MS)
  if (isFailure(response)) return response
  if (response.status === 401) return { kind: "auth", status: 401, message: "Tu sesión de la plataforma venció." }
  if (response.status === 403) return { kind: "auth", status: 403, message: "Tu cuenta no tiene permiso para usar la app de mantención." }
  if (!response.ok) return failureFrom(response, "No pudimos preparar este teléfono.")
  const body = (await readJson(response)) as DeviceCredentialResponse | null
  if (!body?.token || !body.user?.id) return { kind: "retry", message: "La plataforma respondió algo inesperado.", retryAfterMs: null, network: false }
  return { kind: "ok", value: body }
}

export type CatalogFetch<T> = { notModified: true } | { notModified: false; etag: string | null; body: T }

async function getCatalog<T extends { version: string }>(token: string, etag: string | null, scope: "mias" | "todos", fetchImpl: FetchFn): Promise<ApiResult<CatalogFetch<T>>> {
  const headers: Record<string, string> = { ...(bearer(token) as Record<string, string>) }
  if (etag) headers["If-None-Match"] = etag
  const url = scope === "todos" ? "/api/mantencion/sync/catalogo?alcance=todos" : "/api/mantencion/sync/catalogo"
  const response = await send(fetchImpl, url, { method: "GET", headers, credentials: "omit" }, DEFAULT_TIMEOUT_MS)
  if (isFailure(response)) return response
  if (response.status === 304) return { kind: "ok", value: { notModified: true } }
  if (!response.ok) return failureFrom(response, "No pudimos actualizar los equipos.")
  const body = (await readJson(response)) as T | null
  if (!body?.version) return { kind: "retry", message: "La plataforma respondió algo inesperado.", retryAfterMs: null, network: false }
  return { kind: "ok", value: { notModified: false, etag: response.headers.get("etag") ?? `"${body.version}"`, body } }
}

export const fetchCatalog = (token: string, etag: string | null, fetchImpl: FetchFn = fetch) =>
  getCatalog<MantCatalog>(token, etag, "mias", fetchImpl)

export const fetchCatalogOthers = (token: string, etag: string | null, fetchImpl: FetchFn = fetch) =>
  getCatalog<MantCatalogOthers>(token, etag, "todos", fetchImpl)

/** `PUT /api/mantencion/sync/fotos/{id}`: idempotente por id y sha256. */
export async function uploadPhoto(token: string, photo: StoredPhoto, fetchImpl: FetchFn = fetch): Promise<ApiResult<null>> {
  const form = new FormData()
  form.set("file", photo.blob, `${photo.id}.jpg`)
  form.set("meta", JSON.stringify({
    kind: photo.kind,
    sha256: photo.sha256,
    width: photo.width,
    height: photo.height,
    stampedAt: photo.stampedAt,
    takenAtExif: photo.takenAtExif,
    exif: photo.exif,
    deviceId: photo.deviceId,
  }))
  const response = await send(fetchImpl, `/api/mantencion/sync/fotos/${encodeURIComponent(photo.id)}`, {
    method: "PUT", headers: bearer(token), body: form, credentials: "omit",
  }, PHOTO_TIMEOUT_MS)
  if (isFailure(response)) return response
  if (response.ok) return { kind: "ok", value: null }
  return failureFrom(response, "La plataforma no aceptó la foto.")
}

export interface RecordAccepted {
  id: string
  folio: string
  receivedAt: string
  duplicate: boolean
  warnings: SyncWarning[]
}

/** `POST /api/mantencion/sync/registros`. 200 con el mismo folio si el registro ya existía. */
export async function postRecord(token: string, payload: SyncRecord, fetchImpl: FetchFn = fetch): Promise<ApiResult<RecordAccepted>> {
  const response = await send(fetchImpl, "/api/mantencion/sync/registros", {
    method: "POST", headers: { ...(bearer(token) as Record<string, string>), "content-type": "application/json" },
    body: JSON.stringify(payload), credentials: "omit",
  }, DEFAULT_TIMEOUT_MS)
  if (isFailure(response)) return response
  if (!response.ok) return failureFrom(response, "La plataforma rechazó el registro.")
  const body = (await readJson(response)) as SyncRecordResponse | null
  if (body && body.ok === true) {
    return { kind: "ok", value: { id: body.id, folio: body.folio, receivedAt: body.receivedAt, duplicate: body.duplicate, warnings: body.warnings ?? [] } }
  }
  if (body && body.ok === false) {
    const retryable = body.code === "rate_limited" || body.code === "error"
    return retryable
      ? { kind: "retry", message: body.message, retryAfterMs: null, network: false }
      : { kind: "reject", status: response.status, code: body.code, field: body.field ?? null, message: body.message }
  }
  return { kind: "retry", message: "La plataforma respondió algo inesperado.", retryAfterMs: null, network: false }
}

async function postSimple(path: string, token: string, payload: unknown, fetchImpl: FetchFn, fallback: string): Promise<ApiResult<null>> {
  const response = await send(fetchImpl, path, {
    method: "POST", headers: { ...(bearer(token) as Record<string, string>), "content-type": "application/json" },
    body: JSON.stringify(payload), credentials: "omit",
  }, DEFAULT_TIMEOUT_MS)
  if (isFailure(response)) return response
  if (response.ok) return { kind: "ok", value: null }
  return failureFrom(response, fallback)
}

export const postWorkshopUpdate = (token: string, payload: WorkshopUpdatePayload, fetchImpl: FetchFn = fetch) =>
  postSimple("/api/mantencion/sync/taller", token, payload, fetchImpl, "La plataforma rechazó la actualización.")

export const postObservationReply = (token: string, payload: ObservationReply, fetchImpl: FetchFn = fetch) =>
  postSimple("/api/mantencion/sync/observaciones", token, payload, fetchImpl, "La plataforma rechazó la respuesta.")
