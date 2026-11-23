import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import type { Browser, BrowserServer, Page, Response, Route } from "playwright"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import {
  ONWAY_AUTH_ORIGIN,
  ONWAY_CHALLENGE_TTL_MS,
  ONWAY_PORTAL_ORIGIN,
  isAllowedOnwayChallengeNavigation,
  isOnwayChallengeSolvedUrl,
  onwayChallengeRemainingMs,
  parseOnwayChallengeInput,
  type OnwayChallengeStatus,
  type OnwayChallengeViewport,
} from "./onway-interactive-auth-contract"
import { parseOnwaySnapshot, type OnwaySnapshotResult } from "./onway-contract"
import {
  parseOnwayAlertRows,
  parseOnwayDeviceDetail,
  parseOnwayHistory,
  parseOnwayTrips,
  type OnwayAlertSnapshot,
  type OnwayDeviceTelemetry,
  type OnwayHistoryPoint,
  type OnwayTripSnapshot,
} from "./onway-telemetry-contract"

const TRACKING_URL = `${ONWAY_PORTAL_ORIGIN}/OnlineTracking/Index/es`
const SNAPSHOT_PATH = "/OnlineTracking/GetOnlineDevicesInfoByUserForMap/"
const DEVICE_DETAIL_PATH = "/OnlineTracking/GetOnlineDeviceInfoByIdFromMap"
const ALERTS_PATH = "/OnlineTracking/GetDevicesAlertsHistory/"
const NAVIGATION_TIMEOUT_MS = 45_000
/**
 * Un `fetch` dentro de la página no tiene timeout propio y `page.evaluate`
 * tampoco: una sola respuesta que el portal deja sin contestar colgaba la
 * corrida para siempre con el lock del cron tomado (2026-10-29 → 2026-11-01,
 * seis corridas en `running` y el GPS detenido hasta cada reinicio).
 */
const PORTAL_REQUEST_TIMEOUT_MS = 20_000
/** Tope de toda la lectura del portal: menor que los 2 min del runner y que el intervalo de 5 min. */
export const ONWAY_TELEMETRY_DEADLINE_MS = 110_000
/** Equipos cuyo historial y viajes se piden a la vez (medido: 2 h de 50 equipos ~14 s; 24 h ~36 s). */
const HISTORY_CONCURRENCY = 5
/** Margen antes del plazo para no empezar equipos nuevos: lo que ya corre debe alcanzar a terminar. */
const HISTORY_RESERVE_MS = 20_000
const BROWSER_CLOSE_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024
const MAX_TELEMETRY_DEVICES = 500

interface OnwayBrowserSession {
  server: BrowserServer
  browser: Browser
  page: Page
  /** Huella (sólo en memoria) de la cuenta con la que se autenticó la página. */
  account: string
}

interface OnwayPortalDeviceRef {
  deviceId: string
  unitId: string
  imei: string | null
}

interface OnwayPortalSnapshot {
  snapshot: OnwaySnapshotResult
  refs: OnwayPortalDeviceRef[]
}

export interface OnwayTelemetryBundle {
  snapshot: OnwaySnapshotResult
  details: OnwayDeviceTelemetry[]
  alerts: OnwayAlertSnapshot[]
  historyByDeviceId: Map<string, OnwayHistoryPoint[]>
  tripsByDeviceId: Map<string, OnwayTripSnapshot[]>
  /** Flujos opcionales que fallaron sin invalidar la posición actual. */
  warnings: Array<"details" | "alerts" | "history" | "trips">
}

export interface OnwayCredentials {
  username: string
  password: string
}

export type OnwayChallengeErrorCode =
  | "ONWAY_CHALLENGE_BUSY"
  | "ONWAY_CHALLENGE_ACTIVE"
  | "ONWAY_CHALLENGE_NOT_FOUND"
  | "ONWAY_CHALLENGE_FORBIDDEN"
  | "ONWAY_CHALLENGE_EXPIRED"
  | "ONWAY_CHALLENGE_CLOSED"
  | "ONWAY_CHALLENGE_SOLVED"
  | "ONWAY_CHALLENGE_FRAME_UNAVAILABLE"
  | "ONWAY_CHALLENGE_INPUT_INVALID"

/** Errores propios de la vista asistida; no se mezclan con los del scraper. */
export class OnwayChallengeError extends Error {
  constructor(readonly code: OnwayChallengeErrorCode) {
    super(code)
    this.name = "OnwayChallengeError"
  }
}

export interface OnwayChallengePublic {
  id: string
  status: "awaiting"
  expiresAt: number
  viewport: OnwayChallengeViewport
}

export type OnwayInteractiveAuthStart =
  | { status: "authenticated" }
  | { status: "awaiting"; challenge: OnwayChallengePublic }

export interface OnwayChallengeStatusView {
  id: string
  status: OnwayChallengeStatus
  expiresAt: number
  viewport: OnwayChallengeViewport
  remainingMs: number
}

export type OnwayClientErrorCode =
  | "ONWAY_CREDENTIALS_REQUIRED"
  | "ONWAY_CREDENTIALS_INVALID"
  | "ONWAY_AUTH_REJECTED"
  | "ONWAY_INTERACTIVE_AUTH_REQUIRED"
  | "ONWAY_PORTAL_TIMEOUT"
  | "ONWAY_RESPONSE_INVALID"
  /** El portal aceptó la sesión pero no devolvió ningún equipo. */
  | "ONWAY_SNAPSHOT_EMPTY"
  | "ONWAY_SYNC_FAILED"

export class OnwayClientError extends Error {
  constructor(readonly code: OnwayClientErrorCode) {
    super(code)
    this.name = "OnwayClientError"
  }
}

export function validateOnwayCredentials(input: OnwayCredentials): OnwayCredentials {
  const username = input.username.trim()
  const password = input.password
  if (!username || !password) throw new OnwayClientError("ONWAY_CREDENTIALS_REQUIRED")
  if (username.length > 320 || password.length > 320) throw new OnwayClientError("ONWAY_CREDENTIALS_INVALID")
  return { username, password }
}

export function resolveOnwayLaunchOptions(executablePath: string | undefined): { headless: true; executablePath?: string } {
  const path = executablePath?.trim()
  return path ? { headless: true, executablePath: path } : { headless: true }
}

export function isAllowedOnwayAuthUrl(input: string): boolean {
  try { return new URL(input).origin === ONWAY_AUTH_ORIGIN }
  catch { return false }
}

function isSnapshotResponse(response: Response): boolean {
  try {
    const url = new URL(response.url())
    return url.origin === ONWAY_PORTAL_ORIGIN
      && url.pathname === SNAPSHOT_PATH
      && response.request().method() === "POST"
  } catch {
    return false
  }
}

async function openAuthentication(page: Page, usernameTimeoutMs: number = NAVIGATION_TIMEOUT_MS): Promise<void> {
  const signIn = page.locator("#smalAuth0ActionLogin")
  if (new URL(page.url()).origin === ONWAY_PORTAL_ORIGIN) {
    try {
      await signIn.waitFor({ state: "visible", timeout: NAVIGATION_TIMEOUT_MS })
      await signIn.click()
    } catch {
      throw new OnwayClientError("ONWAY_PORTAL_TIMEOUT")
    }
  }
  try {
    await page.waitForURL((url) => isAllowedOnwayAuthUrl(url.href), { timeout: NAVIGATION_TIMEOUT_MS })
  } catch {
    throw new OnwayClientError("ONWAY_AUTH_REJECTED")
  }
  try {
    await page.locator('input[name="username"]').waitFor({ state: "visible", timeout: usernameTimeoutMs })
  } catch {
    throw new OnwayClientError(
      await hasInteractiveChallenge(page) ? "ONWAY_INTERACTIVE_AUTH_REQUIRED" : "ONWAY_PORTAL_TIMEOUT",
    )
  }
}

async function hasInteractiveChallenge(page: Page): Promise<boolean> {
  // OTP y captcha comparten código de error, pero piden remedios distintos
  // (cuenta de servicio sin segundo factor vs. IP marcada): el log los separa.
  const [otp, captcha] = await Promise.all([
    page.locator('input[name="otp"], input[autocomplete="one-time-code"]').count(),
    // Auth0 delega en hCaptcha/reCAPTCHA/Arkose: el iframe no siempre lleva
    // "captcha" en src ni en title, y el widget nuevo se pinta en un div.
    page.locator('iframe[src*="captcha" i], iframe[title*="captcha" i], [data-captcha], [id*="captcha" i], [class*="captcha" i]').count(),
  ])
  if (otp === 0 && captcha === 0) return false
  let path = ""
  try { path = new URL(page.url()).pathname } catch { /* sin ruta */ }
  logger.warn("[flota/onway] Auth0 pidió verificación interactiva", { challenge: otp > 0 ? "otp" : "captcha", path })
  return true
}

/** Rechaza con `ONWAY_PORTAL_TIMEOUT` si `work` no termina en `ms`. No cancela `work`. */
export async function withOnwayDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OnwayClientError("ONWAY_PORTAL_TIMEOUT")), ms)
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function parsePortalDeviceRefs(input: unknown): OnwayPortalDeviceRef[] {
  if (!isRecord(input) || !Array.isArray(input.devices)) return []
  const refs = new Map<string, OnwayPortalDeviceRef>()
  for (const row of input.devices) {
    if (!isRecord(row)) continue
    const deviceId = typeof row.device_id === "number" && Number.isInteger(row.device_id) && row.device_id > 0
      ? String(row.device_id)
      : null
    const unitId = typeof row.unit_id === "number" && Number.isInteger(row.unit_id) && row.unit_id > 0
      ? String(row.unit_id)
      : deviceId
    if (!deviceId || !unitId) continue
    const imei = typeof row.imei === "string" && row.imei.length > 0 && row.imei.length <= 80 ? row.imei : null
    refs.set(deviceId, { deviceId, unitId, imei })
  }
  return [...refs.values()].slice(0, MAX_TELEMETRY_DEVICES)
}

async function readSnapshotResponse(response: Response): Promise<OnwayPortalSnapshot> {
  const contentType = response.headers()["content-type"] ?? ""
  const contentLength = Number(response.headers()["content-length"] ?? 0)
  if (!response.ok() || !contentType.includes("application/json")) {
    throw new OnwayClientError("ONWAY_RESPONSE_INVALID")
  }
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new OnwayClientError("ONWAY_RESPONSE_INVALID")
  }
  try {
    const body = await response.body()
    if (body.byteLength > MAX_RESPONSE_BYTES) throw new OnwayClientError("ONWAY_RESPONSE_INVALID")
    const payload = JSON.parse(body.toString("utf8")) as unknown
    return { snapshot: parseOnwaySnapshot(payload), refs: parsePortalDeviceRefs(payload) }
  } catch (error) {
    if (error instanceof OnwayClientError) throw error
    throw new OnwayClientError("ONWAY_RESPONSE_INVALID")
  }
}

/**
 * Next empaqueta este módulo dos veces (la ruta del cron y la página de
 * Monitoreo): con estado de módulo cada copia tenía su navegador y su
 * `inFlight`, y el del cron quedó trabado sin que la sincronización manual lo
 * viera (2026-11-01 → 11-02). `globalThis` es uno por proceso.
 */
interface OnwayChallenge {
  id: string
  userId: string
  page: Page
  viewport: OnwayChallengeViewport
  createdAt: number
  expiresAt: number
  status: OnwayChallengeStatus
  /** Vence el desafío aunque la persona se olvide de la pestaña abierta. */
  timer: ReturnType<typeof setTimeout> | null
  /** Rellena credenciales si Auth0 vuelve a pintar el formulario vacío. */
  fillTimer: ReturnType<typeof setInterval> | null
  /** Conserva el estado terminal unos segundos para que la vista lo lea. */
  cleanupTimer: ReturnType<typeof setTimeout> | null
  lastFrame: { data: Buffer; at: number } | null
  frameInFlight: Promise<Buffer> | null
  navigationGuard: ((route: Route) => Promise<void>) | null
}

interface OnwayClientState {
  browserSession: OnwayBrowserSession | null
  inFlight: Promise<OnwayPortalSnapshot> | null
  challenge: OnwayChallenge | null
  /** Una apertura en curso todavía no dejó `challenge`: no se puede solapar. */
  challengeStarting: boolean
}

declare global {
  var __onwayClient: OnwayClientState | undefined
}

const state: OnwayClientState = globalThis.__onwayClient ??= {
  browserSession: null,
  inFlight: null,
  challenge: null,
  challengeStarting: false,
}
// Un proceso que ya tenía el global de una versión anterior no trae los campos nuevos.
state.challenge ??= null
state.challengeStarting ??= false

async function closeBrowserSession(): Promise<void> {
  const current = state.browserSession
  state.browserSession = null
  if (!current) return
  try {
    // Con `connect`, `browser.close()` sólo desconecta: el proceso lo cierra el servidor.
    await withOnwayDeadline(current.browser.close().then(() => current.server.close()), BROWSER_CLOSE_TIMEOUT_MS)
  } catch {
    // Un navegador colgado puede no responder ni al cierre. Sin el kill quedaba
    // vivo (con sus renderers) hasta reiniciar el contenedor.
    await withOnwayDeadline(current.server.kill(), BROWSER_CLOSE_TIMEOUT_MS).catch(() => undefined)
  }
}

function accountKey(credentials: OnwayCredentials): string {
  return createHash("sha256").update(credentials.username).update("\0").update(credentials.password).digest("hex")
}

/**
 * La página autenticada pertenece a una cuenta. Sin comparar la cuenta, guardar
 * credenciales nuevas en Monitoreo no tenía efecto: el portal seguía abierto con
 * la sesión anterior y el cron la reusaba hasta reiniciar el contenedor.
 */
async function getBrowserSession(account: string): Promise<OnwayBrowserSession> {
  const current = state.browserSession
  if (current?.account === account && current.browser.isConnected() && !current.page.isClosed()) return current
  await closeBrowserSession()

  const { chromium } = await import("playwright")
  const configuredPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim()
  const launchPath = configuredPath && existsSync(configuredPath) ? configuredPath : undefined
  // `launchServer` en vez de `launch`: sólo el servidor expone `kill()`, que
  // termina el grupo de procesos aunque el navegador no conteste.
  const server = await chromium.launchServer(resolveOnwayLaunchOptions(launchPath))
  try {
    const browser = await chromium.connect(server.wsEndpoint())
    const context = await browser.newContext({
      locale: "es-CL",
      timezoneId: "America/Santiago",
      serviceWorkers: "block",
    })
    const page = await context.newPage()
    state.browserSession = { server, browser, page, account }
    return state.browserSession
  } catch (error) {
    await withOnwayDeadline(server.kill(), BROWSER_CLOSE_TIMEOUT_MS).catch(() => undefined)
    throw error
  }
}

async function portalJson(page: Page, path: string, init: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {}): Promise<unknown> {
  try {
    return await withOnwayDeadline(page.evaluate(async ({ path, method, body, maxBytes, timeoutMs }) => {
      const response = await fetch(path, {
        method,
        signal: AbortSignal.timeout(timeoutMs),
        credentials: "same-origin",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const contentLength = Number(response.headers.get("content-length") ?? 0)
      if (!response.ok || (Number.isFinite(contentLength) && contentLength > maxBytes)) throw new Error("ONWAY_RESPONSE_INVALID")
      const text = await response.text()
      if (text.length > maxBytes) throw new Error("ONWAY_RESPONSE_INVALID")
      return JSON.parse(text) as unknown
    }, { path, method: init.method ?? "GET", body: init.body, maxBytes: MAX_RESPONSE_BYTES, timeoutMs: PORTAL_REQUEST_TIMEOUT_MS }), PORTAL_REQUEST_TIMEOUT_MS + 5_000)
  } catch {
    throw new OnwayClientError("ONWAY_RESPONSE_INVALID")
  }
}

/**
 * Sobres en que el portal envuelve una lista. `value` es el del historial
 * (`devices/quick/history`) y `routes` el de `GetDeviceLatestTrips`: sin ellos el
 * historial y los viajes se descartaban siempre (hallazgo 2026-11-19).
 */
const ARRAY_ENVELOPE_KEYS = ["data", "alerts", "items", "rows", "result", "value", "routes"] as const

export function unwrapArray(input: unknown): unknown[] {
  if (Array.isArray(input)) return input
  if (!isRecord(input)) return []
  for (const key of ARRAY_ENVELOPE_KEYS) {
    if (Array.isArray(input[key])) return input[key]
  }
  return []
}

export function hasArrayPayload(input: unknown): boolean {
  if (Array.isArray(input)) return true
  return isRecord(input) && ARRAY_ENVELOPE_KEYS.some((key) => Array.isArray(input[key]))
}

/**
 * Corre `work` por equipo, de a `concurrency` a la vez, y deja de empezar equipos
 * nuevos cuando `now()` pasa `stopStartingAt` (los que ya corren terminan). Un
 * equipo que falla no detiene a los demás: `work` registra su propio aviso.
 */
export async function runPerDeviceWithinBudget<T>(
  items: readonly T[],
  work: (item: T) => Promise<void>,
  options: { concurrency: number; stopStartingAt: number; now?: () => number },
): Promise<{ skipped: number }> {
  const now = options.now ?? Date.now
  let next = 0
  let started = 0
  const lane = async () => {
    while (next < items.length && now() <= options.stopStartingAt) {
      const item = items[next++] as T
      started++
      try { await work(item) } catch { /* el aviso lo deja `work` */ }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency, items.length)) }, lane))
  return { skipped: items.length - started }
}

async function fetchDeviceDetails(page: Page, refs: OnwayPortalDeviceRef[], wallClockOffsetHours: number | null): Promise<{ details: OnwayDeviceTelemetry[]; incomplete: boolean }> {
  const details: OnwayDeviceTelemetry[] = []
  let incomplete = false
  for (const ref of refs) {
    try {
      const payload = await portalJson(page, `${DEVICE_DETAIL_PATH}?unitId=${encodeURIComponent(ref.unitId)}`)
      const parsed = parseOnwayDeviceDetail(isRecord(payload) && isRecord(payload.data) ? payload.data : payload, { wallClockOffsetHours: wallClockOffsetHours ?? undefined })
      // Sin el desfase, la hora de reporte quedaría corrida: se omite (y la
      // lectura de medidor cae a la hora de la consulta).
      const detail = parsed && wallClockOffsetHours === null ? { ...parsed, gpsReportedAt: null, gprsReportedAt: null } : parsed
      if (detail && detail.deviceId === ref.deviceId) details.push(detail)
      else incomplete = true
    } catch {
      incomplete = true
    }
  }
  return { details, incomplete }
}

async function fetchAlerts(page: Page, refs: OnwayPortalDeviceRef[], wallClockOffsetHours: number | null): Promise<{ alerts: OnwayAlertSnapshot[]; incomplete: boolean }> {
  // Una alerta sin hora confiable no se guarda: su hora decide faena y orden.
  if (wallClockOffsetHours === null) return { alerts: [], incomplete: true }
  const imeis = refs.flatMap((ref) => ref.imei ? [ref.imei] : [])
  if (imeis.length === 0) return { alerts: [], incomplete: refs.length > 0 }
  const payload = await portalJson(page, ALERTS_PATH, {
    method: "POST",
    // `tracking.alerts.js` sends numeric mode 0 and uses zero-based paging.
    // The old scraper's "today" / page 1 combination returns HTTP 500.
    body: { imeis, searchMode: 0, page: 0, pageSize: 1_000, noCache: Date.now() },
  })
  if (!hasArrayPayload(payload)) throw new OnwayClientError("ONWAY_RESPONSE_INVALID")
  const rows = unwrapArray(payload)
  return parseOnwayAlertRows(rows, refs, { wallClockOffsetHours })
}

async function fetchHistory(page: Page, ref: OnwayPortalDeviceRef, from: string, to: string): Promise<OnwayHistoryPoint[]> {
  if (!ref.imei) return []
  const payload = await page.evaluate(async ({ imei, from, to, timeoutMs }) => {
    // El portal publica su contexto como `window.__lbs` (verificado 2026-11-19);
    // `lbs` a secas no existe y el historial fallaba en cada corrida.
    type PortalContext = { apiHistory?: { get?: (...args: unknown[]) => void }; getContext?: () => { loggedUser?: Record<string, unknown> } }
    const scope = globalThis as { __lbs?: PortalContext; lbs?: PortalContext }
    const context = scope.__lbs ?? scope.lbs
    const get = context?.apiHistory?.get
    const loggedUser = context?.getContext?.().loggedUser
    const clientId = loggedUser?.client_id
    if (!get || !loggedUser || (typeof clientId !== "string" && typeof clientId !== "number")) throw new Error("ONWAY_HISTORY_UNAVAILABLE")
    return await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("ONWAY_HISTORY_TIMEOUT")), timeoutMs)
      try {
        get("devices/quick/history", {
          clientId,
          imei,
          from,
          to,
          culture: typeof loggedUser.two_letters_culture === "string" ? loggedUser.two_letters_culture : "es",
          // Horas en UTC: `generate_time` vuelve sin zona y en este desfase. El
          // del usuario es un `-4` fijo (no sigue el horario de verano) y un
          // texto como "+00:00" el portal no lo entiende. Ver `utcInstant`.
          timeZone: "0",
          filteredAlerts: "",
        }, (response: unknown) => { clearTimeout(timeout); resolve(response) })
      } catch (error) {
        clearTimeout(timeout)
        reject(error)
      }
    })
  }, { imei: ref.imei, from, to, timeoutMs: NAVIGATION_TIMEOUT_MS })
  if (!hasArrayPayload(payload)) throw new Error("ONWAY_HISTORY_RESPONSE_INVALID")
  return parseOnwayHistory(unwrapArray(payload))
}

/**
 * Desfase horario (en horas) configurado para el usuario del portal: los viajes
 * vienen en su reloj. `null` si no se puede leer o no es un desfase válido.
 */
async function readPortalTimeZoneOffset(page: Page): Promise<number | null> {
  const raw = await page.evaluate(() => {
    type PortalContext = { getContext?: () => { loggedUser?: Record<string, unknown> } }
    const scope = globalThis as { __lbs?: PortalContext; lbs?: PortalContext }
    return (scope.__lbs ?? scope.lbs)?.getContext?.().loggedUser?.time_zone_offset ?? null
  })
  const hours = typeof raw === "number" || typeof raw === "string" ? Number(raw) : Number.NaN
  return Number.isFinite(hours) && Math.abs(hours) <= 14 ? hours : null
}

async function fetchTrips(page: Page, ref: OnwayPortalDeviceRef, wallClockOffsetHours: number | null): Promise<OnwayTripSnapshot[]> {
  if (!ref.imei) return []
  // Sin el desfase las horas de los viajes quedarían corridas: mejor no guardarlos.
  if (wallClockOffsetHours === null) throw new OnwayClientError("ONWAY_RESPONSE_INVALID")
  const payload = await portalJson(page, `/OnlineTracking/GetDeviceLatestTrips/?noCache=${Date.now()}&imei=${encodeURIComponent(ref.imei)}`)
  if (!hasArrayPayload(payload)) throw new OnwayClientError("ONWAY_RESPONSE_INVALID")
  return parseOnwayTrips(unwrapArray(payload), { wallClockOffsetHours })
}

async function scrapeWithSession(credentials: OnwayCredentials): Promise<OnwayPortalSnapshot> {
  const { page } = await getBrowserSession(accountKey(credentials))
  const responsePromise = page.waitForResponse(isSnapshotResponse, { timeout: NAVIGATION_TIMEOUT_MS })
  void responsePromise.catch(() => undefined)

  try {
    await page.goto(TRACKING_URL, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS })
    const currentPageUrl = new URL(page.url())
    const needsAuthentication = currentPageUrl.origin !== ONWAY_PORTAL_ORIGIN
      || currentPageUrl.pathname.toLocaleLowerCase("en-US").startsWith("/home/login")
      || await page.locator("#smalAuth0ActionLogin").isVisible()

    if (needsAuthentication) {
      await openAuthentication(page)
      await page.locator('input[name="username"]').fill(credentials.username)
      await page.locator('input[name="password"]').fill(credentials.password)
      await page.locator('button[type="submit"]').click()
    }

    let response: Response
    try {
      response = await responsePromise
    } catch {
      const currentUrl = page.url()
      if (isAllowedOnwayAuthUrl(currentUrl)) {
        throw new OnwayClientError(
          await hasInteractiveChallenge(page) ? "ONWAY_INTERACTIVE_AUTH_REQUIRED" : "ONWAY_AUTH_REJECTED",
        )
      }
      throw new OnwayClientError("ONWAY_PORTAL_TIMEOUT")
    }
    return await readSnapshotResponse(response)
  } catch (error) {
    await closeBrowserSession()
    if (error instanceof OnwayClientError) throw error
    throw new OnwayClientError("ONWAY_SYNC_FAILED")
  }
}

/** Hay una vista asistida abierta: el portal no se navega desde otra corrida. */
export function isOnwayInteractiveAuthPending(): boolean {
  return state.challenge?.status === "awaiting"
}

async function scrapePortal(credentials: OnwayCredentials): Promise<OnwayPortalSnapshot> {
  // Una verificación abierta es dueña de la página: navegarla desde el cron o
  // el refresco en vivo borraría el desafío que la persona está resolviendo.
  if (isOnwayInteractiveAuthPending()) throw new OnwayClientError("ONWAY_INTERACTIVE_AUTH_REQUIRED")
  if (state.inFlight) return state.inFlight
  const current = scrapeWithSession(credentials).finally(() => {
    if (state.inFlight === current) state.inFlight = null
  })
  state.inFlight = current
  return current
}

/**
 * Suelta la lectura en curso aunque no haya terminado. Si un `close()` del
 * navegador se cuelga, el `finally` de `scrapePortal` no corre nunca y todas
 * las corridas siguientes se sumaban a esa promesa muerta sin volver a abrir
 * el portal: 110 s de espera y `ONWAY_PORTAL_TIMEOUT`, una tras otra.
 */
function abandonBrowserSession(): void {
  state.inFlight = null
  // Acotado por BROWSER_CLOSE_TIMEOUT_MS; no hace falta que el llamador lo espere.
  void closeBrowserSession()
}

/* ── Verificación interactiva (CAPTCHA/OTP) ───────────────────────────────── */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

function challengeViewport(page: Page): OnwayChallengeViewport {
  const size = page.viewportSize()
  return size ? { width: size.width, height: size.height } : { width: 1280, height: 720 }
}

/**
 * Auth0 puede repintar el formulario vacío después del CAPTCHA. La plataforma
 * deja usuario y contraseña sólo si están vacíos: la persona nunca necesita
 * conocer la credencial de la cuenta de servicio y el desafío sigue siendo suyo.
 */
async function fillEmptyCredentials(page: Page, credentials: OnwayCredentials): Promise<void> {
  try {
    if (isOnwayChallengeSolvedUrl(page.url())) return
    const username = page.locator('input[name="username"]')
    if (await username.isVisible() && (await username.inputValue({ timeout: 2_000 })) === "") {
      await username.fill(credentials.username, { timeout: 5_000 })
    }
    const password = page.locator('input[name="password"]')
    if (await password.isVisible() && (await password.inputValue({ timeout: 2_000 })) === "") {
      await password.fill(credentials.password, { timeout: 5_000 })
    }
  } catch {
    // La página puede estar navegando entre Auth0 y el portal: el próximo
    // intento del rellenador la alcanza.
  }
}

/**
 * El navegador del servidor no es un proxy libre: mientras el desafío está
 * abierto, el marco principal sólo puede ir al portal o al tenant de Auth0.
 * El iframe del CAPTCHA y sus CDN cargan sin restricción o el widget no pinta.
 */
function challengeNavigationGuard(page: Page): (route: Route) => Promise<void> {
  return async (route) => {
    try {
      const request = route.request()
      if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) {
        await route.continue()
        return
      }
      if (isAllowedOnwayChallengeNavigation(request.url())) {
        await route.continue()
        return
      }
      let host = "unknown"
      try { host = new URL(request.url()).host } catch { /* se deja unknown */ }
      logger.warn("[flota/onway] verificación: navegación fuera del portal bloqueada", { host })
      await route.abort()
    } catch {
      // La página pudo cerrarse entre la petición y el manejador: abortar es
      // inocuo y evita una promesa rechazada dentro de Playwright.
      await route.abort().catch(() => undefined)
    }
  }
}

async function openChallenge(page: Page, userId: string, credentials: OnwayCredentials): Promise<OnwayChallenge> {
  const createdAt = Date.now()
  const challenge: OnwayChallenge = {
    id: `onwayauth-${nanoid(24)}`,
    userId,
    page,
    viewport: challengeViewport(page),
    createdAt,
    expiresAt: createdAt + ONWAY_CHALLENGE_TTL_MS,
    status: "awaiting",
    timer: null,
    fillTimer: null,
    cleanupTimer: null,
    lastFrame: null,
    frameInFlight: null,
    navigationGuard: null,
  }
  const guard = challengeNavigationGuard(page)
  challenge.navigationGuard = guard
  // Un guard de una vista anterior que no alcanzó a soltarse haría fallar cada
  // `continue()` de esta. La página no tiene otros handlers propios.
  await page.unroute("**/*").catch(() => undefined)
  await page.route("**/*", guard).catch(() => { /* la página puede estar cerrándose */ })
  challenge.fillTimer = setInterval(() => { void fillEmptyCredentials(page, credentials) }, 2_000)
  challenge.timer = setTimeout(() => { void expireChallenge(challenge) }, ONWAY_CHALLENGE_TTL_MS)
  state.challenge = challenge
  logger.warn("[flota/onway] verificación interactiva abierta", { challengeId: challenge.id })
  return challenge
}

function publicChallenge(challenge: OnwayChallenge): OnwayChallengePublic {
  return { id: challenge.id, status: "awaiting", expiresAt: challenge.expiresAt, viewport: challenge.viewport }
}

function challengeStatusView(challenge: OnwayChallenge): OnwayChallengeStatusView {
  return {
    id: challenge.id,
    status: challenge.status,
    expiresAt: challenge.expiresAt,
    viewport: challenge.viewport,
    remainingMs: onwayChallengeRemainingMs(challenge.expiresAt, challenge.status),
  }
}

async function unrouteChallenge(challenge: OnwayChallenge): Promise<void> {
  const guard = challenge.navigationGuard
  challenge.navigationGuard = null
  if (!guard) return
  try { await challenge.page.unroute("**/*", guard) } catch { /* página cerrada */ }
}

function clearChallengeTimers(challenge: OnwayChallenge): void {
  if (challenge.timer) { clearTimeout(challenge.timer); challenge.timer = null }
  if (challenge.fillTimer) { clearInterval(challenge.fillTimer); challenge.fillTimer = null }
}

/** La vista necesita leer el desenlace aunque el objeto deje de estar activo. */
function scheduleChallengeCleanup(challenge: OnwayChallenge): void {
  if (challenge.cleanupTimer) clearTimeout(challenge.cleanupTimer)
  challenge.cleanupTimer = setTimeout(() => {
    if (state.challenge === challenge) state.challenge = null
  }, 60_000)
}

async function markChallengeSolved(challenge: OnwayChallenge): Promise<void> {
  if (challenge.status !== "awaiting") return
  challenge.status = "solved"
  clearChallengeTimers(challenge)
  await unrouteChallenge(challenge)
  scheduleChallengeCleanup(challenge)
  // La sesión autenticada se conserva: la sincronización que sigue reutiliza
  // este mismo navegador en vez de volver a pedir credenciales.
  logger.info("[flota/onway] verificación interactiva completada", { challengeId: challenge.id })
}

async function endChallenge(
  challenge: OnwayChallenge,
  status: Exclude<OnwayChallengeStatus, "awaiting" | "solved">,
): Promise<void> {
  if (challenge.status !== "awaiting") return
  challenge.status = status
  clearChallengeTimers(challenge)
  await unrouteChallenge(challenge)
  // Cancelado o vencido no deja sesión válida: el próximo intento necesita una
  // transacción Auth0 limpia. No se espera el cierre (acotado a 10 s) para que
  // la vista responda de inmediato.
  void closeBrowserSession()
  scheduleChallengeCleanup(challenge)
}

async function expireChallenge(challenge: OnwayChallenge): Promise<void> {
  if (state.challenge !== challenge || challenge.status !== "awaiting" || Date.now() < challenge.expiresAt) return
  logger.warn("[flota/onway] verificación interactiva expirada", { challengeId: challenge.id })
  await endChallenge(challenge, "expired")
}

function findChallenge(id: string, userId: string): OnwayChallenge {
  const challenge = state.challenge
  if (!challenge || challenge.id !== id) throw new OnwayChallengeError("ONWAY_CHALLENGE_NOT_FOUND")
  if (challenge.userId !== userId) throw new OnwayChallengeError("ONWAY_CHALLENGE_FORBIDDEN")
  return challenge
}

async function refreshChallengeStatus(challenge: OnwayChallenge): Promise<void> {
  if (challenge.status !== "awaiting") return
  if (challenge.page.isClosed()) {
    await endChallenge(challenge, "failed")
    return
  }
  if (isOnwayChallengeSolvedUrl(challenge.page.url())) {
    await markChallengeSolved(challenge)
    return
  }
  if (Date.now() >= challenge.expiresAt) await endChallenge(challenge, "expired")
}

async function requireAwaitingChallenge(id: string, userId: string): Promise<OnwayChallenge> {
  const challenge = findChallenge(id, userId)
  await refreshChallengeStatus(challenge)
  if (challenge.status === "solved") throw new OnwayChallengeError("ONWAY_CHALLENGE_SOLVED")
  if (challenge.status === "expired") throw new OnwayChallengeError("ONWAY_CHALLENGE_EXPIRED")
  if (challenge.status !== "awaiting") throw new OnwayChallengeError("ONWAY_CHALLENGE_CLOSED")
  return challenge
}

async function waitForChallengeOrPortal(page: Page, timeoutMs: number): Promise<"authenticated" | "challenge"> {
  // El badge invisible de reCAPTCHA existe desde que carga Auth0. Se concede un
  // instante a la redirección para no abrir la vista en un login que ya pasó.
  await delay(750)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (isOnwayChallengeSolvedUrl(page.url())) return "authenticated"
    if (await hasInteractiveChallenge(page)) return "challenge"
    // Sin formulario y sin mapa, Auth0 está mostrando otra pantalla (OTP,
    // captcha o error). Se entrega a la persona en vez de seguir esperando.
    if (!await page.locator('input[name="username"]').isVisible().catch(() => false)) return "challenge"
    await delay(500)
  }
  return isOnwayChallengeSolvedUrl(page.url()) ? "authenticated" : "challenge"
}

/**
 * Abre el portal y entrega el navegador a una persona cuando Auth0 pide
 * CAPTCHA u OTP. Devuelve `authenticated` si la sesión ya era válida o si el
 * inicio de sesión normal pasó sin desafío.
 */
async function startOnwayInteractiveAuthenticationUnlocked(
  input: OnwayCredentials,
  actorUserId: string,
): Promise<OnwayInteractiveAuthStart> {
  const credentials = validateOnwayCredentials(input)
  if (state.inFlight) throw new OnwayChallengeError("ONWAY_CHALLENGE_BUSY")

  const existing = state.challenge
  if (existing) {
    if (existing.status === "awaiting" && existing.expiresAt > Date.now()) {
      if (existing.userId === actorUserId) return { status: "awaiting", challenge: publicChallenge(existing) }
      throw new OnwayChallengeError("ONWAY_CHALLENGE_ACTIVE")
    }
    if (existing.status === "awaiting") await endChallenge(existing, "expired")
    else state.challenge = null
    if (existing.cleanupTimer) { clearTimeout(existing.cleanupTimer); existing.cleanupTimer = null }
  }

  const { page } = await getBrowserSession(accountKey(credentials))
  try {
    await page.goto(TRACKING_URL, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS })
    const needsAuthentication = !isOnwayChallengeSolvedUrl(page.url())
      || await page.locator("#smalAuth0ActionLogin").isVisible()
    if (!needsAuthentication) return { status: "authenticated" }

    let formReady = true
    try {
      // En el flujo asistido no se esperan los 45 s del scraper: si el
      // formulario no aparece, la persona puede ver el desafío antes.
      await openAuthentication(page, 15_000)
    } catch (error) {
      // El CAPTCHA puede aparecer antes que el formulario, y hay widgets que
      // nuestra detección no reconoce. Si ya estamos en el tenant exacto, se
      // entrega la vista: el rellenador deja las credenciales en cuanto Auth0
      // pinte el formulario.
      const delayed = error instanceof OnwayClientError
        && (error.code === "ONWAY_INTERACTIVE_AUTH_REQUIRED" || error.code === "ONWAY_PORTAL_TIMEOUT")
      if (delayed && isAllowedOnwayAuthUrl(page.url())) formReady = false
      else throw error
    }

    if (formReady) {
      await fillEmptyCredentials(page, credentials)
      await page.locator('button[type="submit"]').click({ timeout: 10_000 }).catch(() => undefined)
    }
    const outcome = formReady ? await waitForChallengeOrPortal(page, 20_000) : "challenge"
    if (outcome === "authenticated") return { status: "authenticated" }

    // Si el formulario sigue visible y no hay ningún desafío, Auth0 rechazó la
    // credencial: abrir una vista viva sólo mostraría el mismo error sin salida.
    const formStillVisible = await page.locator('input[name="username"]').isVisible().catch(() => false)
    if (formStillVisible && !await hasInteractiveChallenge(page)) {
      throw new OnwayClientError("ONWAY_AUTH_REJECTED")
    }
    // La redirección puede haber ganado entre la última comprobación y ahora.
    if (isOnwayChallengeSolvedUrl(page.url())) return { status: "authenticated" }
    return { status: "awaiting", challenge: publicChallenge(await openChallenge(page, actorUserId, credentials)) }
  } catch (error) {
    if (!state.challenge) await closeBrowserSession()
    if (error instanceof OnwayClientError || error instanceof OnwayChallengeError) throw error
    throw new OnwayClientError("ONWAY_SYNC_FAILED")
  }
}

/**
 * Dos aperturas simultáneas compartirían la misma página: la segunda navegaría
 * mientras la primera espera el desafío y una de las dos vistas quedaría
 * huérfana. La puerta es de proceso, igual que el navegador que protege.
 */
export async function startOnwayInteractiveAuthentication(
  input: OnwayCredentials,
  actorUserId: string,
): Promise<OnwayInteractiveAuthStart> {
  if (state.challengeStarting) throw new OnwayChallengeError("ONWAY_CHALLENGE_ACTIVE")
  state.challengeStarting = true
  try {
    return await startOnwayInteractiveAuthenticationUnlocked(input, actorUserId)
  } finally {
    state.challengeStarting = false
  }
}

export async function getOnwayChallengeStatus(id: string, userId: string): Promise<OnwayChallengeStatusView> {
  const challenge = findChallenge(id, userId)
  await refreshChallengeStatus(challenge)
  return challengeStatusView(challenge)
}

/**
 * Captura JPEG del viewport real. Se sirve como blob al navegador y nunca se
 * persiste ni se registra: es la pantalla del portal, no evidencia.
 */
export async function readOnwayChallengeFrame(id: string, userId: string): Promise<Buffer> {
  const challenge = await requireAwaitingChallenge(id, userId)
  if (challenge.lastFrame && Date.now() - challenge.lastFrame.at < 250) return challenge.lastFrame.data
  if (!challenge.frameInFlight) {
    challenge.frameInFlight = challenge.page.screenshot({ type: "jpeg", quality: 65, timeout: 10_000 })
      .then(async (data) => {
        // El mapa puede haber ganado la carrera contra la captura: ese frame ya
        // no pertenece al desafío y no se muestra.
        if (isOnwayChallengeSolvedUrl(challenge.page.url())) {
          await markChallengeSolved(challenge)
          throw new OnwayChallengeError("ONWAY_CHALLENGE_SOLVED")
        }
        challenge.lastFrame = { data, at: Date.now() }
        return data
      })
      .catch((error: unknown) => {
        if (error instanceof OnwayChallengeError) throw error
        if (challenge.lastFrame) return challenge.lastFrame.data
        throw new OnwayChallengeError("ONWAY_CHALLENGE_FRAME_UNAVAILABLE")
      })
      .finally(() => { challenge.frameInFlight = null })
  }
  return challenge.frameInFlight
}

export async function sendOnwayChallengeInput(id: string, userId: string, payload: unknown): Promise<void> {
  const challenge = await requireAwaitingChallenge(id, userId)
  const input = parseOnwayChallengeInput(payload, challenge.viewport)
  if (!input) throw new OnwayChallengeError("ONWAY_CHALLENGE_INPUT_INVALID")
  try {
    switch (input.kind) {
      case "move":
        await challenge.page.mouse.move(input.x, input.y)
        break
      case "down":
        await challenge.page.mouse.move(input.x, input.y)
        await challenge.page.mouse.down()
        break
      case "up":
        await challenge.page.mouse.move(input.x, input.y)
        await challenge.page.mouse.up()
        break
      case "text":
        await challenge.page.keyboard.type(input.text)
        break
      case "key":
        await challenge.page.keyboard.press(input.key)
        break
    }
  } catch {
    throw new OnwayChallengeError("ONWAY_CHALLENGE_CLOSED")
  }
  await refreshChallengeStatus(challenge)
}

export async function cancelOnwayChallenge(id: string, userId: string): Promise<OnwayChallengeStatusView> {
  const challenge = findChallenge(id, userId)
  if (challenge.status === "awaiting") await endChallenge(challenge, "cancelled")
  return challengeStatusView(challenge)
}

/** One in-memory Auth0 session per process; concurrent callers share the same scrape. */
export async function fetchOnwaySnapshot(input: OnwayCredentials): Promise<OnwaySnapshotResult> {
  const credentials = validateOnwayCredentials(input)
  return (await scrapePortal(credentials)).snapshot
}

/**
 * Reutiliza la sesión autenticada del scraper. IMEI y contexto de la página se
 * usan sólo durante esta función; lo que retorna ya pasó por contratos allowlist.
 */
export async function fetchOnwayTelemetry(input: OnwayCredentials, options: OnwayTelemetryOptions = {}): Promise<OnwayTelemetryBundle> {
  const deadlineMs = options.deadlineMs ?? ONWAY_TELEMETRY_DEADLINE_MS
  try {
    return await withOnwayDeadline(collectTelemetry(input, options, Date.now() + deadlineMs), deadlineMs)
  } catch (error) {
    // No basta con cerrar el navegador para liberar `inFlight`: si el cierre
    // también se cuelga, la próxima corrida reusaría la misma promesa colgada.
    if (error instanceof OnwayClientError && error.code === "ONWAY_PORTAL_TIMEOUT") abandonBrowserSession()
    throw error
  }
}

interface OnwayTelemetryOptions {
  /**
   * `false` lee sólo el snapshot del mapa (posición, velocidad, rumbo,
   * encendido): una consulta al portal. El detalle es una consulta por equipo
   * (~50) más la de alertas, y queda para el cron cada 5 minutos.
   */
  includeDetails?: boolean
  includeHistory?: boolean
  historyFrom?: string
  historyTo?: string
  /** Para pruebas; por defecto `ONWAY_TELEMETRY_DEADLINE_MS`. */
  deadlineMs?: number
}

async function collectTelemetry(input: OnwayCredentials, options: OnwayTelemetryOptions, deadlineAt: number): Promise<OnwayTelemetryBundle> {
  const credentials = validateOnwayCredentials(input)
  const portal = await scrapePortal(credentials)
  if (options.includeDetails === false) {
    return { snapshot: portal.snapshot, details: [], alerts: [], historyByDeviceId: new Map(), tripsByDeviceId: new Map(), warnings: [] }
  }
  const { page } = await getBrowserSession(accountKey(credentials))
  const warnings: OnwayTelemetryBundle["warnings"] = []
  const wallClockOffsetHours = await readPortalTimeZoneOffset(page).catch(() => null)
  if (wallClockOffsetHours === null) warnings.push("details")
  let details: OnwayDeviceTelemetry[] = []
  let alerts: OnwayAlertSnapshot[] = []
  try {
    const detailResult = await fetchDeviceDetails(page, portal.refs, wallClockOffsetHours)
    details = detailResult.details
    if (detailResult.incomplete) warnings.push("details")
  }
  catch { warnings.push("details") }
  try {
    const alertResult = await fetchAlerts(page, portal.refs, wallClockOffsetHours)
    alerts = alertResult.alerts
    if (alertResult.incomplete) warnings.push("alerts")
  }
  catch { warnings.push("alerts") }
  const historyByDeviceId = new Map<string, OnwayHistoryPoint[]>()
  const tripsByDeviceId = new Map<string, OnwayTripSnapshot[]>()
  if (options.includeHistory && options.historyFrom && options.historyTo) {
    const { historyFrom, historyTo } = options
    // En serie, 2 h de historial de ~50 equipos tardan ~72 s y la corrida
    // completa pasaba el plazo (110 s): de a varios y sin empezar equipos nuevos
    // cerca del final. Lo que quede afuera lo recoge la ventana siguiente, que se
    // solapa con esta.
    const { skipped } = await runPerDeviceWithinBudget(portal.refs, async (ref) => {
      try { historyByDeviceId.set(ref.deviceId, await fetchHistory(page, ref, historyFrom, historyTo)) }
      catch { warnings.push("history") }
      try { tripsByDeviceId.set(ref.deviceId, await fetchTrips(page, ref, wallClockOffsetHours)) }
      catch { warnings.push("trips") }
    }, { concurrency: HISTORY_CONCURRENCY, stopStartingAt: deadlineAt - HISTORY_RESERVE_MS })
    if (skipped > 0) warnings.push("history", "trips")
  }
  return { snapshot: portal.snapshot, details, alerts, historyByDeviceId, tripsByDeviceId, warnings: [...new Set(warnings)] }
}
