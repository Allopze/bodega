import type { Browser, Page, Response } from "playwright"
import { parseOnwaySnapshot, type OnwaySnapshotResult } from "./onway-contract"
import {
  parseOnwayAlertHistory,
  parseOnwayDeviceDetail,
  parseOnwayHistory,
  parseOnwayTrips,
  type OnwayAlertSnapshot,
  type OnwayDeviceTelemetry,
  type OnwayHistoryPoint,
  type OnwayTripSnapshot,
} from "./onway-telemetry-contract"

const PORTAL_ORIGIN = "https://onway.enteldigital.cl"
const AUTH_ORIGIN = "https://lw-fleet-entel-cl.us.auth0.com"
const TRACKING_URL = `${PORTAL_ORIGIN}/OnlineTracking/Index/es`
const SNAPSHOT_PATH = "/OnlineTracking/GetOnlineDevicesInfoByUserForMap/"
const DEVICE_DETAIL_PATH = "/OnlineTracking/GetOnlineDeviceInfoByIdFromMap"
const ALERTS_PATH = "/OnlineTracking/GetDevicesAlertsHistory/"
const NAVIGATION_TIMEOUT_MS = 45_000
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024
const MAX_TELEMETRY_DEVICES = 500

interface OnwayBrowserSession {
  browser: Browser
  page: Page
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

export type OnwayClientErrorCode =
  | "ONWAY_CREDENTIALS_REQUIRED"
  | "ONWAY_CREDENTIALS_INVALID"
  | "ONWAY_AUTH_REJECTED"
  | "ONWAY_INTERACTIVE_AUTH_REQUIRED"
  | "ONWAY_PORTAL_TIMEOUT"
  | "ONWAY_RESPONSE_INVALID"
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
  try { return new URL(input).origin === AUTH_ORIGIN }
  catch { return false }
}

function isSnapshotResponse(response: Response): boolean {
  try {
    const url = new URL(response.url())
    return url.origin === PORTAL_ORIGIN
      && url.pathname === SNAPSHOT_PATH
      && response.request().method() === "POST"
  } catch {
    return false
  }
}

async function openAuthentication(page: Page): Promise<void> {
  const signIn = page.locator("#smalAuth0ActionLogin")
  if (new URL(page.url()).origin === PORTAL_ORIGIN) {
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
    await page.locator('input[name="username"]').waitFor({ state: "visible", timeout: NAVIGATION_TIMEOUT_MS })
  } catch {
    throw new OnwayClientError(
      await hasInteractiveChallenge(page) ? "ONWAY_INTERACTIVE_AUTH_REQUIRED" : "ONWAY_PORTAL_TIMEOUT",
    )
  }
}

async function hasInteractiveChallenge(page: Page): Promise<boolean> {
  return await page.locator([
    'input[name="otp"]',
    'input[autocomplete="one-time-code"]',
    'iframe[src*="captcha" i]',
    'iframe[title*="captcha" i]',
    '[data-captcha]',
  ].join(", ")).count() > 0
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

let browserSession: OnwayBrowserSession | null = null

async function closeBrowserSession(): Promise<void> {
  const current = browserSession
  browserSession = null
  await current?.browser.close().catch(() => undefined)
}

async function getBrowserSession(): Promise<OnwayBrowserSession> {
  if (browserSession?.browser.isConnected() && !browserSession.page.isClosed()) return browserSession
  await closeBrowserSession()

  const { chromium } = await import("playwright")
  const browser = await chromium.launch(resolveOnwayLaunchOptions(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH))
  const context = await browser.newContext({
    locale: "es-CL",
    timezoneId: "America/Santiago",
    serviceWorkers: "block",
  })
  const page = await context.newPage()
  browserSession = { browser, page }
  return browserSession
}

async function portalJson(page: Page, path: string, init: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {}): Promise<unknown> {
  try {
    return await page.evaluate(async ({ path, method, body, maxBytes }) => {
      const response = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const contentLength = Number(response.headers.get("content-length") ?? 0)
      if (!response.ok || (Number.isFinite(contentLength) && contentLength > maxBytes)) throw new Error("ONWAY_RESPONSE_INVALID")
      const text = await response.text()
      if (text.length > maxBytes) throw new Error("ONWAY_RESPONSE_INVALID")
      return JSON.parse(text) as unknown
    }, { path, method: init.method ?? "GET", body: init.body, maxBytes: MAX_RESPONSE_BYTES })
  } catch {
    throw new OnwayClientError("ONWAY_RESPONSE_INVALID")
  }
}

function unwrapArray(input: unknown): unknown[] {
  if (Array.isArray(input)) return input
  if (!isRecord(input)) return []
  for (const key of ["data", "alerts", "items", "rows", "result"]) {
    if (Array.isArray(input[key])) return input[key]
  }
  return []
}

async function fetchDeviceDetails(page: Page, refs: OnwayPortalDeviceRef[]): Promise<OnwayDeviceTelemetry[]> {
  const details: OnwayDeviceTelemetry[] = []
  for (const ref of refs) {
    const payload = await portalJson(page, `${DEVICE_DETAIL_PATH}?unitId=${encodeURIComponent(ref.unitId)}`)
    const detail = parseOnwayDeviceDetail(isRecord(payload) && isRecord(payload.data) ? payload.data : payload)
    if (detail && detail.deviceId === ref.deviceId) details.push(detail)
  }
  return details
}

async function fetchAlerts(page: Page, refs: OnwayPortalDeviceRef[]): Promise<OnwayAlertSnapshot[]> {
  const imeis = refs.flatMap((ref) => ref.imei ? [ref.imei] : [])
  if (imeis.length === 0) return []
  const deviceIdByImei = new Map(refs.flatMap((ref) => ref.imei ? [[ref.imei, ref.deviceId] as const] : []))
  const deviceIdByUnitId = new Map(refs.map((ref) => [ref.unitId, ref.deviceId]))
  const payload = await portalJson(page, ALERTS_PATH, {
    method: "POST",
    body: { imeis, searchMode: "today", page: 1, pageSize: 1_000, noCache: Date.now() },
  })
  return unwrapArray(payload).flatMap((row) => {
    const parsed = parseOnwayAlertHistory(row)
    if (!parsed) return []
    const sourceImei = isRecord(row) && typeof row.unit_imei === "string" ? row.unit_imei : null
    const externalDeviceId = (sourceImei ? deviceIdByImei.get(sourceImei) : undefined)
      ?? (parsed.externalDeviceId ? deviceIdByUnitId.get(parsed.externalDeviceId) ?? parsed.externalDeviceId : undefined)
    return externalDeviceId ? [{ ...parsed, externalDeviceId }] : []
  })
}

async function fetchHistory(page: Page, ref: OnwayPortalDeviceRef, from: string, to: string): Promise<OnwayHistoryPoint[]> {
  if (!ref.imei) return []
  try {
    const payload = await page.evaluate(async ({ imei, from, to, timeoutMs }) => {
      const context = (globalThis as { lbs?: { apiHistory?: { get?: (...args: unknown[]) => void }; getContext?: () => { loggedUser?: Record<string, unknown> } } }).lbs
      const get = context?.apiHistory?.get
      const loggedUser = context?.getContext?.().loggedUser
      if (!get || !loggedUser || typeof loggedUser.client_id !== "string") throw new Error("ONWAY_HISTORY_UNAVAILABLE")
      return await new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("ONWAY_HISTORY_TIMEOUT")), timeoutMs)
        try {
          get("devices/quick/history", {
            clientId: loggedUser.client_id,
            imei,
            from,
            to,
            culture: typeof loggedUser.two_letters_culture === "string" ? loggedUser.two_letters_culture : "es",
            timeZone: typeof loggedUser.time_zone_offset === "string" ? loggedUser.time_zone_offset : "-04:00",
            filteredAlerts: "",
          }, (response: unknown) => { clearTimeout(timeout); resolve(response) })
        } catch (error) {
          clearTimeout(timeout)
          reject(error)
        }
      })
    }, { imei: ref.imei, from, to, timeoutMs: NAVIGATION_TIMEOUT_MS })
    return parseOnwayHistory(unwrapArray(payload))
  } catch {
    return []
  }
}

async function fetchTrips(page: Page, ref: OnwayPortalDeviceRef): Promise<OnwayTripSnapshot[]> {
  if (!ref.imei) return []
  const payload = await portalJson(page, `/OnlineTracking/GetDeviceLatestTrips/?noCache=${Date.now()}&imei=${encodeURIComponent(ref.imei)}`)
  return parseOnwayTrips(unwrapArray(payload))
}

async function scrapeWithSession(credentials: OnwayCredentials): Promise<OnwayPortalSnapshot> {
  const { page } = await getBrowserSession()
  const responsePromise = page.waitForResponse(isSnapshotResponse, { timeout: NAVIGATION_TIMEOUT_MS })
  void responsePromise.catch(() => undefined)

  try {
    await page.goto(TRACKING_URL, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS })
    const currentPageUrl = new URL(page.url())
    const needsAuthentication = currentPageUrl.origin !== PORTAL_ORIGIN
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

let inFlight: Promise<OnwayPortalSnapshot> | null = null

async function scrapePortal(credentials: OnwayCredentials): Promise<OnwayPortalSnapshot> {
  if (inFlight) return inFlight
  inFlight = scrapeWithSession(credentials).finally(() => { inFlight = null })
  return inFlight
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
export async function fetchOnwayTelemetry(input: OnwayCredentials, options: { includeHistory?: boolean; historyFrom?: string; historyTo?: string } = {}): Promise<OnwayTelemetryBundle> {
  const credentials = validateOnwayCredentials(input)
  const portal = await scrapePortal(credentials)
  const { page } = await getBrowserSession()
  const warnings: OnwayTelemetryBundle["warnings"] = []
  let details: OnwayDeviceTelemetry[] = []
  let alerts: OnwayAlertSnapshot[] = []
  try { details = await fetchDeviceDetails(page, portal.refs) }
  catch { warnings.push("details") }
  try { alerts = await fetchAlerts(page, portal.refs) }
  catch { warnings.push("alerts") }
  const historyByDeviceId = new Map<string, OnwayHistoryPoint[]>()
  const tripsByDeviceId = new Map<string, OnwayTripSnapshot[]>()
  if (options.includeHistory && options.historyFrom && options.historyTo) {
    for (const ref of portal.refs) {
      try { historyByDeviceId.set(ref.deviceId, await fetchHistory(page, ref, options.historyFrom, options.historyTo)) }
      catch { warnings.push("history") }
      try { tripsByDeviceId.set(ref.deviceId, await fetchTrips(page, ref)) }
      catch { warnings.push("trips") }
    }
  }
  return { snapshot: portal.snapshot, details, alerts, historyByDeviceId, tripsByDeviceId, warnings: [...new Set(warnings)] }
}
