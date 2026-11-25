import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import type { Browser, BrowserContext, BrowserServer, Page, Response, Route } from "playwright"
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
import { isOnwayCaptchaBlockActive } from "./onway-auth-cooldown"
import { readLatestOnwayRunAttempt } from "./onway-run-attempts"
import { killProcessGroupsAndWait, listChromiumProcesses, processGroups } from "./browser-reaper"
import { restoreOnwayProfile, saveOnwayProfile } from "./onway-profile"
import { onwayCaptchaSolverEnabled, solveOnwayCaptcha } from "./onway-captcha-solver"
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
 * Una lectura de sólo posiciones no puede retener el navegador los 45 s del
 * scraper completo: si Auth0 pide un desafío, la persona que quiere resolverlo
 * queda detrás de esa lectura. El cron conserva los topes largos.
 */
const LIVE_SCRAPE_TIMEOUTS: OnwayScrapeTimeouts = {
  navigationTimeoutMs: 15_000,
  authTimeoutMs: 10_000,
  responseTimeoutMs: 15_000,
}

interface OnwayScrapeTimeouts {
  navigationTimeoutMs?: number
  authTimeoutMs?: number
  responseTimeoutMs?: number
}
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

/**
 * Viewport fijo y coherente con la pantalla emulada. El referente usa una
 * ventana real (`viewport: null`); en el contenedor no hay display, así que se
 * declara un tamaño explícito en vez de quedar con el 1280×720 por defecto sin
 * `outerWidth`/`outerHeight` coherentes, que es una señal de automatización.
 */
const ONWAY_VIEWPORT = { width: 1_440, height: 900 }

/**
 * Parche de realismo del navegador, portado del referente
 * (`src/prt/widget.ts`): reCAPTCHA lee `navigator.webdriver`, `permissions.query`
 * y `window.chrome`. Sin esto el desafío escala a imágenes casi siempre.
 */
const ONWAY_REALISM_SCRIPT = `(function(){try{
Object.defineProperty(navigator,'webdriver',{get:function(){return undefined;}});
var pq=navigator.permissions&&navigator.permissions.query;
if(pq)navigator.permissions.query=function(p){return(p&&p.name==='notifications')?Promise.resolve({state:(window.Notification&&Notification.permission)||'prompt',onchange:null}):pq.call(navigator.permissions,p);};
if(!window.chrome)window.chrome={runtime:{},app:{isInstalled:false},csi:function(){},loadTimes:function(){}};
if(!window.outerWidth)Object.defineProperty(window,'outerWidth',{get:function(){return window.innerWidth||1440;}});
if(!window.outerHeight)Object.defineProperty(window,'outerHeight',{get:function(){return (window.innerHeight||900)+85;}});
}catch(e){}})();`

async function applyOnwayStealth(context: BrowserContext): Promise<void> {
  // Sin parche se sigue: puede funcionar igual, y un fallo aquí no debe impedir
  // la lectura del portal.
  try { await context.addInitScript(ONWAY_REALISM_SCRIPT) } catch { /* contexto mínimo */ }
}

interface OnwayBrowserSession {
  server: BrowserServer
  browser: Browser
  page: Page
  /** El contexto es dueño de las cookies de Auth0; sobrevive al reemplazo de página. */
  context: BrowserContext
  /** Huella (sólo en memoria) de la cuenta con la que se autenticó la página. */
  account: string
  /**
   * Grupos de proceso de los Chromium que este lanzamiento creó. Se registran
   * al abrir porque ni `launchServer` ni `launchPersistentContext` exponen el
   * `pid` del driver, y sin el dato el cierre sólo puede adivinar cuáles matar.
   * Ver `browser-reaper.ts`.
   */
  groups: number[]
  /**
   * Grupos que ya existían antes de lanzar. En el cierre se vuelve a censar y se
   * matan los grupos nuevos que no estén en `groups`: Chromium crea algunos
   * (los `chrome_crashpad` van en su propio grupo) después de `newPage`, así que
   * un censo único al abrir se quedaba corto y esos procesos sobrevivían.
   */
  groupsBefore: number[]
  /**
   * El portal confirmó una sesión válida (se llegó a la app de seguimiento o se
   * leyó un snapshot). Es lo que decide si un fallo de lectura debe CONSERVAR el
   * navegador —para no perder las cookies que una persona consiguió con el
   * CAPTCHA— o descartarlo, como exige la regresión del lock colgado.
   */
  authenticated: boolean
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
  /** El solver no está instalado o el operador no lo habilitó. */
  | "ONWAY_CAPTCHA_UNAVAILABLE"
  /** El desafío no es un tablero de imágenes de reCAPTCHA (OTP, hCaptcha, audio). */
  | "ONWAY_CAPTCHA_NOT_RECOGNIZED"
  /** El portal rechazó la resolución automática. */
  | "ONWAY_CAPTCHA_REJECTED"
  /**
   * Google cortó la consulta por automatización. No hay captcha que resolver y
   * cada reintento alarga la sanción: `onway-auth-cooldown.ts` abre una
   * cuarentena con este código.
   */
  | "ONWAY_CAPTCHA_BLOCKED"

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

async function openAuthentication(page: Page, timeoutMs: number = NAVIGATION_TIMEOUT_MS): Promise<void> {
  const signIn = page.locator("#smalAuth0ActionLogin")
  if (new URL(page.url()).origin === ONWAY_PORTAL_ORIGIN) {
    try {
      await signIn.waitFor({ state: "visible", timeout: timeoutMs })
      await signIn.click()
    } catch {
      throw new OnwayClientError("ONWAY_PORTAL_TIMEOUT")
    }
  }
  try {
    await page.waitForURL((url) => isAllowedOnwayAuthUrl(url.href), { timeout: timeoutMs })
  } catch {
    throw new OnwayClientError("ONWAY_AUTH_REJECTED")
  }
  try {
    await page.locator('input[name="username"]').waitFor({ state: "visible", timeout: timeoutMs })
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
  /** Rondas de login que la plataforma ya reenvió en esta vista. */
  loginRounds: number
  /** Última vez que se pulsó entrar/enviar: evita ráfagas contra Auth0. */
  lastLoginActionAt: number
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

/**
 * Cierra el navegador del scraper y se asegura de que **no quede ningún
 * Chromium vivo**.
 *
 * Cerrar el driver de Playwright no mata a Chromium: queda reparentado a PID 1 y
 * sigue girando. Medido en producción el 2026-11-24, cada `ONWAY_PORTAL_TIMEOUT`
 * dejaba así un renderer al 100 % de CPU para siempre (se encontraron árboles de
 * 4 h y 18 h, ocho renderers al 100 %, load average 12 sobre 12 núcleos).
 *
 * Los grupos de proceso se registran al lanzar el navegador (`getBrowserSession`),
 * no al cerrarlo: cuando el driver muere, el parentesco se pierde y ya no hay
 * forma de saber cuáles eran suyos. Matar el grupo entero es lo que sí termina
 * al proceso y a sus hijos de una vez.
 */
async function closeBrowserSession(): Promise<void> {
  const current = state.browserSession
  state.browserSession = null
  if (!current) return

  try {
    // Con `connect`, `browser.close()` sólo desconecta: el proceso lo cierra el servidor.
    await withOnwayDeadline(current.browser.close().then(() => current.server.close()), BROWSER_CLOSE_TIMEOUT_MS)
  } catch {
    // Un navegador colgado puede no responder ni al cierre.
    await withOnwayDeadline(current.server.kill(), BROWSER_CLOSE_TIMEOUT_MS).catch(() => undefined)
  }

  // Pase lo que pase arriba, los grupos de ESTE lanzamiento se terminan: el
  // cierre de Playwright mata al driver y deja a Chromium huérfano girando.
  // Se censa de nuevo en vez de confiar sólo en lo registrado al abrir, porque
  // Chromium arranca los `chrome_crashpad` en su propio grupo más tarde: con la
  // foto del lanzamiento esos quedaban vivos (medido: sobrevivían 2 por sesión).
  const before = new Set(current.groupsBefore)
  const groups = [...new Set([...current.groups, ...processGroups(listChromiumProcesses())])]
    .filter((group) => !before.has(group))
  if (groups.length === 0) return

  const outcome = await killProcessGroupsAndWait(groups, { graceMs: 3_000 })
  if (outcome.survived.length > 0) {
    logger.error("[flota/onway] quedaron procesos de Chromium vivos tras el cierre", {
      groups,
      survived: outcome.survived,
    })
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
  // Censo previo: lo que ya existía no es de este lanzamiento y no se toca al
  // cerrarlo (podría ser la vista asistida de otra persona).
  const groupsBefore = new Set(processGroups(listChromiumProcesses()))
  // `launchServer` en vez de `launch`: sólo el servidor expone `kill()`, que
  // termina el grupo de procesos aunque el navegador no conteste.
  const server = await chromium.launchServer(resolveOnwayLaunchOptions(launchPath))
  try {
    const browser = await chromium.connect(server.wsEndpoint())
    const context = await browser.newContext({
      locale: "es-CL",
      timezoneId: "America/Santiago",
      serviceWorkers: "block",
      viewport: ONWAY_VIEWPORT,
    })
    await applyOnwayStealth(context)
    // Restaurar la sesión anterior es lo que hace que Auth0 deje de pedir el
    // desafío: la reputación del navegador viaja en la cookie `_GRECAPTCHA`.
    await restoreOnwayProfile(context, account)
    const page = await context.newPage()
    // Los grupos que aparecieron son los de este navegador. Se capturan ahora,
    // que los procesos siguen vivos y con su `pgid` intacto: después del cierre
    // del driver quedan huérfanos y ya no se distingue a quién pertenecían.
    const groups = processGroups(listChromiumProcesses()).filter((group) => !groupsBefore.has(group))
    state.browserSession = {
      server, browser, page, context, account, groups, groupsBefore: [...groupsBefore], authenticated: false,
    }
    return state.browserSession
  } catch (error) {
    await withOnwayDeadline(server.kill(), BROWSER_CLOSE_TIMEOUT_MS).catch(() => undefined)
    // El mismo hueco que en `closeBrowserSession`: matar el driver no mata a
    // Chromium. Si falla `connect` o `newPage`, este camino es el único cierre
    // que corre y sin esto el navegador queda huérfano girando.
    const leaked = processGroups(listChromiumProcesses()).filter((group) => !groupsBefore.has(group))
    if (leaked.length > 0) await killProcessGroupsAndWait(leaked, { graceMs: 3_000 })
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

async function scrapeWithSession(
  credentials: OnwayCredentials,
  timeouts: OnwayScrapeTimeouts = {},
): Promise<OnwayPortalSnapshot> {
  const { page } = await getBrowserSession(accountKey(credentials))
  const responseTimeoutMs = timeouts.responseTimeoutMs ?? NAVIGATION_TIMEOUT_MS
  const responsePromise = page.waitForResponse(isSnapshotResponse, { timeout: responseTimeoutMs })
  void responsePromise.catch(() => undefined)

  try {
    await page.goto(TRACKING_URL, {
      waitUntil: "domcontentloaded",
      timeout: timeouts.navigationTimeoutMs ?? NAVIGATION_TIMEOUT_MS,
    })
    const currentPageUrl = new URL(page.url())
    // El portal sin sesión aterriza en la portada pública (`/Home/Index/en`),
    // no en `/home/login` como se creía. Si sólo se miraba esa ruta, la corrida
    // seguía sin autenticarse y se quedaba esperando un snapshot que nunca llega
    // hasta expirar en `ONWAY_PORTAL_TIMEOUT`.
    const needsAuthentication = currentPageUrl.origin !== ONWAY_PORTAL_ORIGIN
      || !isOnwayChallengeSolvedUrl(currentPageUrl.href)
      || await page.locator("#smalAuth0ActionLogin").isVisible()

    if (needsAuthentication) {
      await openAuthentication(page, timeouts.authTimeoutMs ?? NAVIGATION_TIMEOUT_MS)
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
        if (!await hasInteractiveChallenge(page)) throw new OnwayClientError("ONWAY_AUTH_REJECTED")

        // Última oportunidad antes de entregar el desafío a una persona: el
        // solver trabaja sobre ESTA página, no abre navegador propio.
        const solved = await attemptAutomaticCaptcha(page, timeouts)
        if (!solved.ok) {
          // El bloqueo se propaga con su código: es el único fallo que necesita
          // cuarentena en vez del flujo humano (`onway-auth-cooldown.ts`).
          throw new OnwayClientError(
            solved.failure === "ONWAY_CAPTCHA_BLOCKED" ? "ONWAY_CAPTCHA_BLOCKED" : "ONWAY_INTERACTIVE_AUTH_REQUIRED",
          )
        }

        // El token quedó en el widget; hay que reenviar el formulario para que
        // Auth0 canjee la sesión. Si no aparece el snapshot, el intento falló.
        try {
          await page.locator('button[type="submit"]').click({ timeout: 10_000 })
        } catch {
          throw new OnwayClientError("ONWAY_INTERACTIVE_AUTH_REQUIRED")
        }
        try {
          response = await page.waitForResponse(isSnapshotResponse, { timeout: responseTimeoutMs })
        } catch {
          throw new OnwayClientError("ONWAY_INTERACTIVE_AUTH_REQUIRED")
        }
      } else {
        throw new OnwayClientError("ONWAY_PORTAL_TIMEOUT")
      }
    }
    const snapshot = await readSnapshotResponse(response)
    // El portal devolvió el snapshot: la sesión es válida y hay que protegerla
    // de un cierre por un fallo posterior (ver `shouldKeepBrowserAfterFailure`).
    if (state.browserSession) state.browserSession.authenticated = true
    // Persistir la sesión sólo ahora, con el portal ya confirmando: guardar un
    // contexto a medio autenticar dejaría cookies inútiles y una falsa
    // sensación de perfil sano. Best-effort: no retrasa ni tumba la lectura.
    const session = state.browserSession
    if (session) void saveOnwayProfile(session.context, session.account)
    return snapshot
  } catch (error) {
    // Un fallo de la LECTURA no invalida la SESIÓN. Cerrar el navegador acá
    // borraba las cookies de Auth0 que la persona acababa de conseguir con el
    // CAPTCHA, y el intento siguiente volvía a pedirlo: por eso resolver el
    // desafío no servía de nada y el ciclo no terminaba nunca (2026-11-24).
    if (!shouldKeepBrowserAfterFailure()) await closeBrowserSession()
    else await replaceHungPage()
    if (error instanceof OnwayClientError) throw error
    throw new OnwayClientError("ONWAY_SYNC_FAILED")
  }
}

/**
 * Intenta resolver automáticamente el CAPTCHA de Auth0.
 *
 * Nunca abre un navegador propio ni toca el estado del desafío humano: si una
 * persona ya tiene la vista abierta, se aparta. Devuelve el resultado del
 * intento; sólo `ok` significa que el widget entregó un token, y aun así quien
 * llama debe confirmar la sesión reenviando el formulario y esperando el
 * snapshot. `failure` sólo sirve para distinguir el bloqueo de Google, que
 * necesita cuarentena, del resto, que se degrada al flujo humano.
 */
async function attemptAutomaticCaptcha(
  page: Page,
  timeouts: OnwayScrapeTimeouts,
): Promise<{ ok: boolean; failure: string | null }> {
  if (!onwayCaptchaSolverEnabled()) return { ok: false, failure: null }
  // Una vista asistida en curso tiene prioridad: no se compite por el navegador
  // que esa persona está usando para resolver el desafío a mano.
  if (isOnwayInteractiveAuthPending()) return { ok: false, failure: null }
  // Tras el aviso de Google por consultas automatizadas no hay captcha que
  // resolver: insistir alarga la sanción. Ver `onway-auth-cooldown.ts`.
  if (await isOnwayCaptchaBlockCooldownActive()) {
    logger.warn("[flota/onway] bloqueo de Google vigente; no se intenta el captcha")
    return { ok: false, failure: "ONWAY_CAPTCHA_BLOCKED" }
  }

  const context = state.browserSession?.context
  if (!context) return { ok: false, failure: null }

  try {
    const result = await solveOnwayCaptcha(page, context, {
      deadlineMs: Math.max(30_000, timeouts.responseTimeoutMs ?? NAVIGATION_TIMEOUT_MS),
    })
    logger.warn("[flota/onway] resolución automática de la verificación", {
      ok: result.ok,
      outcome: result.outcome,
      failure: result.failure,
      tiles: result.tilesSelected,
    })
    return { ok: result.ok, failure: result.failure }
  } catch {
    // Un fallo del solver no puede tumbar la lectura: se degrada al flujo
    // humano, que es el comportamiento anterior.
    return { ok: false, failure: null }
  }
}

/**
 * Lee la última corrida de OnWay y decide si hay un bloqueo de Google vigente.
 *
 * Best-effort: si la base no responde, se intenta igual. El bloqueo protege
 * contra insistir sobre una sanción, no es una regla de corrección.
 */
async function isOnwayCaptchaBlockCooldownActive(): Promise<boolean> {
  try {
    const latest = await readLatestOnwayRunAttempt()
    return isOnwayCaptchaBlockActive(latest)
  } catch {
    return false
  }
}

/**
 * ¿Vale la pena conservar el navegador tras un fallo de lectura?
 *
 * Concilia dos regresiones que se contradicen:
 *
 * - 2026-10-29: una lectura que nunca contesta no puede dejar el navegador
 *   colgado con el lock tomado; hay que cerrarlo para que la corrida siguiente
 *   abra uno nuevo (`onway-client-deadline.test.ts`).
 * - 2026-11-24: cerrarlo después de que una persona resolvió el CAPTCHA borra
 *   las cookies de Auth0 y el portal vuelve a pedir el desafío, para siempre.
 *   Ése era el «me tiene una y otra vez».
 *
 * La distinción es si el portal YA aceptó la sesión. Con sesión confirmada se
 * conserva (se pierde el plazo, no la cookie que costó un CAPTCHA); sin ella no
 * hay nada que salvar y se descarta.
 *
 * Un navegador cerrado o desconectado no se conserva nunca: no sirve para el
 * reintento y ocuparía memoria.
 */
function shouldKeepBrowserAfterFailure(): boolean {
  const current = state.browserSession
  if (!current) return false
  if (!current.browser.isConnected() || current.page.isClosed()) return false
  return current.authenticated
}

/**
 * Reemplaza la página colgada conservando el contexto —y con él las cookies de
 * Auth0— para que la corrida siguiente no vuelva a pedir el CAPTCHA.
 *
 * Es la pieza que faltaba para satisfacer las dos regresiones a la vez: una
 * lectura que no contesta no puede dejar el navegador inservible (2026-10-29),
 * pero cerrarlo entero pierde la sesión que costó un CAPTCHA (2026-11-24).
 * Cambiar sólo la página resuelve ambas: la siguiente corrida navega con la
 * misma sesión y sin el `evaluate` colgado.
 *
 * Si no se puede reemplazar, se descarta todo: más vale un CAPTCHA nuevo que un
 * navegador inutilizable.
 */
async function replaceHungPage(): Promise<boolean> {
  const current = state.browserSession
  if (!current) return false
  try {
    const page = await current.context.newPage()
    // Las cookies viven en el contexto: la página nueva ya está autenticada.
    const previous = current.page
    current.page = page
    if (!previous.isClosed()) await previous.close({ runBeforeUnload: false }).catch(() => undefined)
    return true
  } catch {
    await closeBrowserSession()
    return false
  }
}

/**
 * Hay una verificación en curso: una vista abierta o una apertura que todavía
 * no terminó de crear el desafío. El portal no se navega desde otra corrida.
 */
export function isOnwayInteractiveAuthPending(): boolean {
  return state.challengeStarting || state.challenge?.status === "awaiting"
}

async function scrapePortal(
  credentials: OnwayCredentials,
  timeouts: OnwayScrapeTimeouts = {},
): Promise<OnwayPortalSnapshot> {
  // Una verificación abierta es dueña de la página: navegarla desde el cron o
  // el refresco en vivo borraría el desafío que la persona está resolviendo.
  if (isOnwayInteractiveAuthPending()) throw new OnwayClientError("ONWAY_INTERACTIVE_AUTH_REQUIRED")
  if (state.inFlight) return state.inFlight
  const current = scrapeWithSession(credentials, timeouts).finally(() => {
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
 *
 * También reenvía el login cuando el CAPTCHA ya se resolvió pero el portal
 * devolvió la portada pública (`/Home/Index/en`): ahí el formulario de Auth0 no
 * existe y el botón de entrada está visible. Sin este reenvío la cookie de
 * Auth0 quedaba sin canjear, la vista se cerraba como «resuelta» y el sync
 * siguiente volvía a pedir el CAPTCHA — el síntoma «resolví el captcha y al
 * minuto dice que no respondió».
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
 * Tras resolver el CAPTCHA, Auth0 deja la cookie pero el portal puede volver a
 * su portada. Reenvía el login para canjearla, con un tope de rondas para no
 * convertir la vista en un martillo contra Auth0.
 *
 * Devuelve `true` si inició una ronda nueva.
 */
async function resumeLoginAfterChallenge(
  page: Page,
  credentials: OnwayCredentials,
  challenge: OnwayChallenge,
): Promise<boolean> {
  const MAX_ROUNDS = 3
  if (challenge.loginRounds >= MAX_ROUNDS) return false
  if (Date.now() - challenge.lastLoginActionAt < 4_000) return false
  // Sólo en la portada pública: en Auth0 resuelve el rellenador, y en la app de
  // seguimiento ya hay sesión.
  if (!isOnwayPortalHome(page.url())) return false

  const signIn = page.locator("#smalAuth0ActionLogin")
  if (!await signIn.isVisible().catch(() => false)) return false

  challenge.loginRounds++
  challenge.lastLoginActionAt = Date.now()
  logger.warn("[flota/onway] verificación resuelta; la plataforma reenvía el login", {
    round: challenge.loginRounds,
    path: safePath(page.url()),
  })
  await signIn.click({ timeout: 10_000 }).catch(() => undefined)
  return true
}

/** `/`, `/Home/...` y la raíz con `?ReturnUrl=`: la pantalla de entrada del portal. */
function isOnwayPortalHome(input: string): boolean {
  try {
    const url = new URL(input)
    if (url.origin !== ONWAY_PORTAL_ORIGIN) return false
    const path = url.pathname.toLocaleLowerCase("en-US")
    return path === "/" || path.startsWith("/home")
  } catch {
    return false
  }
}

function safePath(input: string): string {
  try { return new URL(input).pathname } catch { return "unknown" }
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
    loginRounds: 0,
    lastLoginActionAt: 0,
  }
  const guard = challengeNavigationGuard(page)
  challenge.navigationGuard = guard
  // Un guard de una vista anterior que no alcanzó a soltarse haría fallar cada
  // `continue()` de esta. La página no tiene otros handlers propios.
  await page.unroute("**/*").catch(() => undefined)
  await page.route("**/*", guard).catch(() => { /* la página puede estar cerrándose */ })
  challenge.fillTimer = setInterval(() => {
    // Rellena el formulario si Auth0 lo repinta, o reenvía el login cuando la
    // persona ya resolvió el CAPTCHA pero el portal volvió a su portada.
    if (!isOnwayChallengeSolvedUrl(page.url())) {
      void fillEmptyCredentials(page, credentials)
      void resumeLoginAfterChallenge(page, credentials, challenge)
    }
  }, 2_000)
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
  // este mismo navegador en vez de volver a pedir credenciales. Marcarla evita
  // que un fallo de lectura posterior la descarte (ver
  // `shouldKeepBrowserAfterFailure`): perder estas cookies significa otro CAPTCHA.
  if (state.browserSession) state.browserSession.authenticated = true
  // Esta es la sesión más valiosa: la consiguió una persona resolviendo el
  // CAPTCHA. Guardarla es lo que permite que el cron deje de pedirlo.
  const session = state.browserSession
  if (session) void saveOnwayProfile(session.context, session.account)
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

/**
 * ¿La sesión quedó realmente establecida? Combina la señal fuerte de URL con la
 * funcional: si el portal muestra el botón de entrada, no hay sesión aunque la
 * ruta parezca del área privada.
 *
 * Hace falta porque el portal puede devolver la portada pública
 * (`/Home/Index/en`) después de Auth0 —medido el 2026-11-24—, y ahí el único
 * indicio fiable es el propio botón. Sin esta comprobación la vista daba el
 * desafío por resuelto y el siguiente sync salía sin sesión.
 */
async function isOnwaySessionEstablished(page: Page): Promise<boolean> {
  if (!isOnwayChallengeSolvedUrl(page.url())) return false
  // En la app de seguimiento el botón no existe; si aparece, la cookie no sirvió.
  return !await page.locator("#smalAuth0ActionLogin").isVisible().catch(() => false)
}

async function refreshChallengeStatus(challenge: OnwayChallenge): Promise<void> {
  if (challenge.status !== "awaiting") return
  if (challenge.page.isClosed()) {
    await endChallenge(challenge, "failed")
    return
  }
  if (await isOnwaySessionEstablished(challenge.page)) {
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

/**
 * Cuánto espera la vista asistida a que termine la lectura en vuelo.
 *
 * Con 8 s el botón «Resolver verificación» nunca abría nada. La causa no era
 * una lectura ocasional: la propia página de Monitoreo GPS pide refresco en
 * vivo cada 10 s, y cada lectura de OnWay ocupa el navegador ~45 s, así que
 * mientras alguien mira la pantalla hay una lectura en curso casi todo el
 * tiempo. El modal («Hay una actualización de OnWay en curso») no esperaba
 * nada, sólo rechazaba.
 *
 * 75 s cubre el promedio medido en producción (46 s, máximo 111 s) y deja
 * presupuesto para abrir el portal dentro de los 120 s de `maxDuration` de la
 * ruta: la espera ocurre ANTES de navegar y a la apertura le quedan sus propios
 * topes. Una lectura colgada se rinde igual: el tope no es infinito.
 */
export const ONWAY_CHALLENGE_INFLIGHT_WAIT_MS = 75_000

/**
 * La lectura que ya estaba en vuelo termina antes de abrir la vista; no se
 * cancela a la mitad porque comparte el navegador y dejaría la página cerrada
 * bajo los pies de la persona. Pasado el tope, la apertura se rinde con BUSY.
 */
async function waitForInFlightOnwayRead(maxMs: number): Promise<boolean> {
  const pending = state.inFlight
  if (!pending) return true
  return Promise.race([
    pending.then(() => true, () => true),
    delay(maxMs).then(() => false),
  ])
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

  // La lectura en vuelo se espera hasta `ONWAY_CHALLENGE_INFLIGHT_WAIT_MS`:
  // rechazar a los 8 s le cerraba el botón a la persona cada vez que el cron
  // estaba leyendo el portal (46 s de promedio). Desde que `challengeStarting`
  // está activo, ninguna lectura nueva entra al portal.
  if (!await waitForInFlightOnwayRead(ONWAY_CHALLENGE_INFLIGHT_WAIT_MS)) {
    throw new OnwayChallengeError("ONWAY_CHALLENGE_BUSY")
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
    // `inFlight` se suelta siempre. El NAVEGADOR sólo se descarta si no había
    // sesión confirmada: si la persona ya resolvió el CAPTCHA, tirarlo borra sus
    // cookies y el portal vuelve a pedir el desafío — el «me tiene una y otra
    // vez» del 2026-11-24. Un navegador sin sesión, en cambio, no tiene nada que
    // salvar y debe cerrarse para que la corrida siguiente abra uno limpio.
    if (error instanceof OnwayClientError && error.code === "ONWAY_PORTAL_TIMEOUT") {
      if (shouldKeepBrowserAfterFailure()) {
        state.inFlight = null
        await replaceHungPage()
      } else {
        abandonBrowserSession()
      }
    }
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
  const portal = await scrapePortal(
    credentials,
    options.includeDetails === false ? LIVE_SCRAPE_TIMEOUTS : undefined,
  )
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
