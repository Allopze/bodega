/**
 * Cliente de la API de Talana (remuneraciones). Sólo lectura: contratos y
 * ausencias. Ver https://developers.talana.com.
 *
 * Límite del proveedor: sobre 50 peticiones por minuto responde 429 y bloquea
 * esa URL durante 10 minutos. Por eso las peticiones se espacian (3,5 s, ~17 por
 * minuto) y un 429 no se reintenta: la corrida falla y la del día siguiente lo
 * vuelve a intentar. Una corrida completa son ~7 peticiones.
 *
 * Los filtros por rango de fechas de Talana no son confiables (devuelven
 * contratos fuera del rango): se descarga la lista completa y se filtra acá.
 */
import { cleanRut, validateRut } from "@/lib/rut"

export const TALANA_API_BASE_URL = "https://talana.com/es/api"
const TALANA_HOST = "talana.com"
const REQUEST_TIMEOUT_MS = 30_000
export const TALANA_REQUEST_SPACING_MS = 3_500
/** Con 100 por página, ~360 contratos son 4 páginas: 20 es holgado y corta un `next` que nunca termina. */
const MAX_PAGES = 20
const PAGE_SIZE = 100

export type TalanaErrorCode =
  | "TALANA_AUTH_FAILED"
  | "TALANA_RATE_LIMITED"
  | "TALANA_HTTP_ERROR"
  | "TALANA_BAD_RESPONSE"
  | "TALANA_TIMEOUT"
  | "TALANA_FOREIGN_NEXT_URL"

export class TalanaClientError extends Error {
  constructor(readonly code: TalanaErrorCode, readonly status?: number) {
    super(status ? `${code} (HTTP ${status})` : code)
    this.name = "TalanaClientError"
  }
}

/** Contrato de Talana con sólo los campos que usa la sincronización. */
export interface TalanaContractRow {
  id: number
  personId: number | null
  /** Canónico `12345678-9` si el RUT es válido; si no, el texto tal cual. */
  rut: string
  rutValid: boolean
  firstName: string | null
  lastNamePaternal: string | null
  lastNameMaternal: string | null
  sex: "M" | "F" | "N" | null
  employerName: string | null
  contractType: string | null
  cargo: string | null
  costCenterId: number | null
  costCenterName: string | null
  /** Canónico si es válido, si no `null`. */
  jefeRut: string | null
  jefeName: string | null
  hiredOn: string | null
  startsOn: string | null
  endsOn: string | null
  finiquitado: boolean
  active: boolean | null
  modifiedAt: string | null
}

export interface TalanaAbsenceRow {
  id: number
  rut: string
  type: string | null
  startsOn: string
  endsOn: string
  returnOn: string | null
  status: string | null
  approved: boolean | null
}

export interface TalanaListResult<T> {
  rows: T[]
  /** Filas descartadas por venir sin la forma esperada. */
  rejected: number
  /** `count` que declara la paginación de Talana; `null` si la respuesta no es paginada. */
  declaredCount: number | null
  pages: number
  /** Se alcanzó el tope de páginas con `next` todavía presente. */
  truncated: boolean
}

type FetchLike = typeof fetch

export interface TalanaClientOptions {
  token: string
  fetchImpl?: FetchLike
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  spacingMs?: number
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/* ── Lectura defensiva de campos ──────────────────────────────────────────── */

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)

function str(value: unknown, max = 300): string | null {
  if (typeof value !== "string") return null
  const out = value.replace(/\s+/g, " ").trim()
  return out ? out.slice(0, max) : null
}

function int(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN
  return Number.isSafeInteger(n) ? n : null
}

function bool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  if (value === "true" || value === "True") return true
  if (value === "false" || value === "False") return false
  return null
}

/** Fecha civil `YYYY-MM-DD` (acepta un datetime y se queda con la fecha). */
function civilDate(value: unknown): string | null {
  if (typeof value !== "string") return null
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim())
  return match ? match[1]! : null
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string") return null
  return Number.isNaN(Date.parse(value)) ? null : new Date(value).toISOString()
}

function personName(person: Json | null): string | null {
  if (!person) return null
  const parts = [str(person.nombre, 160), str(person.apellidoPaterno, 160), str(person.apellidoMaterno, 160)].filter(Boolean)
  return parts.length ? parts.join(" ") : null
}

function canonicalRut(value: unknown): { rut: string; valid: boolean } | null {
  const raw = str(value, 20)
  if (!raw) return null
  return validateRut(raw) ? { rut: cleanRut(raw), valid: true } : { rut: raw, valid: false }
}

export function parseTalanaContract(raw: unknown): TalanaContractRow | null {
  if (!isObject(raw)) return null
  const id = int(raw.id)
  const person = isObject(raw.personaDetails) ? raw.personaDetails : null
  const rut = canonicalRut(raw.persona_rut ?? person?.rut)
  const finiquitado = bool(raw.finiquitado)
  if (id === null || !rut || finiquitado === null) return null
  const jefe = isObject(raw.jefe) ? raw.jefe : null
  const jefeRut = canonicalRut(jefe?.rut)
  const sex = str(person?.sexo, 1)
  const costCenter = isObject(raw.centroCosto) ? raw.centroCosto : null
  return {
    id,
    personId: int(raw.empleado),
    rut: rut.rut,
    rutValid: rut.valid,
    firstName: str(person?.nombre, 160),
    lastNamePaternal: str(person?.apellidoPaterno, 160),
    lastNameMaternal: str(person?.apellidoMaterno, 160),
    sex: sex === "M" || sex === "F" || sex === "N" ? sex : null,
    employerName: str(isObject(raw.empleadorRazonSocial) ? raw.empleadorRazonSocial.razonSocial : null, 200),
    contractType: str(isObject(raw.tipoContrato) ? raw.tipoContrato.nombre : null, 120),
    cargo: str(raw.cargo, 300),
    costCenterId: int(costCenter?.id),
    costCenterName: str(costCenter?.nombre, 200),
    jefeRut: jefeRut?.valid ? jefeRut.rut : null,
    jefeName: personName(jefe),
    hiredOn: civilDate(raw.fechaContratacion),
    startsOn: civilDate(raw.desde),
    endsOn: civilDate(raw.hasta),
    finiquitado,
    active: bool(raw.activo),
    modifiedAt: timestamp(raw.fechaModificacion),
  }
}

export function parseTalanaAbsence(raw: unknown): TalanaAbsenceRow | null {
  if (!isObject(raw)) return null
  const id = int(raw.id)
  const person = isObject(raw.empleado) ? raw.empleado : null
  const rut = canonicalRut(person?.rut)
  const startsOn = civilDate(raw.fechaDesde)
  const endsOn = civilDate(raw.fechaHasta)
  if (id === null || !rut?.valid || !startsOn || !endsOn) return null
  return {
    id,
    rut: rut.rut,
    type: str(raw.tipoAusencia, 120),
    startsOn,
    endsOn,
    returnOn: civilDate(raw.fechaRetorno),
    status: str(raw.estado, 60),
    approved: bool(raw.aprobada),
  }
}

/* ── Cliente ──────────────────────────────────────────────────────────────── */

/**
 * `next` de la paginación sólo si apunta a Talana: el token nunca viaja a otro
 * dominio. Si llega como `http://` (Talana detrás de un proxy), se sube a https.
 */
export function safeNextUrl(next: unknown): string | null {
  if (next === null || next === undefined || next === "") return null
  if (typeof next !== "string") throw new TalanaClientError("TALANA_BAD_RESPONSE")
  let url: URL
  try {
    url = new URL(next)
  } catch {
    throw new TalanaClientError("TALANA_FOREIGN_NEXT_URL")
  }
  if (url.hostname !== TALANA_HOST || (url.protocol !== "https:" && url.protocol !== "http:")) {
    throw new TalanaClientError("TALANA_FOREIGN_NEXT_URL")
  }
  url.protocol = "https:"
  return url.toString()
}

export function createTalanaClient(options: TalanaClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now
  const spacingMs = options.spacingMs ?? TALANA_REQUEST_SPACING_MS
  let lastRequestAt: number | null = null

  async function get(url: string): Promise<unknown> {
    if (lastRequestAt !== null) {
      const wait = lastRequestAt + spacingMs - now()
      if (wait > 0) await sleep(wait)
    }
    lastRequestAt = now()
    let response: Response
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: `Token ${options.token}`, Accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new TalanaClientError("TALANA_TIMEOUT")
      }
      throw new TalanaClientError("TALANA_HTTP_ERROR")
    }
    // El cuerpo de un error de Talana no se propaga ni se registra.
    if (response.status === 401 || response.status === 403) throw new TalanaClientError("TALANA_AUTH_FAILED", response.status)
    if (response.status === 429) throw new TalanaClientError("TALANA_RATE_LIMITED", 429)
    if (!response.ok) throw new TalanaClientError("TALANA_HTTP_ERROR", response.status)
    const body = await response.json().catch(() => undefined)
    if (body === undefined) throw new TalanaClientError("TALANA_BAD_RESPONSE")
    return body
  }

  async function list<T>(firstUrl: string, parse: (raw: unknown) => T | null): Promise<TalanaListResult<T>> {
    const rows: T[] = []
    let rejected = 0
    let declaredCount: number | null = null
    let pages = 0
    let url: string | null = firstUrl
    while (url && pages < MAX_PAGES) {
      const body = await get(url)
      pages++
      let items: unknown[]
      if (Array.isArray(body)) {
        items = body
        url = null
      } else if (isObject(body) && Array.isArray(body.results)) {
        items = body.results
        if (pages === 1) declaredCount = int(body.count)
        url = safeNextUrl(body.next)
      } else {
        throw new TalanaClientError("TALANA_BAD_RESPONSE")
      }
      for (const item of items) {
        const row = parse(item)
        if (row) rows.push(row)
        else rejected++
      }
    }
    return { rows, rejected, declaredCount, pages, truncated: url !== null }
  }

  return {
    /**
     * Comprobación de credenciales para «Probar conexión»: UNA petición por
     * `contracts-resumed-paginated` con `page_size=1`, sin seguir `next`. Con el
     * límite de Talana (50 por minuto y 10 minutos de bloqueo de la URL) una
     * prueba tiene que costar una sola petición, y no se reintenta ni siquiera
     * ante un 429. Devuelve sólo el `count` declarado (contratos activos e
     * históricos, no sólo los vigentes) y nunca el cuerpo: el diálogo no debe
     * poder mostrar datos de personas.
     */
    async ping(): Promise<{ ok: true; contractCount: number | null }> {
      const url = new URL(`${TALANA_API_BASE_URL}/contracts-resumed-paginated/`)
      url.searchParams.set("page_size", "1")
      const body = await get(url.toString())
      if (Array.isArray(body)) return { ok: true, contractCount: null }
      if (isObject(body) && Array.isArray(body.results)) return { ok: true, contractCount: int(body.count) }
      throw new TalanaClientError("TALANA_BAD_RESPONSE")
    },
    /** Todos los contratos (activos e históricos), o sólo los vigentes hoy. */
    listContracts({ onlyActive }: { onlyActive: boolean }) {
      const url = new URL(`${TALANA_API_BASE_URL}/contracts-resumed-paginated/`)
      url.searchParams.set("page_size", String(PAGE_SIZE))
      if (onlyActive) url.searchParams.set("solo-activos", "true")
      return list(url.toString(), parseTalanaContract)
    },
    /** Ausencias aprobadas cuyo término es `absentSince` o posterior. */
    listAbsences({ absentSince }: { absentSince: string }) {
      const url = new URL(`${TALANA_API_BASE_URL}/absentism-resumed/`)
      url.searchParams.set("absent_since", absentSince)
      return list(url.toString(), parseTalanaAbsence)
    },
  }
}

/**
 * Lo que la sincronización necesita del cliente. `ping` (Probar conexión) queda
 * fuera a propósito: es de la pantalla de configuración, y exigirlo obligaría a
 * cada doble de prueba de la sincronización a implementarlo.
 */
export type TalanaClient = Pick<ReturnType<typeof createTalanaClient>, "listContracts" | "listAbsences">
