import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { spawn, type ChildProcess } from "node:child_process"
import crypto from "node:crypto"
import postgres from "postgres"
import bcrypt from "bcryptjs"
import sharp from "sharp"
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test"
import { loadEnvConfig } from "@next/env"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { sql } from "drizzle-orm"
import * as schema from "../db/schema"
import { SYSTEM_PERMISSIONS } from "@/lib/auth/system-rbac"
import { chileDateParts } from "@/lib/utils"
import { REPORTE_EQUIPOS } from "@/lib/sst/definitions/reporte-equipos"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  getRedactedDatabaseIdentifier,
  quotePostgresIdentifier,
} from "../lib/testing/destructive-database-guard"
import {
  discoverRoutePatterns,
  routePatternMatches,
  type DiscoveredRoutePattern,
} from "./capture-route-inventory"

/**
 * capture-all-routes.ts  —  Auditoría visual automatizada de Chome
 * =====================================================================
 *
 * Genera capturas de pantalla (desktop 1920×1080 + mobile 390×844) de todas
 * las rutas del sistema usando Playwright. Prepara una base de datos
 * temporal con datos de prueba, inicia un servidor Next.js embebido y
 * navega por cada ruta para tomar la captura.
 *
 * ── USO ───────────────────────────────────────────────────────────────────
 *
 *   npm run ss                             Todas las rutas, ambos viewports
 *   npm run ss prevencion                  Solo módulo prevención
 *   npm run ss prevencion desktop           Solo módulo prevención en desktop
 *   npm run ss desktop                     Todos los módulos solo en desktop
 *   npm run ss mobile                      Todos los módulos solo en mobile
 *
 * ── VARIABLES DE ENTORNO ──────────────────────────────────────────────────
 *
 *   Variable obligatoria:
 *     CAPTURE_DATABASE_URL              URL de BD Postgres para datos de prueba
 *                                        (p. ej. postgres://.../bodega_capture)
 *
 *   Variables opcionales:
 *     CAPTURE_PORT                      Puerto del servidor Next.js (def. 3127)
 *     CAPTURE_OUTPUT_DIR                Directorio de salida (def. audit/screenshots/{fecha})
 *     CAPTURE_STORAGE_PATH              Volumen desechable de archivos (def. storage/capture)
 *     CAPTURE_CONCURRENCY               Workers en paralelo (def. 4)
 *     CAPTURE_ALLOW_DESTRUCTIVE_RESET   "true" para permitir reset de BD
 *     CAPTURE_SKIP_HASH                 "true" omite el SHA-256 de cada PNG (más rápido)
 *     CAPTURE_SKIP_BUILD                "true" salta el build on-demand; sin build, dos
 *                                        `next dev` paralelos comparten `.next` y pueden
 *                                        devolver 500 en rutas autenticadas
 *
 * ── FILTRO POR MÓDULO ─────────────────────────────────────────────────────
 *
 *   Primer argumento (salvo que sea "desktop" o "mobile") es el prefijo del
 *   slug para capturar solo un submódulo. Prefijos disponibles:
 *     combustibles, prevencion, admin, solicitudes, compras, recepcion,
 *     bodega, entregas, trazabilidad, reportes, analitica, flota,
 *     mantenciones, repuestos, servicios, soporte, ti, facturacion
 *
 *   Las rutas públicas (login, etc.) siempre se incluyen para permitir
 *   la autenticación.
 *
 * ── FILTRO POR VIEWPORT ───────────────────────────────────────────────────
 *
 *   Cualquier argumento que nombre un viewport filtra las capturas a ése.
 *   Puede ir como primer o segundo argumento:
 *
 *     npm run ss desktop                  Solo desktop 1920×1080
 *     npm run ss admin mobile             Solo admin en mobile 390×844
 *
 *   La corrida por defecto captura desktop y mobile. Los tres anchos del gate
 *   selectivo se piden por nombre y no entran en el barrido completo:
 *
 *     npm run ss prevencion small         Solo 320×568
 *     npm run ss prevencion tablet        Solo 768×1024
 *     npm run ss compras laptop           Solo 1366×768
 *
 * ── SALIDA ────────────────────────────────────────────────────────────────
 *
 *   audit/screenshots/{fecha}-playwright/      Captura completa (nueva cada vez)
 *   audit/screenshots/{modulo}/                Captura filtrada (se sobrescribe)
 *   ├── desktop-{slug}.png              Captura desktop (1920×1080)
 *   ├── mobile-{slug}.png               Captura mobile (390×844)
 *   └── manifest.json                   Metadatos de la ejecución
 *
 *   Cuando se filtra por módulo, el directorio de salida es fijo y se
 *   sobrescribe en cada ejecución (se eliminan los .png y manifest.json
 *   anteriores antes de empezar).
 *
 * ── ARQUITECTURA ──────────────────────────────────────────────────────────
 *
 *   1. Descubre páginas `page.*` bajo `app/`: agrega páginas estáticas nuevas y exige
 *      fixtures explícitos para las páginas dinámicas.
 *   2. Prepara BD:   resetea esquema → migraciones → inserta fixtures
 *   3. Si hay más de un viewport y no existe build, compila `next build` una
 *      vez para que los servidores paralelos sirvan desde `.next` sin pisarse
 *   4. Inicia server Next.js embebido en CAPTURE_PORT
 *   5. Abre Chromium y captura en 1 o 2 viewports según filtro:
 *       a) Rutas públicas (sin auth)
 *       b) Login como admin.audit@chome.cl
 *       c) Rutas autenticadas
 *      Durante cada captura recoge los enlaces internos renderizados para
 *      detectar navegación fuera del inventario.
 *   6. Barra de progreso en vivo con spinner, ⏱ tiempo transcurrido y ETA
 *   7. Genera manifest.json con resultados, inventario y metadatos
 *   8. Cierra servidor y navegador
 */

loadEnvConfig(process.cwd())

export type CaptureMode = "modals" | "tabs" | "interactive" | "full"

const desktop = { name: "desktop", width: 1920, height: 1080 }
const mobile = { name: "mobile", width: 390, height: 844 }

/**
 * Gate selectivo de anchos (TASK-UI-001).
 *
 * La corrida por defecto sigue siendo 1920 y 390: son los dos anchos que la
 * auditoría exige en cada pasada y duplicar el resto en cada ejecución haría el
 * barrido inviable. Pero el criterio pedía además 320, 768 y 1366 "al gate
 * selectivo", y esos tres no existían en ninguna parte: no había forma de
 * capturarlos ni siquiera a mano.
 *
 *   npm run ss prevencion small     320×568  — el ancho donde el reflow falla
 *   npm run ss prevencion tablet    768×1024 — el salto de tarjeta a tabla
 *   npm run ss compras laptop       1366×768 — el escritorio pequeño real
 */
const small = { name: "small", width: 320, height: 568 }
const tablet = { name: "tablet", width: 768, height: 1024 }
const laptop = { name: "laptop", width: 1366, height: 768 }

const SELECTABLE_VIEWPORTS = { desktop, mobile, small, tablet, laptop } as const

function parseCliArgs(): {
  moduleFilter: string | undefined
  viewportFilter: string | undefined
  captureMode: CaptureMode
} {
  const viewportNames = new Set(Object.keys(SELECTABLE_VIEWPORTS))
  const modeNames: Record<string, CaptureMode> = {
    "--modals": "modals",
    "modals": "modals",
    "--tabs": "tabs",
    "tabs": "tabs",
    "--interactive": "interactive",
    "interactive": "interactive",
    "--full": "full",
    "full": "full",
    "--all": "full",
    "all": "full",
  }

  const raw = process.argv.slice(2).map((a) => a.trim().toLowerCase()).filter(Boolean)
  let moduleFilter: string | undefined
  let viewportFilter: string | undefined
  let captureMode: CaptureMode = "modals"

  for (const arg of raw) {
    if (viewportNames.has(arg)) {
      viewportFilter = arg
    } else if (modeNames[arg]) {
      captureMode = modeNames[arg]!
    } else {
      moduleFilter = arg
    }
  }
  return { moduleFilter, viewportFilter, captureMode }
}

const { moduleFilter, viewportFilter, captureMode } = parseCliArgs()

const root = process.cwd()
const port = Number(process.env.CAPTURE_PORT ?? 3127)
const baseUrl = `http://127.0.0.1:${port}`
const outputDir = process.env.CAPTURE_OUTPUT_DIR
  ? path.resolve(root, process.env.CAPTURE_OUTPUT_DIR)
  : moduleFilter
    ? path.join(root, "audit", "screenshots", moduleFilter)
    : path.join(root, "audit", "screenshots", `${new Date().toISOString().slice(0, 10)}-playwright`)
const authSecret = "route-screenshot-audit-secret"

/** A-7: rutas que producen scroll horizontal. Se reporta al final y va al manifest. */
interface HorizontalOverflow {
  viewport: string
  slug: string
  scrollWidth: number
  viewportWidth: number
  culprits: string[]
}
const horizontalOverflows: HorizontalOverflow[] = []

/**
 * Errores de JavaScript en el navegador.
 */
interface ClientError { viewport: string; slug: string; messages: string[] }
const clientErrors: ClientError[] = []

export type NavigationDiscovery = {
  path: string
  sources: string[]
  matchesAppRoute: boolean
}

/** Internal links observed while rendering captured pages. */
const discoveredNavigationSources = new Map<string, Set<string>>()

/**
 * Normalizes only same-origin HTML links to a pathname. Query strings are
 * intentionally omitted: a query is usually a view/filter state, not a new
 * App Router page, and keeping it would create an unbounded route inventory.
 */
export function normalizeInternalNavigationPath(href: string, serverBaseUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(href, serverBaseUrl)
  } catch {
    return null
  }

  if (parsed.origin !== new URL(serverBaseUrl).origin) return null
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
  if (parsed.pathname.startsWith("/_next/") || parsed.pathname.startsWith("/api/")) {
    return null
  }
  return parsed.pathname === "/" ? "/" : parsed.pathname.replace(/\/+$/, "")
}

function navigationDiscoveryReport(discovered: readonly DiscoveredRoutePattern[]): NavigationDiscovery[] {
  return [...discoveredNavigationSources.entries()]
    .map(([path, sources]) => ({
      path,
      sources: [...sources].sort(),
      matchesAppRoute: discovered.some((pattern) => routePatternMatches(pattern.pattern, path)),
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

async function discoverRenderedNavigation(page: Page, serverBaseUrl: string, sourceSlug: string) {
  const hrefs = await page.locator("a[href]").evaluateAll((anchors) =>
    anchors.map((anchor) => (anchor as HTMLAnchorElement).href),
  ).catch(() => [] as string[])

  for (const href of hrefs) {
    const path = normalizeInternalNavigationPath(href, serverBaseUrl)
    if (!path) continue
    const sources = discoveredNavigationSources.get(path) ?? new Set<string>()
    sources.add(sourceSlug)
    discoveredNavigationSources.set(path, sources)
  }
}

export type ModalTarget = {
  slug: string
  triggerSelector: string
  waitForSelector?: string
  notes?: string
}

export type RouteTarget = {
  slug: string
  path: string
  auth: boolean
  /** `filesystem` targets are generated from new static App Router pages. */
  source?: "manual" | "filesystem"
  expectedStatus?: number
  /** Exact pathname+query values allowed after navigation. Defaults to `path`. */
  allowedPaths?: string[]
  /** Redirect aliases are verified in the manifest but do not emit a duplicate PNG. */
  captureView?: boolean
  notes?: string
  modals?: ModalTarget[]
}

export type CaptureSeedArea = {
  section: string
  fixtures: string[]
}

export type CaptureState = "capture-ok" | "capture-invalid" | "expected-redirect" | "expected-404" | "fixture-missing"

export type CaptureResult = {
  viewport: string
  slug: string
  path: string
  requestedUrl: string
  finalUrl: string
  status: number | null
  ok: boolean
  state: CaptureState
  screenshot: string
  screenshotHash?: string
  type?: "view" | "modal" | "tab" | "select" | "hover" | "dropdown"
  selector?: string
  error?: string
  notes?: string
}

/** Paths are deliberately exact: an unexpected redirect must be declared on its route. */
export function getAllowedCapturePaths(route: RouteTarget): string[] {
  return route.allowedPaths ?? [route.path]
}

export function isCaptureUrlAllowed(route: RouteTarget, url: string): boolean {
  const parsed = new URL(url, baseUrl)
  const currentPath = `${parsed.pathname}${parsed.search}`
  return getAllowedCapturePaths(route).includes(currentPath)
}

/**
 * Tras una interacción (tab, modal, select, dropdown) el invariante que importa
 * es no haber abandonado la ruta: el pathname debe seguir siendo uno de los
 * declarados. La query sí puede cambiar, porque las vistas y pestañas persisten
 * su estado en la URL a propósito (pasadas 41 y 51) para ser enlazables y
 * recuperables. Exigir la query exacta marcaría ese diseño como error.
 */
export function isCaptureInteractionUrlAllowed(route: RouteTarget, url: string): boolean {
  if (isCaptureUrlAllowed(route, url)) return true
  const parsed = new URL(url, baseUrl)
  return getAllowedCapturePaths(route).some((allowed) => new URL(allowed, baseUrl).pathname === parsed.pathname)
}

function resolveCaptureState(
  route: RouteTarget,
  status: number | null,
  finalUrl: string,
  scope: "view" | "interaction" = "view"
): CaptureState {
  const allowed = scope === "interaction" ? isCaptureInteractionUrlAllowed(route, finalUrl) : isCaptureUrlAllowed(route, finalUrl)
  if (!allowed) return "capture-invalid"
  if (route.expectedStatus === 404 && status === 404) return "expected-404"
  if (status === 404) return "fixture-missing"
  if (status !== null && status >= 400) return "capture-invalid"
  if (getAllowedCapturePaths(route)[0] !== route.path) return "expected-redirect"
  return "capture-ok"
}

function isSuccessfulCaptureState(state: CaptureState): boolean {
  return state === "capture-ok" || state === "expected-redirect" || state === "expected-404"
}

/**
 * "Ruta y viewport" de una captura, derivados de su nombre de archivo.
 *
 * `desktop-prevencion-pdtp-modal-auto-2.png` → `desktop-prevencion-pdtp`. Es
 * lo que permite distinguir un duplicado que delata un fallo (mismo ámbito) de
 * uno que sólo refleja un componente compartido (ámbitos distintos).
 */
/**
 * Retira las capturas de interacción que son idénticas a una captura de ruta.
 *
 * El caso que lo motivó: la pestaña "Avance" del detalle de OC está declarada
 * **a la vez** como ruta propia (`/compras/po-audit-1?tab=avance`) y como
 * pestaña del detalle, de modo que se fotografiaba dos veces. `isDeclaredElsewhere`
 * no lo veía porque esa pestaña no cambia la URL: es estado de cliente.
 *
 * Cualquier heurística por nombre o por URL falla en algún caso —el rótulo es
 * "Avance por ítem" y el query es `avance`—, así que la comparación se hace
 * donde la respuesta es exacta: el hash del PNG. Si una interacción produce el
 * mismo byte que una ruta ya capturada, la ruta es la evidencia canónica y la
 * interacción no aporta nada; se borra su archivo y se retira del manifest.
 *
 * Sólo se poda la interacción, nunca la vista: dos vistas idénticas siguen
 * siendo un problema y tienen que romper el gate.
 */
export function pruneRedundantInteractionCaptures(root: string, results: CaptureResult[]): string[] {
  const viewHashes = new Set(
    results.filter((r) => (r.type ?? "view") === "view" && r.screenshotHash).map((r) => r.screenshotHash!),
  )
  const pruned: string[] = []

  for (let i = results.length - 1; i >= 0; i--) {
    const result = results[i]!
    if ((result.type ?? "view") === "view") continue
    if (!result.screenshotHash || !viewHashes.has(result.screenshotHash)) continue

    const file = path.join(root, result.screenshot)
    fs.rmSync(file, { force: true })
    pruned.push(result.slug)
    results.splice(i, 1)
  }

  return pruned.reverse()
}

/** ¿Es la captura de un overlay (modal, tab, select) y no de la ruta base? */
function isInteractionCapture(screenshot: string): boolean {
  return /-(?:modal|modal-auto|tab|select|dropdown)-/.test(path.basename(screenshot))
}

/** Espera a que el navegador declare terminadas sus animaciones en curso. */
async function settleAnimations(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => document.getAnimations().every((animation) => animation.playState !== "running"),
      undefined,
      { timeout: 2000 },
    )
    .catch(() => undefined)
}

function captureScope(screenshot: string): string {
  const base = path.basename(screenshot, ".png")
  return base.split(/-(?:modal|modal-auto|tab|select|dropdown)-/)[0] ?? base
}

function screenshotHash(screenshot: string): string {
  if (process.env.CAPTURE_SKIP_HASH === "true") return ""
  return crypto.createHash("sha256").update(fs.readFileSync(screenshot)).digest("hex")
}

// ── Progress bar helpers ─────────────────────────────────────────────────
const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
let spinnerIndex = 0

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatProgress(current: number, total: number, slug: string, ok: boolean, status: number | null, startTime: number, routeMs?: number) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0
  const spin = spinnerFrames[spinnerIndex++ % spinnerFrames.length]!
  const icon = ok ? "✓" : "✗"
  const code = status ?? "—"
  const elapsed = Date.now() - startTime
  const eta = current > 0
    ? Math.round((elapsed / current) * (total - current))
    : 0
  const elapsedStr = formatDuration(elapsed)
  const etaStr = eta > 0 ? formatDuration(eta) : "—"
  const barWidth = 16
  const filled = Math.round((current / total) * barWidth)
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled)
  const individual = routeMs !== undefined ? `  +${(routeMs / 1000).toFixed(1)}s` : ""
  return `${spin} ${bar} ${current}/${total} (${pct}%) ${slug} ${icon} ${code}  ⏱ ${elapsedStr}  ETA ${etaStr}${individual}`
}

function clearLine() {
  process.stdout.write("\r\x1b[K")
}

function writeProgress(current: number, total: number, slug: string, ok: boolean, status: number | null, startTime: number, routeMs?: number) {
  clearLine()
  process.stdout.write(formatProgress(current, total, slug, ok, status, startTime, routeMs))
}

function finalizeProgress(total: number, errors: number) {
  clearLine()
  const ok = total - errors
  if (errors === 0) {
    console.log(`✅ ${total}/${total} capturadas correctamente`)
  } else {
    console.log(`⚠️  ${ok}/${total} ok, ${errors} con errores`)
  }
}

/**
 * Ejecuta una función asíncrona mostrando un spinner animado en la
 * terminal con la etiqueta dada. Al finalizar imprime ✅ o ❌ según
 * el resultado, junto con el tiempo transcurrido.
 */
async function runWithSpinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const startTime = Date.now()
  let frameIndex = 0
  const interval = setInterval(() => {
    const spin = spinnerFrames[frameIndex++ % spinnerFrames.length]!
    const elapsed = formatDuration(Date.now() - startTime)
    clearLine()
    process.stdout.write(`${spin} ${label}  ⏱ ${elapsed}`)
  }, 120)

  try {
    const result = await fn()
    clearInterval(interval)
    clearLine()
    console.log(`✅ ${label}  ⏱ ${formatDuration(Date.now() - startTime)}`)
    return result
  } catch (error) {
    clearInterval(interval)
    clearLine()
    console.log(`❌ ${label}`)
    throw error
  }
}

/**
 * Capturar reinicia el esquema y siembra fixtures: nunca puede inferir una BD
 * ni habilitar el borrado a partir de `DATABASE_URL`. La doble declaración
 * hace visible la intención operativa antes de limpiar salida o tocar Postgres.
 */
type CaptureEnvironment = Readonly<Record<string, string | undefined>>

/**
 * El entorno de capturas nunca hereda `STORAGE_PATH`: podría apuntar al volumen
 * real de la aplicación y mezclar fixtures visuales con evidencia operativa.
 * El standalone cambia su cwd a `.next/standalone`, por eso el servidor y el
 * sembrado reciben además una ruta absoluta compartida.
 */
export function resolveCaptureStoragePath(env: CaptureEnvironment = process.env) {
  const explicit = env.CAPTURE_STORAGE_PATH?.trim()
  return explicit ? path.resolve(explicit) : path.join(root, "storage", "capture")
}

export function requireCaptureDatabaseUrl(env: CaptureEnvironment = process.env) {
  const captureDbUrl = env.CAPTURE_DATABASE_URL?.trim()
  if (!captureDbUrl) {
    throw new Error(
      "CAPTURE_DATABASE_URL is required for screenshot capture. Set it to an isolated disposable database; DATABASE_URL is never used as a fallback.",
    )
  }

  assertSafeDestructiveDatabase({
    databaseUrl: captureDbUrl,
    allowDestructiveReset: env.CAPTURE_ALLOW_DESTRUCTIVE_RESET === "true",
    context: "CAPTURE",
  })

  return captureDbUrl
}



const routeTargets: RouteTarget[] = [
  { slug: "root", path: "/", auth: false, allowedPaths: ["/login?callbackUrl=%2F"], captureView: false, notes: "Sin sesión, el tablero canónico redirige a inicio de sesión conservando el destino." },
  { slug: "login", path: "/login", auth: false },
  { slug: "registro", path: "/registro", auth: false },
  { slug: "recuperar", path: "/recuperar", auth: false },
  { slug: "recuperar-token", path: "/recuperar/capture-reset-token", auth: false },
  /*
   * Inicio pinta **una vista a la vez** (`?vista=`), así que una sola captura
   * de `/dashboard` sólo documenta el Resumen y deja las otras ocho sin
   * evidencia. Una entrada por vista; el gating por permiso decide cuáles
   * existen para el usuario de la captura.
   */
  { slug: "dashboard", path: "/dashboard", auth: true },
  { slug: "dashboard-trabajo", path: "/dashboard?vista=trabajo", auth: true },
  { slug: "dashboard-finanzas", path: "/dashboard?vista=finanzas", auth: true },
  { slug: "dashboard-adquisiciones", path: "/dashboard?vista=adquisiciones", auth: true },
  { slug: "dashboard-flota", path: "/dashboard?vista=flota", auth: true },
  { slug: "dashboard-prevencion", path: "/dashboard?vista=prevencion", auth: true },
  { slug: "dashboard-bodega", path: "/dashboard?vista=bodega", auth: true },
  { slug: "dashboard-terreno", path: "/dashboard?vista=terreno", auth: true },
  { slug: "dashboard-gobernanza", path: "/dashboard?vista=gobernanza", auth: true },
  { slug: "perfil", path: "/perfil", auth: true },
  // Una sola ruta inexistente: cualquier URL sin coincidencia resuelve al mismo
  // 404 con shell, así que declarar dos producía una evidencia repetida.
  { slug: "app-not-found", path: "/app-ruta-inexistente-auditoria", auth: true, expectedStatus: 404 },
  { slug: "solicitudes", path: "/solicitudes", auth: true },
  { slug: "solicitudes-nueva", path: "/solicitudes/nueva", auth: true },
  { slug: "solicitudes-detalle", path: "/solicitudes/req-audit-1", auth: true },
  { slug: "aprobaciones", path: "/aprobaciones", auth: true },
  { slug: "compras", path: "/compras", auth: true },
  { slug: "compras-nueva", path: "/compras/nueva", auth: true },
  { slug: "compras-detalle", path: "/compras/po-audit-1", auth: true },
  { slug: "compras-detalle-facturacion", path: "/compras/po-audit-1?tab=facturacion", auth: true, notes: "Detalle OC — pestaña Facturación" },
  { slug: "compras-detalle-avance", path: "/compras/po-audit-1?tab=avance", auth: true, notes: "Detalle OC — pestaña Avance por ítem" },
  { slug: "compras-print", path: "/compras/po-audit-1/print", auth: true },
  /* El período va explícito porque la bandeja aterriza en el mes corriente (hora
     de Chile) y el fixture vive en el mes del seed: sin el parámetro la captura
     documentaría un estado vacío que no dice nada del módulo. */
  { slug: "compras-dte", path: "/compras/dte?periodo=2026-06", auth: true, notes: "Bandeja de entrada DTE del período sembrado." },
  {
    slug: "recepcion",
    path: "/recepcion",
    auth: true,
    modals: [
      /* Anclado a una descripción SIN nombre propio: las de oficina resuelven el
         nombre real de la faena, que cambia por despliegue. */
      { slug: "leyenda", triggerSelector: 'summary:has-text("Qué significa cada estado")', waitForSelector: 'text=a la espera de que llegue la mercadería', notes: "Leyenda de estados de recepción expandida" },
    ],
  },
  { slug: "recepcion-nueva", path: "/recepcion/nueva?oc=po-audit-1", auth: true },
  { slug: "recepcion-detalle", path: "/recepcion/rec-audit-1", auth: true },
  // La cola operacional faltaba en esta lista, así que era el único módulo del
  // flujo sin línea base con la que comparar entre auditorías (auditoría UI/UX
  // 2026-07-29). Se capturan también dos estados de filtro, que es donde vive lo
  // que la pantalla tiene de particular: el resaltado de vencidas y el vacío.
  { slug: "pendientes", path: "/pendientes", auth: true },
  { slug: "pendientes-vencidas", path: "/pendientes?quick=overdue", auth: true, notes: "Cola filtrada por vencidas" },
  { slug: "pendientes-vacio", path: "/pendientes?q=sin-resultado-auditoria", auth: true, notes: "Estado vacío de la cola" },
  {
    slug: "bodega",
    path: "/bodega",
    auth: true,
    modals: [
      { slug: "movimiento", triggerSelector: 'button:has-text("Movimiento"), button:has-text("Registrar")', notes: "Sheet de movimiento de bodega" },
    ],
  },
  { slug: "bodega-kardex", path: "/bodega?vista=kardex", auth: true, notes: "Vista de kardex con sus filtros propios" },
  { slug: "bodega-bajo-minimo", path: "/bodega?stock=low", auth: true, notes: "Stock bajo el mínimo definido" },
  { slug: "bodega-documentos", path: "/bodega/documentos", auth: true, notes: "Ajustes, bajas, devoluciones y conteos con su folio" },
  { slug: "bodega-guias", path: "/bodega/guias", auth: true, notes: "Listado de guías de despacho internas" },
  { slug: "bodega-guia-detalle", path: "/bodega/guias/gdi-audit-1", auth: true },
  { slug: "bodega-guia-print", path: "/bodega/guias/gdi-audit-1/print", auth: true },
  { slug: "bodega-guia-editar", path: "/bodega/guias/gdi-audit-2/editar", auth: true, notes: "El editor sólo abre borradores; una guía despachada muestra el aviso en su lugar." },
  /* Desde que la GDI nace de la recepción en oficina, `/bodega/guias/nueva` sólo
     redirige a `/recepcion` (lo fija `e2e/guias-despacho.spec.ts`). Se declara
     como redirección — igual que los catálogos legados de combustibles — para
     que la ruta quede cubierta sin producir un ✗ por "URL final no declarada". */
  { slug: "bodega-guias-nueva-legacy", path: "/bodega/guias/nueva", auth: true, allowedPaths: ["/recepcion"], captureView: false, notes: "Compatibilidad: no existe alta independiente de GDI." },
  { slug: "entregas", path: "/entregas", auth: true },
  { slug: "entregas-print", path: "/entregas/del-audit-1/print", auth: true },
  /* Trazabilidad vive bajo Bodega desde que se consolidó el seguimiento por
     faena; `/trazabilidad/*` quedó como redirección. Se capturan las dos: las
     canónicas por su contenido, y las legadas para que el redirect siga
     demostrado y su patrón dinámico no quede sin fixture. */
  { slug: "bodega-trazabilidad", path: "/bodega/trazabilidad", auth: true },
  { slug: "bodega-trazabilidad-detalle", path: "/bodega/trazabilidad/req-item-audit-1", auth: true },
  { slug: "bodega-trazabilidad-trabajador", path: "/bodega/trazabilidad/trabajador/worker-audit-1", auth: true },
  { slug: "bodega-trazabilidad-documento", path: "/bodega/trazabilidad/documento", auth: true, notes: "Buscador por código, sin consulta" },
  { slug: "bodega-trazabilidad-documento-resultado", path: "/bodega/trazabilidad/documento?codigo=OC-2026-0001", auth: true, notes: "Expediente resuelto desde el código de la OC" },
  { slug: "trazabilidad", path: "/trazabilidad", auth: true, allowedPaths: ["/bodega/trazabilidad"], captureView: false, notes: "Compatibilidad: redirige a Bodega › Trazabilidad." },
  { slug: "trazabilidad-detalle", path: "/trazabilidad/req-item-audit-1", auth: true, allowedPaths: ["/bodega/trazabilidad/req-item-audit-1"], captureView: false, notes: "Compatibilidad: redirección." },
  { slug: "trazabilidad-trabajador", path: "/trazabilidad/trabajador/worker-audit-1", auth: true, allowedPaths: ["/bodega/trazabilidad/trabajador/worker-audit-1"], captureView: false, notes: "Compatibilidad: redirección." },
  { slug: "trazabilidad-documento", path: "/trazabilidad/documento", auth: true, allowedPaths: ["/bodega/trazabilidad/documento"], captureView: false, notes: "Compatibilidad: redirección." },
  { slug: "reportes", path: "/reportes", auth: true },
  { slug: "analitica", path: "/analitica", auth: true },
  // ── Facturación y cobranza ────────────────────────────────────────────
  // El módulo entero faltaba en esta lista: nueve pantallas sin línea base con
  // la que comparar entre auditorías. El resumen filtra por período y aterriza
  // en el mes corriente, así que su captura lo declara explícito.
  { slug: "facturacion", path: "/facturacion?periodo=2026-06", auth: true, notes: "Resumen del período sembrado." },
  { slug: "facturacion-facturas", path: "/facturacion/facturas", auth: true },
  { slug: "facturacion-facturas-vencidas", path: "/facturacion/facturas?vencidas=1", auth: true, notes: "Listado filtrado por vencidas" },
  { slug: "facturacion-factura-detalle", path: "/facturacion/facturas/inv-audit-1", auth: true },
  { slug: "facturacion-clientes", path: "/facturacion/clientes", auth: true },
  { slug: "facturacion-cobranza", path: "/facturacion/cobranza", auth: true },
  { slug: "facturacion-pendientes", path: "/facturacion/pendientes", auth: true },
  { slug: "facturacion-propuestas", path: "/facturacion/propuestas", auth: true },
  { slug: "facturacion-duplicados", path: "/facturacion/duplicados", auth: true },
  { slug: "facturacion-sincronizacion", path: "/facturacion/sincronizacion", auth: true },
  { slug: "flota", path: "/flota", auth: true },
  { slug: "flota-detalle", path: "/flota/fuel-veh-audit-1", auth: true },
  { slug: "flota-monitoreo", path: "/flota/monitoreo", auth: true, notes: "Monitoreo GPS Entel OnWay: vehículos vinculados, alertas, último run y dispositivos sin match." },
  { slug: "control-operacional", path: "/control-operacional", auth: true },
  { slug: "mantenciones", path: "/mantenciones", auth: true },
  { slug: "mantenciones-detalle", path: "/mantenciones/maint-audit-1", auth: true },
  { slug: "mantenciones-planes", path: "/mantenciones/planes", auth: true },
  { slug: "mantenciones-politicas-documentales", path: "/mantenciones/politicas-documentales", auth: true },
  { slug: "ti", path: "/ti", auth: true },
  { slug: "ti-activos", path: "/ti/activos", auth: true },
  { slug: "ti-activo-detalle", path: "/ti/activos/it-asset-audit-1", auth: true },
  { slug: "ti-asignaciones", path: "/ti/asignaciones", auth: true },
  { slug: "ti-acta-print", path: "/ti/actas/it-assignment-audit-1/print", auth: true },
  { slug: "ti-tickets", path: "/ti/tickets", auth: true },
  { slug: "ti-ticket-detalle", path: "/ti/tickets/it-ticket-audit-1", auth: true },
  // ── TI: submódulos del ciclo de vida del activo (G-septiembre 2026) ────
  // Se declaran explícitos y no delegan en el auto-descubrimiento porque sus
  // capturas dependen de fixtures propios (bajas, licencias, mantenciones,
  // accesos, garantías): sin fixture la página renderiza y la captura
  // documenta un cascarón vacío que no dice nada del módulo.
  { slug: "ti-accesos", path: "/ti/accesos", auth: true, notes: "Sistemas de acceso, matriz trabajador-sistema y checklists de alta/baja." },
  { slug: "ti-bajas", path: "/ti/bajas", auth: true, notes: "Bajas formales de activos con su autorización y destino." },
  { slug: "ti-garantias", path: "/ti/garantias", auth: true, notes: "Ventanas de garantía por activo y proveedores vinculados a TI." },
  { slug: "ti-licencias", path: "/ti/licencias", auth: true, notes: "Licencias y suscripciones con sus asignaciones a trabajadores o equipos." },
  { slug: "ti-mantenciones", path: "/ti/mantenciones", auth: true, notes: "Mantenciones y reparaciones con costo acumulado por activo." },
  { slug: "ti-reportes", path: "/ti/reportes", auth: true, notes: "Catálogo de exportes Excel del parque tecnológico." },
  // ── Combustibles ──────────────────────────────────────────────────────
  { slug: "combustibles", path: "/combustibles", auth: true },
  { slug: "combustibles-nueva", path: "/combustibles/nueva", auth: true },
  { slug: "combustibles-detalle", path: "/combustibles/fuel-audit-1", auth: true },
  { slug: "combustibles-reportes", path: "/combustibles/reportes", auth: true },
  { slug: "combustibles-vehiculos-legacy", path: "/combustibles/vehiculos", auth: true, allowedPaths: ["/admin/flota-catalogos/vehiculos"], captureView: false, notes: "Compatibilidad: redirige al catálogo administrativo canónico." },
  { slug: "combustibles-proveedores-legacy", path: "/combustibles/proveedores-combustible", auth: true, allowedPaths: ["/admin/flota-catalogos/proveedores-combustible"], captureView: false, notes: "Compatibilidad: redirige al catálogo administrativo canónico." },
  {
    slug: "combustibles-cuenta-corriente",
    path: "/combustibles/cuenta-corriente",
    auth: true,
    modals: [
      { slug: "nuevo-estado", triggerSelector: 'button:has-text("Nuevo")', notes: "Diálogo de nuevo estado de cuenta" },
    ],
  },
  { slug: "combustibles-cc-detalle", path: "/combustibles/cuenta-corriente/cc-audit-1", auth: true },
  { slug: "combustibles-facturas", path: "/combustibles/facturas", auth: true },
  { slug: "combustibles-importar", path: "/combustibles/importar", auth: true },
  { slug: "combustibles-importar-detalle", path: "/combustibles/importar/fuel-import-audit-1", auth: true },
  { slug: "combustibles-importar-operaciones-detalle", path: "/combustibles/importar/operaciones/fuel-op-audit-1", auth: true },
  { slug: "combustibles-tae", path: "/combustibles/tae", auth: true },
  { slug: "combustibles-tae-detalle", path: "/combustibles/tae/tae-audit-1", auth: true },
  { slug: "combustibles-tae-importar", path: "/combustibles/tae/importar", auth: true },
  { slug: "combustibles-tae-importar-detalle", path: "/combustibles/tae/importar/tae-import-audit-1", auth: true },
  { slug: "combustibles-tae-importar-historial", path: "/combustibles/tae/importar/historial", auth: true },
  { slug: "combustibles-tae-conciliacion", path: "/combustibles/tae/conciliacion", auth: true },
  { slug: "combustibles-analisis", path: "/combustibles/analisis", auth: true },
  { slug: "combustibles-anomalias", path: "/combustibles/anomalias", auth: true },
  { slug: "combustibles-anomalias-reglas", path: "/combustibles/anomalias/reglas", auth: true },
  { slug: "combustibles-bitacora", path: "/combustibles/bitacora", auth: true },
  { slug: "combustibles-bitacora-historial", path: "/combustibles/bitacora/historial/sst/entity-audit-1", auth: true, allowedPaths: ["/combustibles/bitacora"], captureView: false, notes: "Fixture pendiente: el ID de auditoría actual redirige al historial canónico." },
  { slug: "combustibles-ciclo", path: "/combustibles/ciclo", auth: true },
  { slug: "combustibles-sellos", path: "/combustibles/sellos", auth: true },
  { slug: "repuestos", path: "/repuestos", auth: true, allowedPaths: ["/solicitudes"], captureView: false },
  { slug: "repuestos-nueva", path: "/repuestos/nueva", auth: true, allowedPaths: ["/solicitudes/nueva?tipo=repuestos"] },
  { slug: "repuestos-detalle", path: "/repuestos/rep-audit-1", auth: true, allowedPaths: ["/solicitudes/rep-audit-1"] },
  { slug: "servicios", path: "/servicios", auth: true, allowedPaths: ["/solicitudes"], captureView: false },
  { slug: "servicios-nueva", path: "/servicios/nueva", auth: true, allowedPaths: ["/solicitudes/nueva?tipo=servicios"] },
  { slug: "servicios-detalle", path: "/servicios/srv-audit-1", auth: true, allowedPaths: ["/solicitudes/srv-audit-1"] },
  { slug: "prevencion", path: "/prevencion", auth: true },
  { slug: "prevencion-nueva", path: "/prevencion/nueva", auth: true },
  { slug: "prevencion-detalle", path: "/prevencion/sst-audit-1", auth: true },
  { slug: "prevencion-campanas", path: "/prevencion/campanas", auth: true },
  { slug: "prevencion-evaluaciones", path: "/prevencion/evaluaciones", auth: true },
  { slug: "prevencion-indicadores", path: "/prevencion/indicadores", auth: true },
  { slug: "prevencion-indicadores-material-ambiental", path: "/prevencion/indicadores-material-ambiental", auth: true },
  { slug: "prevencion-trabajador-detalle", path: "/prevencion/trabajador/worker-audit-1", auth: true },
  { slug: "prevencion-pdtp", path: "/prevencion/pdtp", auth: true },
  { slug: "prevencion-pdtp-detalle", path: "/prevencion/pdtp/prog-audit-1", auth: true },
  { slug: "prevencion-pdtp-editar", path: "/prevencion/pdtp/prog-audit-2/editar", auth: true, notes: "El editor sólo abre programas en borrador; un programa activo redirige a su detalle." },
  { slug: "prevencion-pdtp-editar-activo", path: "/prevencion/pdtp/prog-audit-1/editar", auth: true, allowedPaths: ["/prevencion/pdtp/prog-audit-1"], captureView: false, notes: "Programa activo: la edición redirige al detalle en vez de abrir un editor sin efecto." },
  { slug: "prevencion-pdtp-ejecucion", path: "/prevencion/pdtp/prog-audit-1/ejecucion/exec-audit-1", auth: true },
  { slug: "prevencion-pdtp-reporte", path: "/prevencion/pdtp/prog-audit-1/reporte", auth: true },
  { slug: "prevencion-pdtp-habilitacion", path: "/prevencion/pdtp/prog-audit-1/habilitacion", auth: true, notes: "Qué le falta a cada actividad para poder ejecutarse, con su acción de resolución." },
  { slug: "prevencion-pdtp-acciones", path: "/prevencion/pdtp/acciones", auth: true },
  { slug: "prevencion-pdtp-actividades", path: "/prevencion/pdtp/actividades", auth: true },
  { slug: "prevencion-pdtp-programas", path: "/prevencion/pdtp/programas", auth: true },
  { slug: "prevencion-pdtp-aplicabilidad", path: "/prevencion/pdtp/aplicabilidad", auth: true },
  { slug: "prevencion-pdtp-obligaciones", path: "/prevencion/pdtp/obligaciones", auth: true },
  { slug: "prevencion-pdtp-plantillas", path: "/prevencion/pdtp/plantillas", auth: true },
  { slug: "prevencion-pdtp-nuevo", path: "/prevencion/pdtp/nuevo", auth: true },
  { slug: "prevencion-pdtp-aprobaciones", path: "/prevencion/pdtp/aprobaciones", auth: true },
  { slug: "prevencion-pdtp-cobertura", path: "/prevencion/pdtp/cobertura", auth: true },
  { slug: "prevencion-pdtp-cierres-programa", path: "/prevencion/pdtp/prog-audit-1/cierres", auth: true, notes: "Sin cierres congelados la pantalla muestra su estado vacío, que es lo que ve una faena antes de cerrar su primer mes." },
  /* La entrada de menú no conoce un id: resuelve el programa del año y redirige
     (así lo documenta `pdtp/cierres/page.tsx`). Sin declarar el destino, el
     auto-descubrimiento la capturaba como vista y la corrida marcaba "URL final
     no declarada" produciendo además un PNG idéntico al de su propio destino.
     Se aceptan las dos ramas reales: el programa del año, y el tablero cuando
     el año todavía no tiene programa. */
  { slug: "prevencion-pdtp-cierres", path: "/prevencion/pdtp/cierres", auth: true, allowedPaths: ["/prevencion/pdtp/prog-audit-1/cierres", "/prevencion/pdtp"], captureView: false, notes: "Compatibilidad: entrada de menú que resuelve el programa del año y redirige a sus cierres." },
  /* Declaraba 404 y el detalle responde 200: `[programId]/loading.tsx` abre un
     límite de Suspense, así que el shell se envía con 200 y el `notFound()` del
     cierre inexistente recién se resuelve al streamear. El estado dejó de ser
     demostrable como 404 sin falsear la evidencia, y la fila sigue sin poder
     sembrarse (snapshot_json lo produce closePdtpPeriod, no un INSERT). */
  { slug: "prevencion-pdtp-cierre-detalle", path: "/prevencion/pdtp/prog-audit-1/cierres/closure-audit-1", auth: true, captureView: false, notes: "Fixture pendiente: la foto de un cierre no se puede sembrar con un INSERT (snapshot_json lo produce closePdtpPeriod a partir del RE-36, los indicadores y el reporte de gestión). Sin esa fila se renderiza el not-found dentro del segmento que streamea, con estado 200." },
  { slug: "prevencion-capa", path: "/prevencion/capa", auth: true },
  { slug: "prevencion-capa-detalle", path: "/prevencion/capa/capa-audit-1", auth: true },
  { slug: "prevencion-incidentes", path: "/prevencion/incidentes", auth: true },
  { slug: "prevencion-incidentes-reportar", path: "/prevencion/incidentes/reportar", auth: true },
  { slug: "prevencion-incidentes-detalle", path: "/prevencion/incidentes/inc-audit-1", auth: true },
  { slug: "prevencion-incidentes-procedimiento", path: "/prevencion/incidentes/inc-audit-1/procedimiento", auth: true, expectedStatus: 404, captureView: false, notes: "No existe página App Router para este subpath: la investigación RE-20 se gestiona dentro del detalle canónico del incidente." },
  { slug: "prevencion-miper", path: "/prevencion/miper", auth: true },
  { slug: "prevencion-miper-control", path: "/prevencion/miper/controles/risk-control-audit-1", auth: true },
  { slug: "prevencion-miper-mapa", path: "/prevencion/miper/mapa", auth: true, notes: "Mapa de riesgos: instrumento propio del DS 44 art. 62, ya no una pestaña de la MIPER." },
  { slug: "prevencion-requisitos-legales", path: "/prevencion/requisitos-legales", auth: true },
  { slug: "prevencion-requisito-legal", path: "/prevencion/requisitos-legales/legal-requirement-audit-1", auth: true },
  { slug: "prevencion-privacidad", path: "/prevencion/privacidad", auth: true },
  { slug: "prevencion-privacidad-auditoria", path: "/prevencion/privacidad/auditoria", auth: true },
  { slug: "prevencion-privacidad-solicitudes", path: "/prevencion/privacidad/solicitudes", auth: true },
  { slug: "prevencion-privacidad-solicitud", path: "/prevencion/privacidad/solicitudes/privacy-request-audit-1", auth: true },
  // ── Prevención: capacidades P1 implementadas el 19-07-2026 ──
  { slug: "prevencion-capacitacion", path: "/prevencion/capacitacion", auth: true },
  { slug: "prevencion-permisos", path: "/prevencion/permisos", auth: true },
  { slug: "prevencion-permiso-detalle", path: "/prevencion/permisos/permit-audit-1", auth: true },
  { slug: "prevencion-inspecciones", path: "/prevencion/inspecciones", auth: true },
  { slug: "prevencion-inspecciones-plantillas", path: "/prevencion/inspecciones/plantillas", auth: true, notes: "Qué se pregunta. Incluye la auditoría del SGSST (DS 44 art. 22 n°4) como un kind más." },
  { slug: "prevencion-inspecciones-programacion", path: "/prevencion/inspecciones/programacion", auth: true, notes: "Cuándo se pregunta: de acá nacen las inspecciones planificadas." },
  { slug: "prevencion-inspecciones-seguimiento", path: "/prevencion/inspecciones/seguimiento", auth: true, notes: "Anexo 15 derivado de hallazgos, CAPA y seguimientos; no mantiene una base paralela." },
  { slug: "prevencion-inspeccion-detalle", path: "/prevencion/inspecciones/insp-audit-1", auth: true },
  { slug: "prevencion-inspeccion-en-curso", path: "/prevencion/inspecciones/insp-audit-progress", auth: true, notes: "Ejecución en terreno parcialmente respondida: progreso obligatorio, guardado y continuidad." },
  { slug: "prevencion-inspeccion-reporte-equipos", path: "/prevencion/inspecciones/insp-audit-equipment-report", auth: true, notes: "Transcripción de Reporte de Equipos con la planilla física visible junto al formulario." },
  { slug: "prevencion-inspeccion-print", path: "/prevencion/inspecciones/insp-audit-1/print", auth: true, notes: "Acta A4 de la ejecución; el export Excel es agregado y en fiscalización se pide esta." },
  { slug: "prevencion-cphs", path: "/prevencion/cphs", auth: true },
  { slug: "prevencion-cphs-comite-detalle", path: "/prevencion/cphs/comite-audit-1", auth: true },
  { slug: "prevencion-cphs-programa", path: "/prevencion/cphs/comite-audit-1/programa", auth: true },
  { slug: "prevencion-cphs-certificacion", path: "/prevencion/cphs/comite-audit-1/certificacion", auth: true },
  { slug: "prevencion-faenas", path: "/prevencion/faenas", auth: true, notes: "Estructura preventiva por faena (órgano exigible según dotación)." },
  { slug: "prevencion-faenas-detalle", path: "/prevencion/faenas/ws-audit-1", auth: true },
  { slug: "prevencion-higiene", path: "/prevencion/higiene", auth: true },
  { slug: "prevencion-higiene-grupo-detalle", path: "/prevencion/higiene/grupos/grupo-audit-1", auth: true },
  { slug: "prevencion-higiene-programa-detalle", path: "/prevencion/higiene/programas/programa-audit-1", auth: true },
  { slug: "prevencion-emergencias", path: "/prevencion/emergencias", auth: true },
  { slug: "prevencion-emergencias-plan-detalle", path: "/prevencion/emergencias/plan-audit-1", auth: true },
  { slug: "prevencion-coordinacion", path: "/prevencion/coordinacion", auth: true, notes: "Visitas, fiscalizaciones y coordinación del DS 44 art. 20." },
  { slug: "prevencion-coordinacion-detalle", path: "/prevencion/coordinacion/eng-audit-1", auth: true },
  { slug: "prevencion-gestion-cambio", path: "/prevencion/gestion-cambio", auth: true },
  { slug: "prevencion-gestion-cambio-detalle", path: "/prevencion/gestion-cambio/cambio-audit-1", auth: true },
  { slug: "prevencion-epp-preventivo", path: "/prevencion/epp-preventivo", auth: true },
  { slug: "prevencion-documentacion", path: "/prevencion/documentacion", auth: true },
  { slug: "prevencion-documentacion-detalle", path: "/prevencion/documentacion/doc-audit-1", auth: true },
  { slug: "prevencion-documentacion-nuevo", path: "/prevencion/documentacion/nuevo", auth: true, allowedPaths: ["/prevencion/documentacion"], captureView: false },
  { slug: "prevencion-documentacion-papelera", path: "/prevencion/documentacion/papelera", auth: true },
  { slug: "prevencion-documentacion-revisiones", path: "/prevencion/documentacion/revisiones", auth: true, allowedPaths: ["/prevencion/documentacion"], captureView: false },
  { slug: "prevencion-documentacion-vencimientos", path: "/prevencion/documentacion/vencimientos", auth: true, allowedPaths: ["/prevencion/documentacion"], captureView: false },
  { slug: "prevencion-documentacion-regularizacion", path: "/prevencion/documentacion/regularizacion", auth: true },
  // ── Prevención: G14/G15/G17 (septiembre 2026) ──────────────────────────
  // Igual que los submódulos TI: explícitos para anclarlos a sus fixtures y
  // a esta lista, no a una entrada genérica de auto-descubrimiento.
  { slug: "prevencion-alcotest", path: "/prevencion/alcotest", auth: true, notes: "Controles de alcotest (G14, DO-48): registros por turno, envío mensual del lote y alcotómetros." },
  { slug: "prevencion-cgrd", path: "/prevencion/cgrd", auth: true, notes: "CGRD (G15, DS 44): comité o coordinador por dotación, matriz GRD y actas con acuerdos derivados a CAPA." },
  { slug: "prevencion-constancias", path: "/prevencion/constancias", auth: true, notes: "Constancias del Programa de Trabajo Preventivo (G17): deuda por (actividad, faena) del primer mes impago." },
  { slug: "sst-print", path: "/sst/sst-audit-1/print", auth: true },
  { slug: "ppa-form", path: "/ppa", auth: false },
  { slug: "ppa-result", path: "/ppa/result/capture-ppa-token", auth: false },
  // INC-001 / CAP-002 / PER-002: el acuse y el reporte sin cuenta son públicos y
  // dinámicos; sin un destino declarado el inventario no puede capturarlos y
  // `capture-all-routes` los reclama como patrón sin fixture.
  { slug: "acuse-publico", path: "/acuse/capacitacion/capture-ack-target/capture-ack-token", auth: false },
  { slug: "tae-form", path: "/tae", auth: false },
  { slug: "tae-access", path: "/tae/access/capture-tae-token", auth: false },
  { slug: "tae-resultado", path: "/tae/resultado/capture-tae-result-token", auth: false },
  { slug: "prevencion-ppa", path: "/prevencion/ppa", auth: true },
  { slug: "prevencion-ppa-detalle", path: "/prevencion/ppa/ppa-audit-1", auth: true },
  { slug: "admin", path: "/admin", auth: true },
  { slug: "admin-almacenamiento", path: "/admin/almacenamiento", auth: true, notes: "Backend de la biblioteca SST (filesystem o Cloudreve) y credenciales WebDAV." },
  { slug: "admin-auditoria", path: "/admin/auditoria", auth: true },
  { slug: "admin-catalogos-productos", path: "/admin/catalogos-productos", auth: true },
  { slug: "admin-centros-costo", path: "/admin/centros-costo", auth: true },
  { slug: "admin-configuracion", path: "/admin/configuracion", auth: true },
  { slug: "admin-correo-smtp", path: "/admin/correo-smtp", auth: true },
  { slug: "admin-dte", path: "/admin/dte", auth: true, notes: "Credenciales del portal DTE e historial de corridas." },
  { slug: "admin-equipos", path: "/admin/equipos", auth: true },
  { slug: "admin-inventario-faena", path: "/admin/inventario-faena", auth: true, notes: "Padrón físico por faena (extintores, kits). Prevención lo consume; el alta y la carga masiva viven acá." },
  { slug: "admin-contenedores", path: "/admin/contenedores", auth: true, notes: "Catálogo de contenedores por faena. Es el sujeto que exige la inspección del Anexo 14." },
  { slug: "admin-contenedores-detalle", path: "/admin/contenedores/container-audit-1", auth: true, notes: "Ficha de un contenedor: faena, ubicación, estado e historial de inspecciones." },
  { slug: "admin-inventario-faena-detalle", path: "/admin/inventario-faena/inventory-audit-1", auth: true, notes: "Ficha de un extintor del padrón: ubicación, vigencias, asignaciones e historial." },
  { slug: "admin-equipo-detalle", path: "/admin/equipos/equip-audit-1", auth: true, notes: "Ficha del instrumento con su historial de intervenciones." },
  { slug: "admin-faenas", path: "/admin/faenas", auth: true },
  { slug: "admin-flotas-catalogos", path: "/admin/flota-catalogos", auth: true },
  { slug: "admin-flota-vehiculos", path: "/admin/flota-catalogos/vehiculos", auth: true },
  { slug: "admin-flota-tipos-equipo", path: "/admin/flota-catalogos/tipos-equipo", auth: true },
  { slug: "admin-flota-productos-combustible", path: "/admin/flota-catalogos/productos-combustible", auth: true },
  { slug: "admin-flota-estanques-combustible", path: "/admin/flota-catalogos/estanques-combustible", auth: true },
  { slug: "admin-flota-proveedores-combustible", path: "/admin/flota-catalogos/proveedores-combustible", auth: true },
  { slug: "admin-folios", path: "/admin/folios", auth: true },
  { slug: "admin-notificaciones", path: "/admin/notificaciones", auth: true },
  { slug: "admin-parametros-operativos", path: "/admin/parametros-operativos", auth: true },
  { slug: "admin-pdtp-catalogos", path: "/admin/pdtp-catalogos", auth: true },
  { slug: "admin-plantillas", path: "/admin/plantillas", auth: true },
  { slug: "admin-productos", path: "/admin/productos", auth: true },
  { slug: "admin-epps", path: "/admin/epps", auth: true },
  { slug: "admin-productos-nuevo", path: "/admin/productos/nuevo", auth: true },
  { slug: "admin-productos-detalle", path: "/admin/productos/prod-audit-1", auth: true, notes: "Detalle propio del producto: ya no redirige al listado." },
  { slug: "admin-productos-importar", path: "/admin/productos/importar/batch-audit-1", auth: true, notes: "Vista de revisión de lotes EPP importados." },
  { slug: "admin-proveedores", path: "/admin/proveedores", auth: true },
  {
    slug: "admin-roles",
    path: "/admin/roles",
    auth: true,
    modals: [
      { slug: "nuevo-rol", triggerSelector: 'button:has-text("Nuevo")', notes: "Modal de creación de rol" },
    ],
  },
  { slug: "admin-modulos", path: "/admin/modulos", auth: true },
  { slug: "admin-desviaciones", path: "/admin/desviaciones", auth: true },
  { slug: "admin-seguridad", path: "/admin/seguridad", auth: true },
  { slug: "admin-suplencias", path: "/admin/suplencias", auth: true },
  { slug: "admin-taxonomia-sst", path: "/admin/taxonomia-sst", auth: true },
  { slug: "admin-trabajadores", path: "/admin/trabajadores", auth: true },
  {
    slug: "admin-usuarios",
    path: "/admin/usuarios",
    auth: true,
    modals: [
      { slug: "invitar-usuario", triggerSelector: 'button:has-text("Invitar")', notes: "Diálogo de invitación de usuario" },
    ],
  },
  { slug: "admin-backups", path: "/admin/backups", auth: true },
  { slug: "forbidden", path: "/forbidden", auth: true },
  { slug: "modulo-inactivo", path: "/modulo-inactivo", auth: true },
  { slug: "soporte", path: "/soporte", auth: true },
  { slug: "soporte-nuevo", path: "/soporte/nuevo", auth: true },
  { slug: "soporte-detalle", path: "/soporte/sop-audit-1", auth: true },
]

const seedCoverage: CaptureSeedArea[] = [
  { section: "dashboard", fixtures: ["tareas pendientes", "métricas por faena", "actividad reciente"] },
  { section: "solicitudes", fixtures: ["solicitud EPP enviada", "solicitud pendiente de aprobación", "solicitud recibida para entrega"] },
  { section: "aprobaciones", fixtures: ["ítems requested en cola de aprobación"] },
  { section: "compras", fixtures: ["OC enviada", "OC recibida parcialmente", "factura asociada", "ítems aprobados sin OC"] },
  { section: "recepcion", fixtures: ["OC pendiente de recepción", "OC con brecha oficina-faena"] },
  { section: "bodega", fixtures: ["stock con mínimo crítico", "kardex ingreso OC", "kardex entrega a trabajador", "guía de despacho interna despachada con sus dos patas de kardex", "guía de despacho interna en borrador"] },
  { section: "entregas", fixtures: ["trabajadores activos", "EPP recibido pendiente de entrega", "historial de entregas"] },
  { section: "trazabilidad", fixtures: ["ítems aprobados", "ítems en OC", "ítems recibidos", "alerta sin OC"] },
  { section: "reportes", fixtures: ["solicitudes", "ítems", "OC", "recepciones", "estados variados"] },
  { section: "facturacion", fixtures: ["cliente con contrato mensual y contacto de cobranza", "factura parcialmente pagada con compromiso de pago", "factura pagada", "factura vencida con gestión sin respuesta", "nota de crédito con total negativo", "factura sin vínculo a cliente", "factura de compra", "par candidato a duplicado entre dos fuentes", "propuesta en revisión", "propuesta aprobada con antecedente faltante", "corrida de sincronización exitosa y una fallida"] },
  { section: "dte", fixtures: ["documento conciliado con factura de OC", "documento sin vínculo interno", "nota de crédito recibida", "corrida de sincronización con conciliación parcial"] },
  { section: "analitica", fixtures: ["compras", "combustible", "flota", "stock crítico", "EPP"] },
  { section: "flota", fixtures: ["vehículos activos", "cargas de combustible", "mantenciones"] },
  { section: "mantenciones", fixtures: ["vehículos", "proveedores", "mantenciones registradas"] },
  { section: "ti", fixtures: ["activo asignado con acta de custodia", "ticket TI abierto asociado a activo", "activo disponible con garantía vigente", "activo con garantía vencida y reparación costosa", "garantía por vencer dentro de 30 días", "licencia con asignaciones a trabajador y equipo", "mantención correctiva con costo alto", "mantención preventiva", "baja de activo autorizada", "sistemas de acceso con trabajador activo y suspendido", "checklist de alta con tareas pendientes", "proveedor TI con vínculo de reparación y de venta"] },
  { section: "combustibles", fixtures: ["cargas de combustible", "lote de consumos con registros asociados y sin asociar", "lote de log operacional con faena pendiente de asociar", "carga TAE con resultado público", "lote TAE histórico con carga observada y rechazo", "vehículos de combustible", "proveedores de combustible", "cuentas corrientes", "reportes mensuales"] },
  { section: "repuestos", fixtures: ["solicitud de repuestos", "ítem libre", "cotización pendiente"] },
  { section: "servicios", fixtures: ["solicitud de servicios", "ítem libre", "cotización pendiente"] },
  { section: "prevencion", fixtures: ["fiscalización de la Dirección del Trabajo con medida prescrita", "coordinación de información entregada al mandante", "evaluación nueva", "evaluación seguimiento", "plan de acción", "acción CAPA en progreso con evidencia y seguimiento", "requisito legal publicado con aplicabilidad por faena", "solicitud de privacidad con identidad verificada", "incidente en investigación con evidencia y difusión RE-20", "inspección revisada con hallazgo CAPA", "inspección en curso con respuestas parciales", "Reporte de Equipos en transcripción con planilla física", "ejecución PDTP aprobada con checklist y plan de acción", "gestión de cambio evaluada con CAPA", "plan de emergencia con simulacro y roles", "permiso activo con AST, medición y aislamiento", "comité CPHS paritario con acta", "grupo de exposición con medición", "programa de vigilancia con matrículas", "documento vigente distribuido con acuse", "control MIPER crítico verificado", "indicadores mensuales de seguridad y salud en el trabajo", "indicadores material y ambiental", "control de alcotest negativo con equipo y envío mensual del lote DO-48", "coordinador GRD en faena chica y comité GRD con matriz publicada y acta cerrada", "actividad de constancia PDTP planificada sin ejecución (deuda abierta)"] },
  { section: "admin-faenas", fixtures: ["faenas activas", "faena que representa la bodega de la oficina central"] },
  { section: "admin-inventario-faena", fixtures: ["extintor operativo con plan de emergencias, asignaciones y eventos", "kit de derrame sin asignar a punto"] },
  { section: "admin-contenedores", fixtures: ["contenedor operativo con inspección ejecutada", "contenedor sin inspecciones"] },
  { section: "admin-equipos", fixtures: ["detector monogás con historial de calibración", "alcotest en otra faena"] },
  { section: "admin-plantillas", fixtures: ["plantillas de correo del sistema"] },
  { section: "admin-productos", fixtures: ["categorías", "productos EPP", "productos insumo", "proveedores preferidos", "lote EPP pendiente de revisión"] },
  { section: "admin-proveedores", fixtures: ["proveedores activos con contacto"] },
  { section: "admin-trabajadores", fixtures: ["trabajadores por faena"] },
  { section: "admin-usuarios", fixtures: ["usuarios con roles y faenas"] },
  { section: "admin-auditoria", fixtures: ["eventos create", "status_change", "update"] },
  { section: "admin-configuracion", fixtures: ["datos empresa", "pie OC", "límite PDF"] },
  { section: "notificaciones", fixtures: ["notificación no leída", "notificación leída"] },
  { section: "soporte", fixtures: ["reporte de soporte abierto con nota de gestión", "reporte resuelto"] },
]

const moduleAliases: Record<string, string[]> = {
  adquisiciones: ["solicitudes", "compras", "recepcion"],
  compras: ["solicitudes", "compras", "recepcion"],
  sst: ["prevencion"],
  prevencion: ["prevencion"],
  "inspecciones-evidencia": ["prevencion-inspeccion-en-curso", "prevencion-inspeccion-reporte-equipos"],
  combustible: ["combustibles"],
  combustibles: ["combustibles"],
  inventario: ["bodega", "entregas", "trazabilidad"],
  // Las dos pantallas del portal DTE viven en módulos distintos; sin este alias
  // `--module dte` no devolvía ninguna ruta.
  dte: ["compras-dte", "admin-dte"],
  guias: ["bodega-guia"],
  facturacion: ["facturacion"],
  // El monitoreo GPS de Entel OnWay es un subpath de Flota pero su ciclo de
  // auditoría es propio; ofrecerlo por nombre evita que un cambio allí pase
  // inadvertido al filtrar `--module flota`.
  monitoreo: ["flota-monitoreo"],
}

export type CaptureRouteInventory = {
  discovered: DiscoveredRoutePattern[]
  routes: RouteTarget[]
  autoDiscovered: RouteTarget[]
  unresolvedDynamicPatterns: DiscoveredRoutePattern[]
}

let captureRouteInventoryCache: CaptureRouteInventory | undefined

function pathnameOf(routePath: string) {
  return new URL(routePath, "http://capture-route").pathname
}

function routePatternToSlug(pattern: string) {
  if (pattern === "/") return "home"
  return pattern
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.startsWith("[") ? segment.slice(1, -1) : segment)
    .join("-")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "home"
}

function routeMatchesModuleFilter(pathOrSlug: string, filter: string | undefined) {
  if (!filter) return true
  const allowedPrefixes = moduleAliases[filter] ?? [filter]
  return allowedPrefixes.some((prefix) => pathOrSlug.startsWith(prefix))
}

function patternMatchesAnyRoute(pattern: DiscoveredRoutePattern, routes: readonly RouteTarget[]) {
  return routes.some((route) => routePatternMatches(pattern.pattern, pathnameOf(route.path)))
}

/**
 * Adds capture targets for static pages that are not represented by a manual
 * target. Query variants, dynamic fixtures and interaction scenarios remain
 * explicit because they carry business-state intent that the filesystem
 * cannot infer.
 */
export function createDiscoveredCaptureRoutes(
  patterns: readonly DiscoveredRoutePattern[],
  declaredRoutes: readonly RouteTarget[],
): RouteTarget[] {
  const usedSlugs = new Set(declaredRoutes.map((route) => route.slug))
  const discovered: RouteTarget[] = []

  for (const pattern of patterns) {
    if (pattern.dynamic || patternMatchesAnyRoute(pattern, declaredRoutes)) continue

    const baseSlug = routePatternToSlug(pattern.pattern)
    let slug = baseSlug
    let suffix = 2
    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${suffix}`
      suffix += 1
    }
    usedSlugs.add(slug)
    discovered.push({
      slug,
      path: pattern.pattern,
      auth: pattern.auth,
      source: "filesystem",
      notes: `Ruta descubierta automáticamente desde ${pattern.source}.`,
    })
  }

  return discovered
}

/**
 * Builds the complete route inventory. `unresolvedDynamicPatterns` is kept
 * separate from automatic targets so a new `[id]` page cannot silently become
 * a capture of a made-up record.
 */
function buildCaptureRouteInventory(): CaptureRouteInventory {
  const discovered = discoverRoutePatterns(path.join(root, "app"))
  const declaredRoutes = routeTargets.map((route) => ({ ...route }))
  const autoDiscovered = createDiscoveredCaptureRoutes(discovered, declaredRoutes)
  const allRoutes = [...declaredRoutes, ...autoDiscovered]
  const unresolvedDynamicPatterns = discovered.filter((pattern) =>
    pattern.dynamic
    && !patternMatchesAnyRoute(pattern, allRoutes)
  )

  return { discovered, routes: allRoutes, autoDiscovered, unresolvedDynamicPatterns }
}

export function getCaptureRouteInventory(filter?: string): CaptureRouteInventory {
  const inventory = captureRouteInventoryCache ??= buildCaptureRouteInventory()
  if (!filter) return inventory

  return {
    ...inventory,
    routes: inventory.routes.filter((route) => routeMatchesModuleFilter(route.slug, filter)),
    autoDiscovered: inventory.autoDiscovered.filter((route) => routeMatchesModuleFilter(route.slug, filter)),
    unresolvedDynamicPatterns: inventory.unresolvedDynamicPatterns.filter((pattern) =>
      routeMatchesModuleFilter(routePatternToSlug(pattern.pattern), filter),
    ),
  }
}

export function getCaptureRoutes(filter?: string) {
  return getCaptureRouteInventory(filter).routes
}

export function getCaptureSeedCoverage() {
  return seedCoverage.map((area) => ({ ...area, fixtures: [...area.fixtures] }))
}

export type CaptureArtifactReconciliation = {
  invalidResults: string[]
  missingFiles: string[]
  orphanFiles: string[]
  /** PNGs más antiguos que el inicio de la corrida en directorios heredados (no fallan el gate). */
  staleFiles: string[]
  duplicateReferences: string[]
  duplicateHashes: Array<{ hash: string; screenshots: string[] }>
  /** Mismo hash en rutas distintas: informativo, no rompe el gate. */
  sharedHashes: Array<{ hash: string; screenshots: string[] }>
}

/** Elimina capturas y manifest previos para que cada corrida sobrescriba su carpeta (C3). */
export function cleanOutputDir(directory: string) {
  if (!fs.existsSync(directory)) return
  const entries = fs.readdirSync(directory)
  for (const entry of entries) {
    if (entry.endsWith(".png") || entry === "manifest.json") {
      fs.rmSync(path.join(directory, entry), { force: true })
    }
  }
}

/** Keep the manifest and the actual directory as one auditable contract. */
export function reconcileCaptureArtifacts(
  directory: string,
  results: readonly CaptureResult[],
  options: { runStartedAt?: number } = {},
): CaptureArtifactReconciliation {
  const references = results.map((result) => result.screenshot).filter(Boolean)
  const referenceCounts = new Map<string, number>()
  for (const reference of references) {
    referenceCounts.set(reference, (referenceCounts.get(reference) ?? 0) + 1)
  }

  const files = fs.existsSync(directory)
    ? fs.readdirSync(directory).filter((entry) => entry.endsWith(".png")).map((entry) => path.join(directory, entry))
    : []
  const referenced = new Set(references)
  const hashes = new Map<string, string[]>()
  for (const result of results) {
    if (!result.screenshot || !result.screenshotHash) continue
    const group = hashes.get(result.screenshotHash) ?? []
    group.push(result.screenshot)
    hashes.set(result.screenshotHash, group)
  }

  // F4: en directorios heredados (CAPTURE_OUTPUT_DIR apuntando a una carpeta
  // con capturas previas) un PNG anterior al inicio de la corrida es evidencia
  // antigua, no un huérfano de esta corrida: se reporta como `staleFiles` sin
  // romper el gate. Con Fase 3 (limpieza previa) esto es redundante en el
  // flujo normal, pero protege los casos donde la carpeta no se puede limpiar.
  const runStartedAt = options.runStartedAt
  const orphanFiles: string[] = []
  const staleFiles: string[] = []
  for (const file of files) {
    const relative = path.relative(root, file)
    if (referenced.has(relative)) continue
    if (runStartedAt !== undefined) {
      const stat = fs.statSync(file)
      if (stat.mtimeMs < runStartedAt) {
        staleFiles.push(relative)
        continue
      }
    }
    orphanFiles.push(relative)
  }

  return {
    invalidResults: results.filter((result) => !result.ok).map((result) => result.slug),
    missingFiles: references.filter((reference) => !fs.existsSync(path.join(root, reference))),
    orphanFiles,
    staleFiles,
    duplicateReferences: [...referenceCounts.entries()].filter(([, count]) => count > 1).map(([reference]) => reference),
    /*
     * Un hash repetido **dentro de la misma ruta y viewport** significa que algo
     * no ocurrió: la captura del modal es la página sin modal, o dos barridos
     * fotografiaron el mismo control. Eso es evidencia falsa y rompe el gate.
     *
     * Entre rutas distintas la excepción es **estrecha a propósito**: sólo vale
     * para capturas de interacción, donde dos pantallas pueden compartir un
     * diálogo a pantalla completa —el selector de fecha de Repuestos y el de
     * Servicios son el mismo componente— y ambas evidencias son ciertas.
     *
     * Dos capturas **de ruta base** idénticas nunca son benignas, y esta regla
     * casi las deja pasar: una corrida contra un build a medias produjo 90
     * pantallas de error con el mismo hash, y una excepción más ancha las
     * habría absorbido como "componente compartido". El gate está para eso.
     */
    duplicateHashes: [...hashes.entries()]
      .filter(([, shots]) => shots.length > 1 && !(shots.every(isInteractionCapture) && new Set(shots.map(captureScope)).size > 1))
      .map(([hash, screenshots]) => ({ hash, screenshots })),
    sharedHashes: [...hashes.entries()]
      .filter(([, shots]) => shots.length > 1 && shots.every(isInteractionCapture) && new Set(shots.map(captureScope)).size > 1)
      .map(([hash, screenshots]) => ({ hash, screenshots })),
  }
}

/**
 * Resuelve cuando el navegador deja de responder (o de inmediato si ya no está).
 *
 * Existe porque una corrida puede perder el proceso de Chromium a mitad de
 * camino —el 2026-09-16 murió en la ruta 11 de 242 por agotamiento de recursos—
 * y sin esta señal las llamadas de Playwright que ya estaban en vuelo pueden no
 * resolverse nunca: la corrida quedaba colgada antes de escribir el manifest,
 * que es el peor final posible, porque se pierden las rutas restantes y ni
 * siquiera queda escrito por qué.
 */
function browserDisconnected(browser: Browser | null): Promise<void> {
  if (!browser || !browser.isConnected()) return Promise.resolve()
  return new Promise((resolve) => {
    browser.once("disconnected", () => resolve())
  })
}

/** Espera acotada: para cierres que, contra un navegador muerto, no vuelven. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Resultado de una ruta que no se pudo capturar. Tenerlo en un solo lugar evita
 * que los dos caminos que llegan acá —la navegación falló, o la ruta se quedó
 * sin resultado porque el navegador murió antes de despacharla— inventen formas
 * distintas para el mismo hecho.
 */
function failedCaptureResult({
  viewport,
  route,
  requestedUrl,
  relativeScreenshot,
  error,
}: {
  viewport: string
  route: RouteTarget
  requestedUrl: string
  relativeScreenshot: string
  error: string
}): CaptureResult {
  return {
    viewport,
    slug: route.slug,
    path: route.path,
    requestedUrl,
    finalUrl: requestedUrl,
    status: null,
    ok: false,
    state: "capture-invalid",
    screenshot: relativeScreenshot,
    error,
    notes: route.notes,
  }
}

/**
 * Declara como fallo toda ruta del viewport que no tenga resultado propio y
 * devuelve lo declarado.
 *
 * Es el único cierre honesto cuando el navegador se cae a mitad de camino: el
 * manifest queda diciendo exactamente qué no se cubrió. La alternativa —dejar
 * esas rutas fuera de los resultados— hace que la corrida se lea como más corta
 * de lo que era, y el gate de integridad no puede distinguir "no se intentó" de
 * "no existía", que es convertir un hueco de cobertura en un éxito silencioso.
 *
 * Exportada (como `resolveServerLaunch`) para poder fijar ese invariante en las
 * pruebas sin levantar un navegador.
 */
export function declareUncoveredRoutes(
  results: CaptureResult[],
  viewport: string,
  routes: RouteTarget[],
  serverBaseUrl: string,
  reason: string,
): CaptureResult[] {
  const recorded = new Set(results.map((result) => `${result.viewport}|${result.slug}`))
  const uncovered = routes.filter((route) => !recorded.has(`${viewport}|${route.slug}`))
  if (uncovered.length === 0) return []

  console.warn(`  ⚠ ${viewport}: ${uncovered.length} ruta(s) sin capturar (${reason}); se declaran como fallo en el manifest`)
  const declared = uncovered.map((route) => failedCaptureResult({
    viewport,
    route,
    requestedUrl: `${serverBaseUrl}${route.path}`,
    relativeScreenshot: path.join(outputDir, `${viewport}-${route.slug}.png`),
    error: `Sin capturar: ${reason}`,
  }))
  results.push(...declared)
  return declared
}

/**
 * Captura rutas en paralelo usando un pool de workers que comparten una cola.
 * Cada worker toma la siguiente ruta disponible (índice atómico en JS
 * single-threaded), ejecuta captureRoute y almacena el resultado en la
 * posición original para mantener el orden. El factor limitante es el
 * servidor Next.js (monoproceso); 4-8 workers son óptimos localmente.
 * La concurrencia se configura con CAPTURE_CONCURRENCY (default 4).
 *
 * El default es 4, no 8: con dos viewports simultáneos, 8 workers por viewport
 * son 16 pestañas de tablas anchas capturadas a página completa, y en esta
 * máquina eso agota los recursos del renderer. Medido el 2026-09-16 con el
 * módulo `ti` corrido dos veces seguidas sobre el mismo build: con 8 fallaron
 * 11 de las 26 rutas (`Page crashed`, `net::ERR_INSUFFICIENT_RESOURCES` y el
 * navegador cerrándose a mitad de corrida), y con 4 las 26 rutas más sus 28
 * capturas de interacción cerraron sin un solo fallo. Subirlo es válido en un
 * host dedicado, pero hay que medirlo.
 */
async function captureRouteBatch(
  context: BrowserContext,
  viewport: string,
  routes: RouteTarget[],
  concurrency: number = Number(process.env.CAPTURE_CONCURRENCY) || 4,
  serverBaseUrl: string = baseUrl,
): Promise<CaptureResult[]> {
  if (routes.length === 0) return []

  const total = routes.length
  const results: CaptureResult[] = []
  let nextIndex = 0
  let completedCount = 0
  let errorCount = 0
  const startTime = Date.now()
  const browserLost = browserDisconnected(context.browser())

  async function worker() {
    while (nextIndex < routes.length) {
      const idx = nextIndex++
      const routeStart = Date.now()
      // La carrera es contra la muerte del navegador, no contra un reloj: una
      // ruta lenta (un print que renderiza PDF, un tablero pesado) es legítima,
      // pero una llamada contra un navegador que ya no existe no tiene por qué
      // resolverse nunca.
      const routeResults = await Promise.race([
        captureRoute(context, viewport, routes[idx]!, serverBaseUrl),
        browserLost.then(() => null),
      ])
      if (routeResults === null) return
      const routeMs = Date.now() - routeStart
      results.push(...routeResults)
      completedCount++
      const hasError = routeResults.some((r) => !r.ok)
      if (hasError) errorCount++
      const mainResult = routeResults[0] ?? { slug: routes[idx]!.slug, ok: false, status: null }
      writeProgress(completedCount, total, `${viewport}-${mainResult.slug}`, !hasError, mainResult.status, startTime, routeMs)
    }
  }

  const poolSize = Math.min(concurrency, routes.length)
  await Promise.all(Array.from({ length: poolSize }, () => worker()))

  // Red de seguridad: si el navegador murió, las rutas que estaban en vuelo se
  // abandonaron arriba y las que nunca se despacharon no produjeron nada. Se
  // declaran para que el manifest diga qué quedó sin cubrir.
  errorCount += declareUncoveredRoutes(
    results,
    viewport,
    routes,
    serverBaseUrl,
    "el navegador se cerró durante la corrida",
  ).length

  finalizeProgress(total, errorCount)
  return results
}

async function main() {
  const captureDbUrl = requireCaptureDatabaseUrl()
  const routeInventory = getCaptureRouteInventory(moduleFilter)
  const routes = routeInventory.routes

  discoveredNavigationSources.clear()

  // F4: marca el inicio de la corrida ANTES de limpiar y capturar, para que la
  // reconciliación distinga PNG heredados (más viejos que este instante) de
  // huérfanos reales de la corrida actual.
  const runStartedAt = Date.now()

  if (moduleFilter) {
    console.log(`📷 Módulo filtrado: "${moduleFilter}" → ${routes.length} rutas específicas`)
  } else {
    console.log(`📷 Capturando todas las rutas (${routes.length} total)`)
  }
  if (routeInventory.autoDiscovered.length > 0) {
    console.log(`🧭 ${routeInventory.autoDiscovered.length} ruta(s) estática(s) descubierta(s) desde app/`)
  }
  if (routeInventory.unresolvedDynamicPatterns.length > 0) {
    console.warn(`⚠ ${routeInventory.unresolvedDynamicPatterns.length} ruta(s) dinámica(s) necesitan un fixture explícito`)
    for (const pattern of routeInventory.unresolvedDynamicPatterns) {
      console.warn(`   ${pattern.pattern} ← ${pattern.source}`)
    }
  }
  if (viewportFilter) {
    console.log(`📐 Viewport filtrado: "${viewportFilter}"`)
  }

  // ── Preparar directorio de salida ──
  // Toda corrida (filtrada o completa) sobrescribe su carpeta: se eliminan
  // los .png y manifest.json previos al empezar. Antes esto sólo ocurría con
  // filtro de módulo; en corridas completas el directorio con fecha acumulaba
  // archivos de corridas anteriores del mismo día y el gate de integridad los
  // reportaba como 777 huérfanos (C3).
  cleanOutputDir(outputDir)
  fs.mkdirSync(outputDir, { recursive: true })

  await runWithSpinner("Preparando base de datos (reset → migraciones → fixtures)", () => prepareDatabase(captureDbUrl))

  const viewports = (
    viewportFilter && viewportFilter in SELECTABLE_VIEWPORTS
      ? [SELECTABLE_VIEWPORTS[viewportFilter as keyof typeof SELECTABLE_VIEWPORTS]]
      : [desktop, mobile]
  )

  // ── Paralelizar viewports:2 servidores en puertos distintos ──
  // Cuando hay más de1 viewport, lanzamos un servidor por viewport
  // para que desktop y mobile corran simultáneamente.
  const needsParallel = viewports.length > 1
  const useProductionServer = shouldUseProductionCaptureServer(needsParallel)
  // C1: los servidores paralelos deben servirse desde un build de producción;
  // dos `next dev` sobre el mismo `.next` se pisan (chunks text/plain → 500
  // en rutas autenticadas). Con un solo viewport `next dev` es seguro.
  if (useProductionServer) {
    await ensureProductionBuild(captureDbUrl)
  }
  const serverPortBase = port
  const results: CaptureResult[] = []
  const serversToStop: ChildProcess[] = []

  const serverInfos = await Promise.all(
    viewports.map((vp, idx) =>
      startServer(captureDbUrl, needsParallel ? serverPortBase + idx : serverPortBase, useProductionServer)
    )
  )
  serversToStop.push(...serverInfos.map((s) => s.server))

  const browser = await chromium.launch()
  const browserLost = browserDisconnected(browser)

  try {
    const viewportTasks = viewports.map((viewport, vpIdx) => {
      const serverBaseUrl = serverInfos[vpIdx]!.serverBaseUrl
      return (async () => {
        let context: BrowserContext
        try {
          context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: 1,
            locale: "es-CL",
          })
        } catch (error) {
          // El navegador puede morir antes de abrir el contexto (o el host quedar
          // sin recursos para uno nuevo). Se declara la vista completa sin
          // capturar en vez de terminar la corrida sin manifest.
          const reason = error instanceof Error ? error.message : String(error)
          declareUncoveredRoutes(results, viewport.name, routes, serverBaseUrl, `no se pudo abrir un contexto del navegador: ${reason}`)
          return
        }

        const nonAuthRoutes = routes.filter((r) => !r.auth)
        if (nonAuthRoutes.length > 0) {
          const nonAuthResults = await captureRouteBatch(context, viewport.name, nonAuthRoutes, undefined, serverBaseUrl)
          results.push(...nonAuthResults)
        }

        const authRoutes = routes.filter((r) => r.auth)
        if (authRoutes.length > 0) {
          // El login se espera contra la caída del navegador: sin esto, `login`
          // reintenta tres veces contra un navegador que ya no existe y su
          // excepción termina la corrida entera sin manifest. El `.catch` evita
          // el rechazo no manejado cuando la carrera ya se resolvió por caída.
          const loginAttempt = login(context, serverBaseUrl)
          loginAttempt.catch(() => undefined)
          await Promise.race([loginAttempt, browserLost])
          const authResults = await captureRouteBatch(context, viewport.name, authRoutes, undefined, serverBaseUrl)
          results.push(...authResults)
        }

        await context.close().catch(() => undefined)
      })()
    })

    await Promise.all(viewportTasks)
  } finally {
    // Un cierre contra un navegador ya muerto puede no resolverse (el driver de
    // Playwright se queda sin responder): no puede impedir que el manifest se
    // escriba, que es la evidencia de la corrida.
    await Promise.race([browser.close().catch(() => undefined), delay(5_000)])
    await Promise.all(serversToStop.map((s) => stopServer(s)))
  }

  // Se poda antes de reconciliar: una captura retirada no debe contarse como
  // referencia, ni su archivo borrado aparecer como fichero faltante.
  const prunedInteractions = pruneRedundantInteractionCaptures(root, results)
  const artifactReconciliation = reconcileCaptureArtifacts(outputDir, results, { runStartedAt })
  const renderedNavigation = navigationDiscoveryReport(routeInventory.discovered)
  const manifest = {
    generatedAt: new Date().toISOString(),
    runStartedAt: new Date(runStartedAt).toISOString(),
    moduleFilter: moduleFilter ?? null,
    viewportFilter: viewportFilter ?? null,
    baseUrl,
    database: getRedactedDatabaseIdentifier(captureDbUrl),
    outputDir,
    credentials: {
      email: "admin.audit@chome.cl",
      password: "chome2026",
    },
    seedCoverage,
    routeInventory: {
      discovered: routeInventory.discovered,
      autoDiscovered: routeInventory.autoDiscovered,
      unresolvedDynamicPatterns: routeInventory.unresolvedDynamicPatterns,
      renderedNavigation,
      renderedNavigationOutsideApp: renderedNavigation.filter((entry) => !entry.matchesAppRoute),
    },
    horizontalOverflows,
    clientErrors,
    routes,
    results,
    /** Interacciones idénticas a una ruta ya capturada, retiradas por redundantes. */
    prunedInteractions,
    artifactReconciliation,
  }
  fs.writeFileSync(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Screenshots written to ${outputDir}`)
  console.log(`Manifest written to ${path.join(outputDir, "manifest.json")}`)

  if (clientErrors.length > 0) {
    console.error(`\n✖ ${clientErrors.length} ruta(s) con errores de JavaScript en el navegador:`)
    for (const e of clientErrors) {
      console.error(`   ${e.viewport} ${e.slug}`)
      for (const m of e.messages) console.error(`      ${m}`)
    }
    console.error("")
    process.exitCode = 1
  } else {
    console.log("Sin errores de cliente en ninguna ruta ✓")
  }

  if (horizontalOverflows.length > 0) {
    console.error(`\n✖ ${horizontalOverflows.length} ruta(s) con scroll horizontal (WCAG 1.4.10 Reflow):`)
    for (const o of horizontalOverflows) {
      console.error(`   ${o.viewport} ${o.slug}: ${o.scrollWidth}px > ${o.viewportWidth}px`)
      for (const c of o.culprits) console.error(`      ${c}`)
    }
    console.error("")
    process.exitCode = 1
  } else {
    console.log("Sin scroll horizontal en ninguna ruta ✓")
  }

  const artifactIssues = [
    ...artifactReconciliation.invalidResults,
    ...artifactReconciliation.missingFiles,
    ...artifactReconciliation.orphanFiles,
    ...artifactReconciliation.duplicateReferences,
    ...artifactReconciliation.duplicateHashes.map((group) => group.hash),
  ]
  if (artifactIssues.length > 0) {
    console.error(`\n✖ Integridad de capturas: ${artifactIssues.length} problema(s). Revisa artifactReconciliation en el manifest.`)
    process.exitCode = 1
  } else {
    console.log("Integridad de capturas: sin URL inválida, huérfano, referencia o hash duplicado ✓")
  }
  if (routeInventory.unresolvedDynamicPatterns.length > 0) {
    console.error("\n✖ Inventario de rutas: hay páginas dinámicas sin fixture de captura.")
    process.exitCode = 1
  }
  const navigationOutsideInventory = renderedNavigation.filter((entry) => !entry.matchesAppRoute)
  if (navigationOutsideInventory.length > 0) {
    console.warn(`ℹ ${navigationOutsideInventory.length} enlace(s) interno(s) no coinciden con un page.tsx; revisar renderedNavigationOutsideApp en el manifest.`)
  }
  if (prunedInteractions.length > 0) {
    console.warn(`ℹ ${prunedInteractions.length} captura(s) de interacción retiradas por ser idénticas a su ruta canónica: ${prunedInteractions.join(", ")}`)
  }
  if (artifactReconciliation.sharedHashes.length > 0) {
    console.warn(`ℹ ${artifactReconciliation.sharedHashes.length} captura(s) idénticas entre rutas distintas (componente compartido; no afectan el gate).`)
  }
  if (artifactReconciliation.staleFiles.length > 0) {
    console.warn(`ℹ ${artifactReconciliation.staleFiles.length} PNG heredados de una corrida anterior en ${outputDir} (no afectan el gate).`)
  }
}

/**
 * Plain date (America/Santiago) desplazado en meses desde HOY, con día fijo
 * opcional. Los fixtures que representan vigencias —garantías TI, licencias,
 * renovaciones— usan fechas relativas en vez de absolutas para que las
 * ventanas "vigente", "por vencer" y "vencida" existan el día que sea que se
 * corra la captura; una fecha absoluta envejece y la captura deja de mostrar
 * los estados que dice documentar. HOY es el día de Chile, no el del proceso:
 * en producción corre en UTC y preguntarle a UTC qué día es hoy contesta el
 * día siguiente entre las 20:00 y la medianoche chilena.
 */
export function shiftCaptureDateMonths(months: number, day?: number): string {
  const today = chileDateParts()
  const normalized = new Date(Date.UTC(today.year, today.month - 1 + months, 1))
  // Day 0 of (monthIndex + 1) = último día del mes desplazado: una fecha como
  // "hoy + 1 mes, día 31" nunca apunta a un mes inexistente.
  const lastDay = new Date(Date.UTC(normalized.getUTCFullYear(), normalized.getUTCMonth() + 1, 0)).getUTCDate()
  const resolvedDay = Math.min(day ?? today.day, lastDay)
  const m = String(normalized.getUTCMonth() + 1).padStart(2, "0")
  const d = String(resolvedDay).padStart(2, "0")
  return `${normalized.getUTCFullYear()}-${m}-${d}`
}

/**
 * Plain date (America/Santiago) desplazado en días desde HOY. Para ventanas
 * cortas —"vence en 30 días"— donde un desplazamiento en meses puede caer
 * fuera del rango según el día de corrida: +1 mes el día 1º de mes dista 30–31
 * días, pero el día 28 dista 43. Un desplazamiento en días es determinista.
 */
export function shiftCaptureDateDays(days: number): string {
  const today = chileDateParts()
  const shifted = new Date(Date.UTC(today.year, today.month - 1, today.day + days))
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0")
  const d = String(shifted.getUTCDate()).padStart(2, "0")
  return `${shifted.getUTCFullYear()}-${m}-${d}`
}

/**
 * Fixture del acta de entrega de TI: respalda `/ti/asignaciones` y el acta
 * impresa (`/ti/actas/it-assignment-audit-1/print`). El acuse lo registra una
 * persona **distinta** de quien entrega, que es lo que exige TIA-001.
 *
 * Vive exportado, y no escrito en línea en el sembrado, porque su forma la
 * dicta un CHECK de la base: `it_asset_assignments_acceptance_coherent`
 * (migración 0281) sólo admite acuse en un acta 'aceptada' y prohíbe que
 * ninguna otra lo tenga. Mientras el fixture estuvo suelto, el INSERT violó ese
 * CHECK —firmaba el acta con el mismo técnico que la entregaba, dejando
 * `acceptance_status` en su DEFAULT 'pendiente'— y `prepareDatabase` murió
 * antes de la primera captura: la corrida completa no producía ni un PNG ni
 * manifest, y sólo se notaba ejecutándola. `capture-fixtures-pglite.test.ts`
 * inserta este mismo objeto contra las migraciones reales, así que la próxima
 * restricción que lo invalide falla en `npm run test:pglite`.
 */
export function itAssignmentCaptureFixture(input: {
  now: string
  worksiteId: string
  deliveredByUserId: string
}) {
  return {
    id: "it-assignment-audit-1",
    code: "ACT-2026-0001",
    assetId: "it-asset-audit-1",
    workerId: "worker-audit-1",
    worksiteId: input.worksiteId,
    kind: "delivery",
    deliveredAt: input.now,
    deliveredByUserId: input.deliveredByUserId,
    physicalState: "bueno",
    acceptanceStatus: "aceptada",
    acceptedAt: input.now,
    acceptedByUserId: "user-audit-jefa",
    createdAt: input.now,
    updatedAt: input.now,
  }
}

async function prepareDatabase(captureDbUrl: string) {
  assertSafeDestructiveDatabase({
    databaseUrl: captureDbUrl,
    allowDestructiveReset: process.env.CAPTURE_ALLOW_DESTRUCTIVE_RESET === "true",
    context: "CAPTURE",
  })
  await ensureDatabaseExists(captureDbUrl)

  // Reset Postgres schema and re-run migrations for a clean state.
  // Single connection for all three phases (schema reset → migrations →
  // fixtures) instead of three separate clients that each open/close
  // their own connection pool.
  const pgClient = postgres(captureDbUrl, { max: 1 })
  const setupDb = drizzle(pgClient)
  await setupDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
  await setupDb.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
  await setupDb.execute(sql`CREATE SCHEMA public`)
  await setupDb.execute(sql`CREATE SCHEMA drizzle`)
  await setupDb.execute(sql`GRANT ALL ON SCHEMA public TO PUBLIC`)

  await migrate(drizzle(pgClient), { migrationsFolder: path.join(root, "db", "migrations") })

  const db = drizzle(pgClient, { schema })

  const now = new Date("2026-06-09T12:00:00.000Z").toISOString()
  const password = await bcrypt.hash("chome2026", 10)
  const userId = "user-audit-admin"
  const worksiteId = "ws-audit-1"
  const officeWorksiteId = "ws-audit-office"
  const supplierId = "sup-audit-1"
  const productId = "prod-audit-1"
  const deliverableProductId = "prod-audit-3"
  const requestId = "req-audit-1"
  const requestItemId = "req-item-audit-1"
  const pendingRequestId = "req-audit-approval"
  const pendingRequestItemId = "req-item-audit-approval"
  const deliveryRequestId = "req-audit-delivery"
  const deliverableRequestItemId = "req-item-audit-deliverable"
  const orderId = "po-audit-1"
  const orderItemId = "po-item-audit-1"
  const officeOrderId = "po-audit-2"
  const officeOrderItemId = "po-item-audit-2"
  const receiptId = "rec-audit-1"
  const officeReceiptId = "rec-audit-office"
  const deliveryId = "del-audit-1"
  const repuestoRequestId = "rep-audit-1"
  const repuestoItemId = "rep-item-audit-1"
  const serviceRequestId = "srv-audit-1"
  const serviceItemId = "srv-item-audit-1"
  const resetToken = "capture-reset-token"
  const resetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex")

  // El visor de Reporte de Equipos necesita una planilla real servible por la
  // ruta autenticada. Se genera sólo para la base desechable de capturas: el
  // PNG deja visible el documento fuente sin depender de archivos personales
  // ni de un volumen externo.
  const equipmentReportStorageName = "capture-reporte-equipos-03101.png"
  const equipmentReportDir = path.join(resolveCaptureStoragePath(), "inspection-evidence")
  fs.mkdirSync(equipmentReportDir, { recursive: true })
  await sharp(Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
      <rect width="900" height="1200" fill="#e8e5dd"/>
      <rect x="38" y="28" width="824" height="1144" rx="4" fill="#fffefa" stroke="#aaa59b" stroke-width="2"/>
      <text x="70" y="78" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#1f2937">CHOME · CONTROL OPERACIONAL</text>
      <text x="450" y="132" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#111827">REPORTE DE EQUIPOS</text>
      <text x="765" y="76" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="#9f1239">N° 03101</text>
      <g font-family="Arial, sans-serif" font-size="16" fill="#27303d">
        <text x="70" y="178">Faena: MININCO</text><line x1="132" y1="182" x2="335" y2="182" stroke="#6b7280"/>
        <text x="365" y="178">Fecha: 12-06-2026</text><line x1="420" y1="182" x2="600" y2="182" stroke="#6b7280"/>
        <text x="630" y="178">Turno: DÍA</text><line x1="682" y1="182" x2="818" y2="182" stroke="#6b7280"/>
        <text x="70" y="218">Equipo: CAMIÓN LK-45-10</text><line x1="132" y1="222" x2="430" y2="222" stroke="#6b7280"/>
        <text x="468" y="218">Área: Patio madera</text><line x1="510" y1="222" x2="818" y2="222" stroke="#6b7280"/>
        <text x="70" y="258">Operador entrante: Carlos M.</text><line x1="202" y1="262" x2="430" y2="262" stroke="#6b7280"/>
        <text x="468" y="258">Horómetro inicio: 134122</text><line x1="594" y1="262" x2="818" y2="262" stroke="#6b7280"/>
      </g>
      <rect x="70" y="302" width="748" height="656" fill="none" stroke="#374151" stroke-width="2"/>
      <rect x="70" y="302" width="748" height="58" fill="#e5e7eb"/>
      <g stroke="#6b7280" stroke-width="1">
        <line x1="555" y1="302" x2="555" y2="958"/><line x1="635" y1="302" x2="635" y2="958"/><line x1="715" y1="302" x2="715" y2="958"/>
        <line x1="70" y1="360" x2="818" y2="360"/><line x1="70" y1="414" x2="818" y2="414"/><line x1="70" y1="468" x2="818" y2="468"/>
        <line x1="70" y1="522" x2="818" y2="522"/><line x1="70" y1="576" x2="818" y2="576"/><line x1="70" y1="630" x2="818" y2="630"/>
        <line x1="70" y1="684" x2="818" y2="684"/><line x1="70" y1="738" x2="818" y2="738"/><line x1="70" y1="792" x2="818" y2="792"/>
        <line x1="70" y1="846" x2="818" y2="846"/><line x1="70" y1="900" x2="818" y2="900"/>
      </g>
      <g font-family="Arial, sans-serif" fill="#1f2937">
        <text x="90" y="338" font-size="16" font-weight="700">ESTADO DEL CAMIÓN / MAQUINARIA</text>
        <text x="572" y="330" font-size="12" font-weight="700">NORMAL</text><text x="655" y="330" font-size="12" font-weight="700">FALLA</text><text x="742" y="330" font-size="12" font-weight="700">N/A</text>
        <g font-size="17"><text x="92" y="394">1. Luces</text><text x="92" y="448">2. Baliza</text><text x="92" y="502">3. Bocina</text><text x="92" y="556">4. Alarma de retroceso</text><text x="92" y="610">5. Fuga de aceite / frenos</text><text x="92" y="664">6. Espejos</text><text x="92" y="718">7. Cinturón de seguridad</text><text x="92" y="772">8. Freno de servicio</text><text x="92" y="826">9. Freno de estacionamiento</text><text x="92" y="880">10. Estado de carrocería</text><text x="92" y="934">11. Neumáticos y llantas</text></g>
        <g font-size="28" font-weight="700" fill="#166534"><text x="582" y="397">✓</text><text x="582" y="451">✓</text><text x="582" y="505">✓</text><text x="582" y="559">✓</text><text x="582" y="613">✓</text><text x="582" y="667">✓</text><text x="582" y="721">✓</text><text x="582" y="775">✓</text><text x="582" y="829">✓</text><text x="582" y="883">✓</text><text x="582" y="937">✓</text></g>
      </g>
      <text x="70" y="1002" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#1f2937">OBSERVACIONES</text>
      <rect x="70" y="1016" width="748" height="62" fill="none" stroke="#6b7280"/>
      <text x="86" y="1048" font-family="Arial, sans-serif" font-size="15" fill="#374151">Sin novedades operacionales. Verificar lavado al cierre del turno.</text>
      <g font-family="Arial, sans-serif" font-size="13" fill="#374151"><text x="90" y="1114">OPERADOR ENTRANTE</text><text x="355" y="1114">OPERADOR SALIENTE</text><text x="650" y="1114">SUPERVISOR TURNO</text></g>
      <g fill="none" stroke="#475569" stroke-width="2"><path d="M102 1140 q36 -34 72 0 q30 26 70 -2"/><path d="M380 1141 q28 -29 62 0 q42 24 80 -4"/><path d="M668 1140 q38 -35 72 0 q24 20 58 -5"/></g>
    </svg>
  `)).png().toFile(path.join(equipmentReportDir, equipmentReportStorageName))

  // Antes había aquí un catálogo de 99 permisos escrito a mano, y **derivó** de la
  // fuente real: le faltaban todos los `prevention:epp*`, así que el entorno de
  // capturas no representaba el RBAC de producción. Eso hizo que
  // /trazabilidad/trabajador pareciera roto para todo usuario cuando en realidad
  // sólo lo está para roles sin ese permiso. `SYSTEM_PERMISSIONS` se deriva de
  // los manifests de módulo (lib/auth/system-rbac.ts), igual que el bootstrap
  // real, así que ya no puede desincronizarse.
  const permissions = SYSTEM_PERMISSIONS
  // isGlobal debe alinearse con GLOBAL_ROLES en lib/auth/scope.ts para que
  // requirePermission + isGlobalRole no redirijan al admin a /forbidden
  // durante la captura (bug histórico: sin isGlobal el admin veía páginas vacías).
  const roles: (typeof schema.roles.$inferInsert)[] = [
    { id: "rol-admin", name: "administrador", label: "Administrador", description: "Control total para auditoría visual", isGlobal: true },
    { id: "rol-jefa", name: "jefa_chome", label: "Jefatura Chome", description: "Aprueba solicitudes y coordina compras", isGlobal: true },
    { id: "rol-prevencion", name: "prevencionista_faena", label: "Prevencionista faena", description: "Solicita EPP y servicios desde faena", isGlobal: false },
    { id: "rol-bodega", name: "bodega", label: "Encargado bodega", description: "Gestiona recepción, stock y entregas", isGlobal: false },
    { id: "rol-secretaria", name: "secretaria", label: "Secretaría", description: "Apoya compras y documentación", isGlobal: true },
  ]

  await db.insert(schema.roles).values(roles)
  await db.insert(schema.permissions).values(permissions)
  const permissionIdByName = Object.fromEntries(permissions.map((permission) => [permission.name, permission.id]))
  const rolePermissionNames: Record<string, string[]> = {
    "rol-admin": permissions.map((permission) => permission.name),
    // El RBAC real (modules/purchasing/manifest.ts) no concede create_order ni
    // send_order a jefa_chome; el seed de capturas los tenía de más, mostrando
    // un acceso a compras que producción no da.
    "rol-jefa": ["requests:view_all", "approvals:approve", "purchasing:view", "receiving:view", "reports:view", "analytics:view", "analytics:export", "flota:view", "mantenciones:view", "mantenciones:create", "repuestos:view_all", "repuestos:approve", "servicios:view_all", "servicios:approve"],
    // `requests:submit` se retiró del registro (lib/auth/bootstrap.ts): EPP/otro
    // se crean y envían en un solo paso con `requests:create`.
    "rol-prevencion": ["requests:create", "requests:view_own", "repuestos:create", "repuestos:view_own", "repuestos:submit", "servicios:create", "servicios:view_own", "servicios:submit", "sst:view", "sst:create", "sst:close", "sst:manage"],
    // `receiving:register` no existe en el catálogo real (sólo register_office y
    // register_faena): el seed lo concedía y la captura mostraba a bodega con un
    // permiso que producción no tiene. Lo detectó la guardia de paridad.
    "rol-bodega": ["receiving:view", "receiving:register_office", "receiving:register_faena", "warehouse:view_stock", "warehouse:register_movement", "warehouse:adjust_stock", "reports:view"],
    "rol-secretaria": ["purchasing:view", "purchasing:create_order", "purchasing:send_order", "purchasing:manage_suppliers", "reports:view", "analytics:view", "analytics:export"],
  }

  const unknownPermissionNames = Object.entries(rolePermissionNames)
    .flatMap(([roleId, names]) => names.filter((n) => !permissionIdByName[n]).map((n) => `${roleId} → ${n}`))
  if (unknownPermissionNames.length > 0) {
    throw new Error(
      `El seed de capturas concede permisos que no existen en SYSTEM_PERMISSIONS:\n  ${unknownPermissionNames.join("\n  ")}\n` +
      "Corrige el nombre o declara el permiso en el manifest del módulo.",
    )
  }

  await db.insert(schema.rolePermissions).values(Object.entries(rolePermissionNames).flatMap(([roleId, names]) =>
    names.map((name) => ({
      roleId,
      permissionId: permissionIdByName[name]!,
    })),
  ))
  await db.insert(schema.users).values([
    {
      id: userId,
      name: "Admin Auditoría",
      email: "admin.audit@chome.cl",
      hashedPassword: password,
      avatarColor: "212",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "user-audit-jefa",
      name: "Jefa Operaciones",
      email: "jefa.audit@chome.cl",
      hashedPassword: password,
      avatarColor: "142",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "user-audit-prevencion",
      name: "Prevencionista Faena",
      email: "prevencion.audit@chome.cl",
      hashedPassword: password,
      avatarColor: "36",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "user-audit-bodega",
      name: "Encargado Bodega",
      email: "bodega.audit@chome.cl",
      hashedPassword: password,
      avatarColor: "260",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "user-audit-inactive",
      name: "Usuario Inactivo",
      email: "inactivo.audit@chome.cl",
      hashedPassword: password,
      avatarColor: "18",
      isActive: false,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.passwordResetTokens).values({
    id: "reset-token-audit-1",
    userId,
    tokenHash: resetTokenHash,
    expiresAt: "2030-01-01T00:00:00.000Z",
    createdAt: now,
  })
  await db.insert(schema.userRoles).values([
    { userId, roleId: "rol-admin" },
    { userId: "user-audit-jefa", roleId: "rol-jefa" },
    { userId: "user-audit-prevencion", roleId: "rol-prevencion" },
    { userId: "user-audit-bodega", roleId: "rol-bodega" },
    { userId: "user-audit-inactive", roleId: "rol-secretaria" },
  ])

  await db.insert(schema.worksites).values([
    {
      id: worksiteId,
      name: "Faena Mininco",
      code: "MIN-001",
      address: "Ruta 5 Sur km 512",
      region: "Biobío",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "ws-audit-2",
      name: "Faena Cabrero",
      code: "CAB-002",
      address: "Camino Industrial 210",
      region: "Biobío",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    /*
     * La bodega de la oficina central. No es decorativa: `resolveOfficeWorksite`
     * (lib/services/dispatch-guides.ts) la busca por el ajuste
     * `warehouse.office_worksite_id` o por nombre y **lanza** si no encuentra
     * ninguna, así que sin esta fila el editor de una GDI devuelve 500 y el
     * origen de toda guía queda sin resolver. El nombre está en la lista de
     * fallbacks a propósito: así el fixture no depende del ajuste.
     */
    {
      id: officeWorksiteId,
      name: "Oficina Central",
      code: "OFI-000",
      address: "Av. Alemania 0450, Temuco",
      region: "Araucanía",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.worksiteUsers).values([
    { userId, worksiteId, isPrimary: true },
    { userId, worksiteId: "ws-audit-2", isPrimary: false },
    { userId: "user-audit-jefa", worksiteId, isPrimary: true },
    { userId: "user-audit-prevencion", worksiteId, isPrimary: true },
    { userId: "user-audit-bodega", worksiteId, isPrimary: true },
    { userId: "user-audit-bodega", worksiteId: officeWorksiteId, isPrimary: false },
    { userId: "user-audit-inactive", worksiteId: "ws-audit-2", isPrimary: true },
  ])

  // CAPA con relaciones reales: el detalle necesita una acción dentro del
  // scope, más evidencia, transición y seguimiento. Antes la ruta apuntaba a
  // un ID inexistente y la captura lo registraba como 404 sin distinguir un
  // problema de fixture de un fallo de producto.
  await db.insert(schema.preventionCapaActions).values({
    id: "capa-audit-1",
    code: "CAPA-2026-001",
    sourceType: "manual",
    sourceId: "hallazgo-captura-1",
    worksiteId,
    finding: "Protección lateral ausente en punto de corte de mantención.",
    immediateMeasure: "Se detuvo la tarea y se delimitó el área hasta instalar la guarda.",
    rootCause: "La inspección de preuso no incluía verificación de la guarda lateral.",
    actionDescription: "Instalar guarda, actualizar pauta y verificar competencia del equipo.",
    responsibleUserId: "user-audit-prevencion",
    responsibleSnapshot: "Prevencionista Faena",
    responsibleRole: "prevencionista",
    priority: "high",
    targetDate: "2026-06-20",
    status: "in_progress",
    evidenceRequired: true,
    requiresImmediateStop: false,
    createdByUserId: userId,
    startedByUserId: "user-audit-prevencion",
    startedAt: now,
    reconciliationStatus: "reconciled",
    effectivenessStatus: "pending",
    version: 1,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionCapaEvidence).values({
    id: "capa-evidence-audit-1",
    actionId: "capa-audit-1",
    kind: "photo",
    reference: "storage/captures/capa-guarda-lateral.jpg",
    description: "Registro fotográfico de la guarda instalada para revisión.",
    uploadedByUserId: "user-audit-prevencion",
    createdAt: now,
  })
  await db.insert(schema.preventionCapaTransitions).values([
    { id: "capa-transition-audit-1", actionId: "capa-audit-1", changeType: "created", toStatus: "pending", reason: "Hallazgo de inspección incorporado al plan.", actorUserId: userId, createdAt: now },
    { id: "capa-transition-audit-2", actionId: "capa-audit-1", changeType: "status", fromStatus: "pending", toStatus: "in_progress", reason: "Instalación de guarda iniciada.", actorUserId: "user-audit-prevencion", createdAt: now },
  ])
  await db.insert(schema.preventionCapaFollowups).values({
    id: "capa-followup-audit-1",
    actionId: "capa-audit-1",
    note: "Guarda instalada; queda pendiente validar la pauta de preuso.",
    progress: 60,
    createdByUserId: "user-audit-prevencion",
    createdAt: now,
  })

  // Requisito legal publicado con decisión de aplicabilidad dentro del scope.
  // La ruta de detalle exige ambos niveles: sólo sembrar el requisito deja una
  // pantalla técnicamente válida pero sin la decisión que el usuario revisa.
  await db.insert(schema.preventionLegalRequirements).values({
    id: "legal-requirement-audit-1",
    code: "DS44-ART-16",
    requirementVersion: 1,
    sourceType: "regulatory",
    authority: "Ministerio del Trabajo y Previsión Social",
    sourceTitle: "Decreto Supremo N.º 44",
    sourceReference: "DS 44, Reglamento de gestión preventiva de riesgos laborales",
    sourceUrl: "https://www.bcn.cl/leychile",
    article: "Artículo 16",
    requirement: "Mantener capacitación preventiva verificable para las personas que ejecutan trabajo en la faena.",
    versionLabel: "Vigencia 2026",
    validFrom: "2025-02-01",
    topic: "Capacitación preventiva",
    chomeRole: "Prevención",
    evidenceRequired: "Registro de asistencia, contenido impartido y evaluación cuando corresponda.",
    frequency: "Anual",
    status: "published",
    createdByUserId: userId,
    reviewedByUserId: "user-audit-prevencion",
    reviewedAt: now,
    approvedByUserId: userId,
    approvedAt: now,
    publishedByUserId: userId,
    publishedAt: now,
    version: 1,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionLegalApplicabilities).values({
    id: "legal-applicability-audit-1",
    requirementId: "legal-requirement-audit-1",
    worksiteId,
    activityReference: "Inducción y capacitación preventiva de cuadrillas",
    applicabilityStatus: "applicable",
    rationale: "La faena mantiene personal operativo expuesto a riesgos de corte y movimiento de equipos.",
    responsibleUserId: "user-audit-prevencion",
    responsibleSnapshot: "Prevencionista Faena",
    evidenceReference: "CAP-2026-001 · registro de capacitación",
    evidenceDueAt: "2026-12-31",
    complianceStatus: "partial",
    assessedByUserId: "user-audit-prevencion",
    assessedAt: now,
    version: 1,
    createdAt: now,
    updatedAt: now,
  })

  // Los trabajadores se siembran antes que cualquier fixture preventivo que
  // los referencie (privacidad, comité, higiene, permisos, emergencias): son
  // el titular del dato, no un detalle posterior.
  await db.insert(schema.workers).values([
    { id: "worker-audit-1", rut: "18.111.222-3", firstName: "Daniela", lastName: "Fuentes", position: "Operadora", worksiteId, isActive: true, createdAt: now },
    { id: "worker-audit-2", rut: "17.444.555-6", firstName: "Marco", lastName: "Silva", position: "Mecánico", worksiteId, isActive: true, createdAt: now },
    { id: "worker-audit-3", rut: "16.777.888-9", firstName: "Paula", lastName: "Mella", position: "Supervisora", worksiteId: "ws-audit-2", isActive: true, createdAt: now },
  ])

  // Detalles TI: las páginas dinámicas y el acta se respaldan en una misma
  // custodia abierta, no en IDs inventados que oculten un 404 durante la QA.
  await db.insert(schema.itAssetTypes).values({
    id: "it-asset-type-audit-1", name: "Notebook corporativo", category: "computacion", hasSpecs: true, isActive: true, createdAt: now, updatedAt: now,
  })
  await db.insert(schema.itAssets).values({
    id: "it-asset-audit-1", code: "TI-NB-0001", assetTypeId: "it-asset-type-audit-1", brand: "Lenovo", model: "ThinkPad T14", serialNumber: "CAPTURE-TI-0001", status: "asignado", workerId: "worker-audit-1", worksiteId, location: "Oficina de operaciones", createdAt: now, updatedAt: now,
  })
  await db.insert(schema.itAssetAssignments).values(
    itAssignmentCaptureFixture({ now, worksiteId, deliveredByUserId: userId }),
  )
  await db.insert(schema.itTickets).values({
    id: "it-ticket-audit-1", code: "INC-2026-0001", subject: "Revisión de equipo asignado", description: "El notebook asignado requiere diagnóstico de conectividad VPN.", category: "internet", priority: "normal", status: "en_diagnostico", requesterUserId: userId, workerId: "worker-audit-1", worksiteId, assetId: "it-asset-audit-1", assigneeUserId: userId, createdAt: now, updatedAt: now,
  })
  await db.insert(schema.preventionPrivacyRequests).values({
    id: "privacy-request-audit-1",
    subjectWorkerId: "worker-audit-1",
    rightType: "access",
    status: "en_proceso",
    requestScope: "Información laboral y preventiva asociada al titular.",
    receivedAt: now,
    dueAt: "2026-06-29T12:00:00.000Z",
    handledByUserId: "user-audit-prevencion",
    createdByUserId: userId,
    identityVerifiedAt: now,
    identityVerifiedByUserId: "user-audit-prevencion",
    legalHold: false,
    createdAt: now,
    updatedAt: now,
  })

  // Gestión de cambio con las seis dimensiones del flujo evaluadas. Una de
  // ellas queda enlazada a CAPA para mostrar la medida operativa en vez de un
  // formulario vacío o una falsa aprobación.
  await db.insert(schema.preventionChangeRequests).values({
    id: "cambio-audit-1",
    worksiteId,
    code: "MOC-2026-001",
    title: "Cambio de resguardo en línea de corte",
    changeType: "equipo",
    description: "Se reemplazará el resguardo lateral de la línea de corte por una guarda enclavada.",
    reason: "Cerrar el hallazgo CAPA-2026-001 y reducir exposición a partes móviles.",
    riskLevel: "high",
    status: "under_evaluation",
    plannedReviewDate: "2026-07-15",
    requestedByUserId: "user-audit-prevencion",
    version: 1,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionChangeAssessments).values([
    { id: "change-assessment-audit-risk", changeRequestId: "cambio-audit-1", dimension: "risk", evaluated: true, impacted: true, notes: "La guarda modifica el control crítico y requiere verificación previa al reinicio.", actionRequired: true, capaActionId: "capa-audit-1", evaluatedByUserId: "user-audit-prevencion", evaluatedAt: now, createdAt: now, updatedAt: now },
    { id: "change-assessment-audit-permit", changeRequestId: "cambio-audit-1", dimension: "permit", evaluated: true, impacted: false, notes: "No cambia la autorización vigente de trabajo.", actionRequired: false, evaluatedByUserId: "user-audit-prevencion", evaluatedAt: now, createdAt: now, updatedAt: now },
    { id: "change-assessment-audit-training", changeRequestId: "cambio-audit-1", dimension: "training", evaluated: true, impacted: true, notes: "La cuadrilla recibe inducción antes del uso de la guarda enclavada.", actionRequired: false, evaluatedByUserId: "user-audit-prevencion", evaluatedAt: now, createdAt: now, updatedAt: now },
    { id: "change-assessment-audit-document", changeRequestId: "cambio-audit-1", dimension: "document", evaluated: true, impacted: true, notes: "Debe actualizarse la pauta de inspección de preuso.", actionRequired: false, evaluatedByUserId: "user-audit-prevencion", evaluatedAt: now, createdAt: now, updatedAt: now },
    { id: "change-assessment-audit-miper", changeRequestId: "cambio-audit-1", dimension: "miper", evaluated: true, impacted: true, notes: "Se revisará el control de atrapamiento en la matriz vigente.", actionRequired: false, evaluatedByUserId: "user-audit-prevencion", evaluatedAt: now, createdAt: now, updatedAt: now },
    { id: "change-assessment-audit-emergency", changeRequestId: "cambio-audit-1", dimension: "emergency", evaluated: true, impacted: false, notes: "No altera rutas de evacuación ni recursos de emergencia.", actionRequired: false, evaluatedByUserId: "user-audit-prevencion", evaluatedAt: now, createdAt: now, updatedAt: now },
  ])

  await db.insert(schema.suppliers).values([
    {
      id: supplierId,
      name: "TRECK Seguridad Industrial",
      rut: "76.123.456-7",
      businessActivity: "Venta de EPP e insumos industriales",
      contactName: "Camila Rojas",
      email: "ventas@treck.example",
      phone: "+56 9 8123 4567",
      address: "Av. Industrial 1400",
      commune: "Los Ángeles",
      city: "Los Ángeles",
      paymentTerms: "30 días",
      isActive: true,
      notes: "Proveedor preferente EPP.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sup-audit-2",
      name: "APRO Suministros",
      rut: "77.222.333-4",
      businessActivity: "Servicios y suministros operativos",
      contactName: "Rodrigo Vera",
      email: "contacto@apro.example",
      phone: "+56 9 7444 1234",
      address: "Camino a Cabrero 210",
      commune: "Cabrero",
      city: "Cabrero",
      paymentTerms: "Contado",
      isActive: true,
      notes: "Proveedor para servicios y mantención.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sup-audit-3",
      name: "Sur Repuestos Maquinaria",
      rut: "78.555.111-2",
      businessActivity: "Repuestos para maquinaria pesada",
      contactName: "Natalia Pérez",
      email: "cotizaciones@sur-repuestos.example",
      phone: "+56 9 6555 8888",
      address: "Parque Industrial 88",
      commune: "Concepción",
      city: "Concepción",
      paymentTerms: "45 días",
      isActive: true,
      notes: "Cotiza repuestos críticos.",
      createdAt: now,
      updatedAt: now,
    },
  ])

  /* ── TI: submódulos del ciclo de vida (septiembre 2026) ──────────────────
   * Las rutas /ti/bajas, /ti/licencias, /ti/mantenciones, /ti/accesos,
   * /ti/garantias y /ti/reportes se capturan desde este seed: sin fixtures
   * cada una renderiza su EmptyState y la auditoría visual documenta una
   * pantalla vacía que no dice nada del módulo. Las garantías usan fechas
   * relativas a HOY (hora de Chile) para que las ventanas "vigente",
   * "vence en 30 días" y "vencida" existan en cualquier fecha de corrida. */
  await db.insert(schema.itAssets).values([
    {
      // Disponible con garantía vigente larga: fila base de /ti/garantias.
      id: "it-asset-audit-2", code: "TI-RP-0002", assetTypeId: "it-asset-type-audit-1", brand: "Dell", model: "Latitude 5440", serialNumber: "CAPTURE-TI-0002", status: "disponible", worksiteId, location: "Bodega de oficina", purchaseDate: shiftCaptureDateMonths(-14), supplierId: "sup-audit-2", purchaseDocType: "factura", purchaseDocRef: "F-88421", cost: 780000, warrantyEndDate: shiftCaptureDateMonths(10), createdAt: now, updatedAt: now,
    },
    {
      // Garantía por vencer dentro de 20 días: filtra en "Vencen en 30 días"
      // cualquier día del mes en que se corra la captura.
      id: "it-asset-audit-3", code: "TI-MV-0003", assetTypeId: "it-asset-type-audit-1", brand: "HP", model: "ProBook 450", serialNumber: "CAPTURE-TI-0003", status: "asignado", workerId: "worker-audit-2", worksiteId: "ws-audit-2", location: "Faena sur", purchaseDate: shiftCaptureDateMonths(-23), supplierId: supplierId, purchaseDocType: "factura", purchaseDocRef: "F-70110", cost: 690000, warrantyEndDate: shiftCaptureDateDays(20), createdAt: now, updatedAt: now,
    },
    {
      // En reparación con garantía vencida: alimenta el ranking de costos.
      id: "it-asset-audit-4", code: "TI-RP-0004", assetTypeId: "it-asset-type-audit-1", brand: "Lenovo", model: "ThinkPad L14", serialNumber: "CAPTURE-TI-0004", status: "en_reparacion", worksiteId, location: "Taller de mantención", purchaseDate: shiftCaptureDateMonths(-40), supplierId: "sup-audit-2", purchaseDocType: "factura", purchaseDocRef: "F-51203", cost: 540000, warrantyEndDate: shiftCaptureDateMonths(-6), createdAt: now, updatedAt: now,
    },
    {
      // Dado de baja: el sujeto de la baja formal de /ti/bajas.
      id: "it-asset-audit-5", code: "TI-DT-0005", assetTypeId: "it-asset-type-audit-1", brand: "Acer", model: "TravelMate P2", serialNumber: "CAPTURE-TI-0005", status: "dado_de_baja", worksiteId, location: "Bodega de oficina", purchaseDate: shiftCaptureDateMonths(-72), supplierId: supplierId, purchaseDocType: "factura", purchaseDocRef: "F-20887", cost: 410000, warrantyEndDate: shiftCaptureDateMonths(-60), createdAt: now, updatedAt: now,
    },
  ])
  await db.insert(schema.itMaintenances).values([
    {
      // Correctiva con costo alto: encabeza el ranking de costo acumulado.
      id: "it-maintenance-audit-1", assetId: "it-asset-audit-4", type: "reparacion", date: shiftCaptureDateMonths(-2, 12), reportedIssue: "No enciende y se apaga tras el arranque.", diagnosis: "Falla de placa madre.", workDone: "Reemplazo de placa madre y prueba extendida de 24 horas.", partsUsed: "Placa madre L14 rev.2", supplierId: "sup-audit-2", technicianName: "Servitec Limitada", cost: 185000, observations: "Equipo devuelto al taller por reincidencia; se recomienda evaluación de reemplazo.", createdAt: now, updatedAt: now,
    },
    {
      // Preventiva de rutina sobre el activo asignado.
      id: "it-maintenance-audit-2", assetId: "it-asset-audit-1", type: "preventiva", date: shiftCaptureDateMonths(-1, 5), workDone: "Limpieza interna, cambio de pasta térmica y actualización de firmware.", technicianUserId: userId, cost: 25000, createdAt: now, updatedAt: now,
    },
  ])
  await db.insert(schema.itLicenses).values({
    id: "it-license-audit-1", name: "Microsoft 365 Business Standard", supplierId: "sup-audit-2", type: "suscripcion", purchasedQuantity: 25, cost: 132000, periodicity: "mensual", startDate: shiftCaptureDateMonths(-8, 1), renewalDate: shiftCaptureDateMonths(1, 1), responsibleUserId: userId, notes: "Renovación automática; revisar puestos sin uso antes de renovar.", isActive: true, createdAt: now, updatedAt: now,
  })
  await db.insert(schema.itLicenseAssignments).values([
    { id: "it-license-assign-audit-1", licenseId: "it-license-audit-1", workerId: "worker-audit-1", worksiteId, assignedAt: now },
    { id: "it-license-assign-audit-2", licenseId: "it-license-audit-1", assetId: "it-asset-audit-3", worksiteId: "ws-audit-2", assignedAt: now, notes: "Licencia de equipo compartido de faena." },
  ])
  await db.insert(schema.itAccessSystems).values([
    { id: "it-access-system-audit-1", name: "Plataforma Chome", description: "Sistema interno de gestión operacional.", isActive: true, createdAt: now, updatedAt: now },
    { id: "it-access-system-audit-2", name: "Portal MOP", description: "Portal de facturación electrónica del proveedor.", isActive: true, createdAt: now, updatedAt: now },
  ])
  await db.insert(schema.itSystemAccess).values([
    { id: "it-system-access-audit-1", systemId: "it-access-system-audit-1", workerId: "worker-audit-1", status: "activo", grantedAt: now, responsibleUserId: userId },
    { id: "it-system-access-audit-2", systemId: "it-access-system-audit-2", workerId: "worker-audit-2", status: "activo", grantedAt: now, responsibleUserId: userId },
    { id: "it-system-access-audit-3", systemId: "it-access-system-audit-1", workerId: "worker-audit-2", status: "suspendido", grantedAt: now, responsibleUserId: userId, notes: "Licencia médica; suspensión temporal de accesos." },
  ])
  await db.insert(schema.itWorkerChecklists).values({
    id: "it-checklist-audit-1", workerId: "worker-audit-3", kind: "onboarding", startedAt: now, createdByUserId: userId, notes: "Alta de supervisora en faena sur.", createdAt: now,
  })
  await db.insert(schema.itChecklistTasks).values([
    { id: "it-checklist-task-audit-1", checklistId: "it-checklist-audit-1", name: "Creación de usuario de plataforma y correo.", done: true, doneAt: now, doneByUserId: userId },
    { id: "it-checklist-task-audit-2", checklistId: "it-checklist-audit-1", name: "Entrega de EPP y dotación de accesos físicos.", done: false },
  ])
  await db.insert(schema.itAssetRetirements).values({
    id: "it-retirement-audit-1", assetId: "it-asset-audit-5", date: shiftCaptureDateMonths(-3, 20), reason: "reciclaje", responsibleUserId: userId, authorizedByUserId: "user-audit-jefa", destination: "Gestora de residuos certificada", observations: "Baja autorizada por reparación no económicamente viable.", createdAt: now,
  })
  await db.insert(schema.itSupplierLinks).values([
    { id: "it-supplier-link-audit-1", supplierId: supplierId, category: "venta_hardware", notes: "Cotiza notebooks y periféricos para reposición anual.", createdAt: now },
    { id: "it-supplier-link-audit-2", supplierId: "sup-audit-2", category: "reparacion", notes: "Taller autorizado de mantención correctiva.", createdAt: now },
  ])

  // Solicitud ARCO con un titular dentro de la faena autorizada. El workbench
  // resuelve al titular desde `workers` y rechaza cualquier solicitud fuera
  // del scope, por lo que el ID por sí solo no era un fixture suficiente.

  await db.insert(schema.productCategories).values([
    { id: "cat-audit-epp", name: "Elementos de protección personal", slug: "epp-audit", isEpp: true, requiresPrevencion: true, sortOrder: 1 },
    { id: "cat-audit-insumos", name: "Insumos operativos", slug: "insumos-audit", isEpp: false, requiresPrevencion: false, sortOrder: 2 },
    { id: "cat-audit-repuestos", name: "Repuestos maquinaria", slug: "repuestos-audit", isEpp: false, requiresPrevencion: false, sortOrder: 3 },
  ])
  await db.insert(schema.products).values([
    {
      id: productId,
      sku: "EPP-AUD-001",
      name: "Guante anticorte nivel 5",
      description: "Guante EPP para cuadrilla de mantención.",
      categoryId: "cat-audit-epp",
      unitOfMeasure: "par",
      isEpp: true,
      requiresPrevencion: true,
      referencePrice: 12900,
      isActive: true,
      notes: "Requiere talla.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prod-audit-2",
      sku: "INS-AUD-002",
      name: "Cinta reflectante 50 mm",
      categoryId: "cat-audit-insumos",
      unitOfMeasure: "rollo",
      referencePrice: 8300,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: deliverableProductId,
      sku: "EPP-AUD-003",
      name: "Casco dieléctrico con barbiquejo",
      description: "Casco EPP para entrega nominal a trabajador.",
      categoryId: "cat-audit-epp",
      unitOfMeasure: "unidad",
      isEpp: true,
      requiresPrevencion: true,
      referencePrice: 22900,
      isActive: true,
      notes: "Usado para capturas de entregas.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prod-audit-4",
      sku: "REP-AUD-004",
      name: "Filtro hidráulico FH-9001",
      description: "Repuesto catalogado para maquinaria pesada.",
      categoryId: "cat-audit-repuestos",
      unitOfMeasure: "unidad",
      isEpp: false,
      requiresPrevencion: false,
      referencePrice: 122500,
      isActive: true,
      notes: "Alternativa catalogada para repuestos.",
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.productUnits).values([
    { id: "unit-audit-unidad", code: "unidad", label: "Unidad", description: "Unidad individual", sortOrder: 1, isActive: true, createdAt: now, updatedAt: now },
    { id: "unit-audit-par", code: "par", label: "Par", description: "EPP entregado por pares", sortOrder: 2, isActive: true, createdAt: now, updatedAt: now },
    { id: "unit-audit-rollo", code: "rollo", label: "Rollo", description: "Material en rollo", sortOrder: 3, isActive: true, createdAt: now, updatedAt: now },
  ]).onConflictDoNothing({ target: schema.productUnits.code })
  await db.insert(schema.productAttributeTemplates).values([
    { id: "template-audit-talla", categoryId: "cat-audit-epp", name: "Talla", type: "select", options: JSON.stringify(["S", "M", "L", "XL"]), isRequired: true, sortOrder: 1, isActive: true, createdAt: now, updatedAt: now },
    { id: "template-audit-color", categoryId: "cat-audit-epp", name: "Color", type: "select", options: JSON.stringify(["Amarillo", "Azul", "Negro", "Rojo"]), isRequired: false, sortOrder: 2, isActive: true, createdAt: now, updatedAt: now },
  ])
  await db.insert(schema.productAttributes).values({
    id: "attr-audit-1",
    productId,
    name: "Talla",
    type: "select",
    isRequired: true,
    options: JSON.stringify(["S", "M", "L", "XL"]),
    sortOrder: 1,
  })
  // Lote pendiente de revisión: usa el mismo contrato persistido por el
  // importador EPP. Así la captura valida la mesa de decisión y no una 404.
  const normalizedEppImportRow = {
    sourceCode: "EPP-LEG-021",
    name: "Guante anticorte nivel 5",
    canonicalName: "Guante anticorte nivel 5",
    description: "Fila histórica para revisar antes de publicar el catálogo.",
    supplierName: "TRECK Seguridad Industrial",
    price: 12900,
    categoryName: "Elementos de Protección Personal",
    unitOfMeasure: "par",
    attributes: [{ name: "Talla", value: "L" }, { name: "Color", value: "Negro" }],
    eppType: "guante",
    brand: "Treck",
    model: null,
    material: "Nitrilo",
    identityKey: "elementos de proteccion personal|guante anticorte nivel 5|treck||color=negro|talla=l",
    familyIdentityKey: "elementos de proteccion personal|guante anticorte nivel 5|treck|",
    issues: [{ severity: "info", message: "Coincidencia de catálogo encontrada; requiere decisión del revisor." }],
  }
  await db.insert(schema.eppImportBatches).values({
    id: "batch-audit-1",
    source: "xlsx",
    fileName: "catalogo-epp-historico-auditoria.xlsx",
    fileHash: "capture-epp-import-batch-audit-1",
    status: "reviewing",
    headersJson: JSON.stringify({ codigo: 1, nombre: 2, unidad: 3, proveedor: 4, precio: 5 }),
    sourceFileJson: JSON.stringify({ sheetName: "EPP histórico", rows: 1 }),
    sourceFileData: "UEsDBBQAAAAIAAAAIQAAAAAAAAAAAAAAAAAAAAAA",
    rulesVersion: "epp-normalization-v1",
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.eppImportRows).values({
    id: "epp-import-row-audit-1",
    batchId: "batch-audit-1",
    rowNumber: 2,
    sourceCode: "EPP-LEG-021",
    originalJson: JSON.stringify({ codigo: "EPP-LEG-021", nombre: "Guante anticorte nivel 5", unidad: "par", proveedor: "TRECK Seguridad Industrial", precio: "12.900" }),
    normalizedJson: JSON.stringify(normalizedEppImportRow),
    identityKey: normalizedEppImportRow.identityKey,
    severity: "info",
    decision: "pending",
    reviewReason: "Coincidencia con el producto EPP-AUD-001; seleccionar actualizar o crear antes de confirmar.",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.eppImportMatches).values({
    id: "epp-import-match-audit-1",
    rowId: "epp-import-row-audit-1",
    productId,
    score: 92,
    reasonsJson: JSON.stringify(["Nombre canónico equivalente", "Unidad equivalente", "Talla coincidente"]),
    disposition: "proposed",
  })
  await db.insert(schema.productSuppliers).values([
    { id: "prod-sup-audit-1", productId, supplierId, unitPrice: 11900, isPreferred: true, lastUpdated: now },
    { id: "prod-sup-audit-2", productId: "prod-audit-2", supplierId: "sup-audit-2", unitPrice: 7900, isPreferred: true, lastUpdated: now },
    { id: "prod-sup-audit-3", productId: deliverableProductId, supplierId, unitPrice: 20500, isPreferred: true, lastUpdated: now },
    { id: "prod-sup-audit-4", productId: "prod-audit-4", supplierId: "sup-audit-3", unitPrice: 118000, isPreferred: true, lastUpdated: now },
  ])

  // Documento vigente: el detalle consulta categoría, tipo, versión actual,
  // distribución, acuse y bitácora. Sembrarlos juntos evita una ficha que
  // parece publicable pero no demuestra ni trazabilidad ni comunicación.
  await db.insert(schema.sstDocumentCategories).values({
    slug: "procedimientos-operacionales-audit",
    name: "Procedimientos operacionales",
    description: "Categoría de captura para documentación preventiva vigente.",
    sortOrder: 1,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.sstDocumentTypes).values({
    id: "doc-type-audit-1",
    categorySlug: "procedimientos-operacionales-audit",
    code: "PROC-LOTO",
    name: "Procedimiento de bloqueo y etiquetado",
    description: "Procedimiento operativo asociado a control de energías peligrosas.",
    defaultConfidentiality: "publico_interno",
    defaultValidityMonths: 12,
    requiresApproval: true,
    requiresAcknowledgment: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.sstDocuments).values({
    id: "doc-audit-1",
    categorySlug: "procedimientos-operacionales-audit",
    typeId: "doc-type-audit-1",
    internalCode: "PROC-LOTO-2026-01",
    title: "Procedimiento de bloqueo y etiquetado de energías",
    description: "Define el aislamiento, verificación de energía cero y liberación controlada antes de mantención.",
    worksiteId,
    status: "vigente",
    confidentiality: "publico_interno",
    dataClass: "operational",
    currentVersionId: "doc-version-audit-1",
    effectiveFrom: "2026-01-01",
    expiresAt: "2026-12-31",
    responsibleUserId: "user-audit-prevencion",
    uploadedBy: userId,
    reviewedBy: "user-audit-prevencion",
    approvedBy: userId,
    approvedAt: now,
    requiresAcknowledgment: true,
    tags: ["LOTO", "energías peligrosas", "mantención"],
    extraMetadata: { source: "capture-audit", revisionReason: "Vigencia anual" },
    checksum: "c".repeat(64),
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.sstDocumentVersions).values({
    id: "doc-version-audit-1",
    documentId: "doc-audit-1",
    version: 1,
    status: "vigente",
    fileName: "procedimiento-loto-2026-v1.pdf",
    storageName: "capture-doc-version-audit-1.pdf",
    filePath: "captures/documentos/procedimiento-loto-2026-v1.pdf",
    mimeType: "application/pdf",
    fileSize: 186240,
    checksum: "c".repeat(64),
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    changelog: "Primera versión vigente para la faena de captura.",
    uploadedBy: userId,
    reviewedBy: "user-audit-prevencion",
    approvedBy: userId,
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.sstDocumentLinks).values({
    id: "doc-link-audit-1",
    documentId: "doc-audit-1",
    entityType: "emergency_plan",
    entityId: "plan-audit-1",
    notes: "Procedimiento de aislamiento aplicable a intervenciones durante la respuesta a emergencias.",
    createdByUserId: userId,
    createdAt: now,
  })
  await db.insert(schema.sstDocumentDistributionTargets).values({
    id: "doc-distribution-audit-1",
    versionId: "doc-version-audit-1",
    userId: "user-audit-prevencion",
    assignmentReason: "Responsable de validar la difusión preventiva en faena.",
    worksiteId,
    positionSnapshot: "Prevencionista",
    companySnapshot: "Chome",
    assignedByUserId: userId,
    assignedAt: now,
    dueAt: "2026-06-30T23:59:59.000Z",
    status: "acusado",
    reminderCount: 0,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.sstDocumentAcknowledgments).values({
    id: "doc-ack-audit-1",
    versionId: "doc-version-audit-1",
    userId: "user-audit-prevencion",
    method: "digital",
    signature: "Acuse digital de Prevención para PROC-LOTO-2026-01",
    ip: "127.0.0.1",
    userAgent: "Chome capture fixture",
    acknowledgedAt: now,
  })
  await db.insert(schema.sstDocumentAudit).values([
    { id: "doc-audit-log-1", documentId: "doc-audit-1", versionId: "doc-version-audit-1", action: "create", userId, comment: "Documento creado para revisión preventiva.", createdAt: now },
    { id: "doc-audit-log-2", documentId: "doc-audit-1", versionId: "doc-version-audit-1", action: "approve", userId, fromStatus: "en_revision", toStatus: "vigente", comment: "Versión aprobada y publicada para la faena.", createdAt: now },
    { id: "doc-audit-log-3", documentId: "doc-audit-1", versionId: "doc-version-audit-1", action: "distribute", userId, comment: "Distribuido a Prevención con acuse registrado.", createdAt: now },
  ])

  // Control MIPER publicado. El detalle no consulta un control aislado: la
  // matriz debe estar publicada y cada tramo de la jerarquía debe existir.
  await db.insert(schema.preventionRiskMethodologies).values({
    id: "risk-methodology-audit-1",
    code: "MIPER-5X5",
    name: "Matriz de probabilidad y consecuencia 5×5",
    versionLabel: "2026.1",
    kind: "primary",
    authoritySource: "Metodología preventiva interna alineada con DS 44",
    configuration: { probabilityScale: 5, consequenceScale: 5 },
    isActive: true,
    createdByUserId: userId,
    createdAt: now,
  })
  await db.insert(schema.preventionRiskProcesses).values({
    id: "risk-process-audit-1",
    worksiteId,
    code: "MANT",
    name: "Mantención de equipos",
    description: "Intervenciones programadas y correctivas de equipos operativos.",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionRiskTasks).values({
    id: "risk-task-audit-1",
    processId: "risk-process-audit-1",
    code: "LOTO",
    name: "Aislar energías antes de mantención",
    isRoutine: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionRiskPositions).values({
    id: "risk-position-audit-1",
    taskId: "risk-task-audit-1",
    code: "MEC",
    name: "Mecánico mantenedor",
    workerPositionKey: "mecanico",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionRiskMatrices).values({
    id: "risk-matrix-audit-1",
    worksiteId,
    matrixVersion: 1,
    title: "MIPER Faena Mininco 2026",
    status: "published",
    methodologyId: "risk-methodology-audit-1",
    methodologySnapshot: { code: "MIPER-5X5", name: "Matriz de probabilidad y consecuencia 5×5", versionLabel: "2026.1", kind: "primary", authoritySource: "Metodología preventiva interna alineada con DS 44", configuration: { probabilityScale: 5, consequenceScale: 5 } },
    revisionReason: "Revisión anual previa a la ejecución del programa preventivo.",
    participationSummary: "Participaron supervisión, mantención y Prevención de la faena.",
    consultationEvidenceReference: "Acta de consulta MIPER-MIN-2026-01",
    effectiveFrom: "2026-01-01",
    reviewDueAt: "2026-12-01",
    publishedHashSha256: "d".repeat(64),
    createdByUserId: userId,
    reviewedByUserId: "user-audit-prevencion",
    reviewedAt: now,
    approvedByUserId: userId,
    approvedAt: now,
    publishedByUserId: userId,
    publishedAt: now,
    version: 1,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionRiskEntries).values({
    id: "risk-entry-audit-1",
    matrixId: "risk-matrix-audit-1",
    processId: "risk-process-audit-1",
    taskId: "risk-task-audit-1",
    positionId: "risk-position-audit-1",
    hazardCode: "ELEC-001",
    hazard: "Energía eléctrica residual",
    riskFactor: "Intervención sin aislamiento y verificación de energía cero.",
    expectedEventOrDamage: "Electrocución o quemadura grave durante la mantención.",
    exposedPeopleDescription: "Mecánicos y supervisores que intervienen equipos energizados.",
    exposedPeopleCount: 4,
    genderConsiderations: "El control aplica por exposición, sin distinción de género.",
    sensitiveWorkerConsiderations: "Restringir la intervención a personal competente y autorizado.",
    inherentDimensions: { probability: 4, consequence: 5 },
    inherentScore: 20,
    inherentLevel: "critical",
    residualDimensions: { probability: 1, consequence: 5 },
    residualScore: 5,
    residualLevel: "medium",
    isCritical: true,
    responsibleUserId: "user-audit-prevencion",
    responsibleSnapshot: "Equipo de mantención y Prevención",
    evidenceReference: "MIPER-MIN-2026-01 · observación en terreno",
    version: 1,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionRiskControls).values({
    id: "risk-control-audit-1",
    riskEntryId: "risk-entry-audit-1",
    description: "Aplicar LOTO, probar ausencia de tensión y registrar energía cero antes de intervenir.",
    hierarchy: "engineering",
    isExisting: true,
    isCritical: true,
    performanceStandard: "Candado personal, tarjeta vigente y prueba de ausencia de tensión registrada.",
    verificationFrequency: "Antes de cada intervención",
    responsibleUserId: "user-audit-prevencion",
    responsibleSnapshot: "Prevencionista y supervisor de mantención",
    dueDate: "2026-12-31",
    status: "verified",
    evidenceReference: "Permiso permit-audit-1 y registro LOTO de junio 2026.",
    lastVerifiedByUserId: userId,
    lastVerifiedAt: now,
    effectivenessStatus: "effective",
    version: 1,
    createdAt: now,
    updatedAt: now,
  })

  // Incidente con investigación en curso. La ficha y el panel RE-20 usan la
  // misma ruta canónica y consultan personas, carriles legales, investigación,
  // evidencia, bitácora y difusión; el subpath /procedimiento no existe.
  await db.insert(schema.preventionIncidents).values({
    id: "inc-audit-1",
    code: "INC-2026-0001",
    clientSubmissionId: "capture-incident-submission-1",
    worksiteId,
    companyName: "Chome",
    companyTaxId: "76.123.456-7",
    eventType: "work_accident",
    status: "under_investigation",
    occurredAt: "2026-06-08T10:15:00.000Z",
    knownAt: "2026-06-08T10:25:00.000Z",
    location: "Taller de mantención · tablero eléctrico N.º 2",
    initialNarrative: "Durante una intervención preventiva se detectó energía residual antes de iniciar el retiro de una cubierta. La actividad se detuvo y se activó la investigación.",
    reportedByUserId: "user-audit-prevencion",
    processName: "Mantención de equipos",
    taskName: "Aislamiento de energías",
    shiftName: "Turno día",
    equipmentReference: "Tablero eléctrico N.º 2",
    actualSeverity: "medical_treatment",
    potentialSeverity: "critical",
    immediateMeasures: "Suspender la intervención, bloquear el tablero, verificar ausencia de tensión y derivar evaluación médica preventiva.",
    operationsSuspended: true,
    evacuated: false,
    isFatalOrSerious: false,
    source: "platform",
    version: 1,
    triagedAt: now,
    triagedByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionIncidentPeople).values({
    id: "incident-person-audit-1",
    incidentId: "inc-audit-1",
    workerId: "worker-audit-1",
    displayLabel: "Daniela Fuentes · operadora",
    employerName: "Chome",
    sex: "female",
    relationshipType: "employee",
    absenceAtLeastNormalShift: false,
    absenceDays: 0,
    chargeDays: 0,
    administratorQualification: "En evaluación por organismo administrador.",
    indicatorInclusionStatus: "included",
    indicatorInclusionReason: "Evento laboral clasificado para indicadores SST.",
    indicatorClassifiedByUserId: userId,
    indicatorClassifiedAt: now,
    version: 1,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionIncidentNotifications).values({
    id: "incident-notification-audit-1",
    incidentId: "inc-audit-1",
    notificationType: "diat",
    deadlineAt: "2026-06-09T23:59:59.000Z",
    status: "sent",
    administratorName: "Organismo administrador",
    responsibleUserId: "user-audit-prevencion",
    sentAt: "2026-06-08T15:30:00.000Z",
    evidenceReference: "DIAT-INC-2026-0001.pdf",
    evidenceChecksumSha256: "e".repeat(64),
    observations: "Notificación enviada dentro del plazo de la faena.",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionIncidentInvestigations).values({
    id: "incident-investigation-audit-1",
    incidentId: "inc-audit-1",
    status: "in_progress",
    methodology: "ICAM",
    team: [{ userId, role: "Líder de investigación" }, { userId: "user-audit-prevencion", role: "Asesor de Prevención" }],
    evidenceSummary: "Se revisaron permiso de trabajo, registro LOTO, fotografías del tablero y declaración de la involucrada.",
    immediateCauses: ["Verificación de ausencia de tensión iniciada después de abrir el tablero."],
    basicCauses: ["Secuencia de bloqueo no estaba visible en el punto de intervención."],
    organizationalCauses: ["La difusión del procedimiento LOTO requiere refuerzo por turno."],
    failedControls: ["Lista de verificación previa a intervención."],
    conclusions: "La barrera LOTO evitó una lesión grave, pero la secuencia debe reforzarse antes de reanudar trabajos equivalentes.",
    preliminaryReportText: "Informe preliminar RE-20: se mantiene suspensión local hasta verificar señalización y difusión del procedimiento.",
    preliminaryReportAt: "2026-06-09T12:00:00.000Z",
    riskProbability: 2,
    riskConsequence: 5,
    riskLevel: "alto",
    miperUpdateRequired: false,
    procedureUpdateRequired: true,
    trainingRequired: true,
    startedByUserId: userId,
    startedAt: "2026-06-08T14:00:00.000Z",
    version: 1,
    updatedAt: now,
  })
  await db.insert(schema.preventionIncidentEvidence).values({
    id: "incident-evidence-audit-1",
    incidentId: "inc-audit-1",
    investigationId: "incident-investigation-audit-1",
    kind: "photo",
    reference: "EVID-INC-2026-0001-01.jpg",
    description: "Tablero aislado y tarjeta LOTO visible luego de la detención segura.",
    checksumSha256: "f".repeat(64),
    isSensitive: false,
    capturedAt: "2026-06-08T10:35:00.000Z",
    createdByUserId: "user-audit-prevencion",
    createdAt: now,
  })
  await db.insert(schema.preventionIncidentHistory).values([
    { id: "incident-history-audit-1", incidentId: "inc-audit-1", changeType: "reported", reason: "Reporte inicial recibido desde la faena.", changeSet: { source: "platform" }, actorUserId: "user-audit-prevencion", createdAt: "2026-06-08T10:25:00.000Z" },
    { id: "incident-history-audit-2", incidentId: "inc-audit-1", changeType: "status", fromStatus: "reported", toStatus: "under_investigation", reason: "Se inicia investigación ICAM por potencial crítico.", changeSet: { methodology: "ICAM" }, actorUserId: userId, createdAt: "2026-06-08T14:00:00.000Z" },
  ])
  await db.insert(schema.preventionIncidentStatements).values({
    id: "incident-statement-audit-1",
    incidentId: "inc-audit-1",
    kind: "involved",
    deponentName: "Daniela Fuentes",
    deponentRole: "Operadora",
    statementText: "Detuve el trabajo al identificar que el equipo no estaba completamente aislado y avisé a mi supervisión.",
    signedAt: "2026-06-08T11:00:00.000Z",
    createdByUserId: "user-audit-prevencion",
    createdAt: now,
  })
  await db.insert(schema.preventionIncidentDiffusion).values({
    id: "incident-diffusion-audit-1",
    incidentId: "inc-audit-1",
    onePageSummary: "Detención segura frente a energía residual durante mantención.",
    rootCauseText: "Secuencia LOTO insuficientemente visible en el punto de intervención.",
    actionPlanSummary: "Reforzar señalización, difusión por turno y verificación previa de energía cero.",
    diffusedAt: "2026-06-10T08:00:00.000Z",
    evidenceRef: "ONEPAGE-INC-2026-0001.pdf",
    createdByUserId: userId,
    createdAt: now,
  })
  await db.insert(schema.preventionIncidentFollowups).values({
    id: "incident-followup-audit-1",
    incidentId: "inc-audit-1",
    followupDate: "2026-06-22",
    note: "La señalización LOTO fue instalada y se mantiene pendiente la capacitación de refuerzo.",
    status: "completed",
    evidenceRef: "SEG-INC-2026-0001",
    createdByUserId: "user-audit-prevencion",
    createdAt: now,
  })
  await db.insert(schema.preventionIncidentShiftDiffusions).values({
    id: "incident-shift-diffusion-audit-1",
    incidentId: "inc-audit-1",
    kind: "corrective_measures",
    summary: "Difusión de medidas de aislamiento y prueba de energía cero al turno día.",
    evidenceRef: "CHARLA-INC-2026-0001",
    status: "confirmed",
    markedByUserId: "user-audit-prevencion",
    markedAt: "2026-06-10T08:10:00.000Z",
    confirmedByUserId: userId,
    confirmedAt: "2026-06-10T09:00:00.000Z",
    createdAt: now,
  })

  // Inspección revisada. El detalle consume la definición versionada, cada
  // respuesta y sus hallazgos, además de nombres de asignación, ejecución y
  // revisión; una ejecución aislada no basta para ejercitar esa pantalla.
  await db.insert(schema.preventionInspectionTemplates).values({
    id: "inspection-template-audit-1",
    code: "INSP-LOTO",
    versionLabel: "2026.1",
    name: "Inspección de aislamiento de energías",
    kind: "inspection",
    sourceDefinitionCode: "INSP-LOTO-BASE",
    definitionSnapshot: {
      code: "INSP-LOTO",
      version: "2026.1",
      revisionDate: "2026-01-01",
      title: "Inspección de aislamiento de energías",
      tipo: "seguimiento",
      legalFramework: ["DS 44", "Procedimiento interno LOTO"],
      applicableTo: "Equipos intervenidos en mantención",
      objective: "Verificar barreras críticas antes y durante intervenciones con energía peligrosa.",
      sections: [{
        id: "aislamiento",
        title: "Aislamiento y verificación",
        countsForCompliance: true,
        items: [
          { id: "bloqueo-personal", label: "Cada persona expuesta utiliza su bloqueo personal", kind: "cumple_nocumple_na_obs", required: true, danoPotencial: "grave" },
          { id: "energia-cero", label: "Se verifica y registra ausencia de tensión antes de intervenir", kind: "cumple_nocumple_na_obs", required: true, danoPotencial: "fatal" },
          { id: "senalizacion", label: "La señalización del punto aislado es visible y vigente", kind: "cumple_nocumple_na_obs", required: true, danoPotencial: "moderado" },
        ],
      }],
      closingAct: { title: "Cierre de inspección", resultOptions: [], signatureRoles: ["Inspector", "Supervisor"] },
    },
    contentHash: "a".repeat(64),
    status: "approved",
    legalFramework: "DS 44 y procedimiento interno LOTO",
    authorUserId: "user-audit-prevencion",
    approvedByUserId: userId,
    approvedAt: now,
    pdtpActivityNumbers: [63],
    version: 1,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionInspectionRuns).values({
    id: "insp-audit-1",
    code: "INSP-2026-0001",
    templateId: "inspection-template-audit-1",
    worksiteId,
    subjectType: "equipment",
    subjectLabel: "Tablero eléctrico N.º 2",
    scheduledFor: "2026-06-12",
    status: "reviewed",
    assignedToUserId: "user-audit-prevencion",
    executedByUserId: "user-audit-prevencion",
    executedAt: "2026-06-12T09:30:00.000Z",
    reviewedByUserId: userId,
    reviewedAt: "2026-06-12T15:00:00.000Z",
    reviewComment: "Hallazgo crítico vinculado a CAPA; seguimiento verificable antes de próxima intervención.",
    conformingCount: 2,
    nonConformingCount: 1,
    notApplicableCount: 0,
    compliancePercent: 67,
    locationLatitude: "-37.4800",
    locationLongitude: "-72.3500",
    clientSubmissionId: "capture-inspection-submission-1",
    version: 1,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionInspectionAnswers).values([
    { id: "inspection-answer-audit-1", runId: "insp-audit-1", sectionId: "aislamiento", itemId: "bloqueo-personal", itemLabel: "Cada persona expuesta utiliza su bloqueo personal", result: "conforming", comment: "Bloqueos personales instalados y verificados.", evidenceReference: "FOTO-INSP-001", danoPotencial: "grave", createdAt: now, updatedAt: now },
    { id: "inspection-answer-audit-2", runId: "insp-audit-1", sectionId: "aislamiento", itemId: "energia-cero", itemLabel: "Se verifica y registra ausencia de tensión antes de intervenir", result: "conforming", comment: "Registro de energía cero disponible junto al permiso.", evidenceReference: "PERM-LOTO-001", danoPotencial: "fatal", createdAt: now, updatedAt: now },
    { id: "inspection-answer-audit-3", runId: "insp-audit-1", sectionId: "aislamiento", itemId: "senalizacion", itemLabel: "La señalización del punto aislado es visible y vigente", result: "non_conforming", comment: "Señalización temporal deteriorada en el acceso del tablero.", evidenceReference: "FOTO-INSP-003", danoPotencial: "moderado", createdAt: now, updatedAt: now },
  ])
  await db.insert(schema.preventionInspectionFindings).values({
    id: "inspection-finding-audit-1",
    runId: "insp-audit-1",
    answerId: "inspection-answer-audit-3",
    description: "Reponer señalización LOTO deteriorada en el acceso al tablero eléctrico N.º 2.",
    criticality: "high",
    immediateMeasure: "Se delimitó el acceso y se instaló señal temporal mientras se repone la definitiva.",
    capaActionId: "capa-audit-1",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionInspectionHistory).values([
    { id: "inspection-history-audit-1", entityType: "run", entityId: "insp-audit-1", worksiteId, changeType: "created", reason: "Inspección programada en faena.", afterState: { status: "planned" }, actorUserId: userId, createdAt: now },
    { id: "inspection-history-audit-2", entityType: "run", entityId: "insp-audit-1", worksiteId, changeType: "reviewed", reason: "Revisión completada con hallazgo vinculado a CAPA.", beforeState: { status: "completed" }, afterState: { status: "reviewed", capaActionId: "capa-audit-1" }, actorUserId: userId, createdAt: now },
  ])

  // Estado operativo #1: ejecución parcialmente respondida. Hace visible la
  // composición de terreno —avance obligatorio, persistencia y cierre— que no
  // aparece en la inspección revisada usada por la captura histórica.
  await db.insert(schema.preventionInspectionRuns).values({
    id: "insp-audit-progress",
    code: "INSP-2026-0002",
    templateId: "inspection-template-audit-1",
    worksiteId,
    subjectType: "equipment",
    subjectLabel: "Tablero MCC sala de proceso",
    scheduledFor: "2026-06-13",
    status: "in_progress",
    assignedToUserId: "user-audit-prevencion",
    version: 2,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionInspectionAnswers).values([
    { id: "inspection-answer-progress-1", runId: "insp-audit-progress", sectionId: "aislamiento", itemId: "bloqueo-personal", itemLabel: "Cada persona expuesta utiliza su bloqueo personal", result: "conforming", comment: "Bloqueos personales instalados en el punto de aislamiento.", danoPotencial: "grave", createdAt: now, updatedAt: now },
    { id: "inspection-answer-progress-2", runId: "insp-audit-progress", sectionId: "aislamiento", itemId: "energia-cero", itemLabel: "Se verifica y registra ausencia de tensión antes de intervenir", result: "conforming", comment: "Ausencia de tensión verificada; registro disponible para revisión.", danoPotencial: "fatal", createdAt: now, updatedAt: now },
  ])

  // Estado operativo #2: el jefe de faena transcribe el Reporte de Equipos
  // mirando la planilla física. La definición completa mantiene el orden real
  // de sus campos y el documento se sirve por la ruta autenticada del módulo.
  await db.insert(schema.preventionInspectionTemplates).values({
    id: "inspection-template-equipment-report-audit",
    code: REPORTE_EQUIPOS.code,
    versionLabel: REPORTE_EQUIPOS.version,
    name: REPORTE_EQUIPOS.title,
    kind: "inspection",
    sourceDefinitionCode: REPORTE_EQUIPOS.code,
    definitionSnapshot: REPORTE_EQUIPOS,
    contentHash: "b".repeat(64),
    status: "approved",
    legalFramework: Array.isArray(REPORTE_EQUIPOS.legalFramework) ? REPORTE_EQUIPOS.legalFramework.join(" · ") : REPORTE_EQUIPOS.legalFramework,
    authorUserId: "user-audit-prevencion",
    approvedByUserId: userId,
    approvedAt: now,
    pdtpActivityNumbers: [25],
    pdtpReviewActivityNumbers: [26],
    version: 1,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionInspectionRuns).values({
    id: "insp-audit-equipment-report",
    code: "RE-EQ-2026-03101",
    templateId: "inspection-template-equipment-report-audit",
    worksiteId,
    subjectType: "camion",
    subjectLabel: "Camión LK-45-10 · Mercedes-Benz Atego 1726",
    scheduledFor: "2026-06-12",
    status: "in_progress",
    assignedToUserId: "user-audit-jefa",
    version: 2,
    createdByUserId: "user-audit-jefa",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionInspectionAnswers).values([
    { id: "equipment-report-answer-1", runId: "insp-audit-equipment-report", sectionId: "identificacion", itemId: "turno", itemLabel: "Turno.", result: "recorded", value: "dia", createdAt: now, updatedAt: now },
    { id: "equipment-report-answer-2", runId: "insp-audit-equipment-report", sectionId: "identificacion", itemId: "area_trabajo", itemLabel: "Área de trabajo.", result: "recorded", value: "Patio madera", createdAt: now, updatedAt: now },
    { id: "equipment-report-answer-3", runId: "insp-audit-equipment-report", sectionId: "identificacion", itemId: "operador_entrante", itemLabel: "Operador entrante.", result: "recorded", value: "Carlos M.", createdAt: now, updatedAt: now },
    { id: "equipment-report-answer-4", runId: "insp-audit-equipment-report", sectionId: "identificacion", itemId: "folio_papel", itemLabel: "N° de reporte en papel.", result: "recorded", value: "03101", createdAt: now, updatedAt: now },
    { id: "equipment-report-answer-5", runId: "insp-audit-equipment-report", sectionId: "horometro", itemId: "horometro_inicio", itemLabel: "Horómetro inicio.", result: "recorded", value: "134122", createdAt: now, updatedAt: now },
  ])
  await db.insert(schema.preventionInspectionRunDocuments).values({
    id: "equipment-report-document-audit-1",
    runId: "insp-audit-equipment-report",
    path: `storage/inspection-evidence/${equipmentReportStorageName}`,
    kind: "source_form",
    caption: "Planilla física N° 03101 · turno día · Camión LK-45-10",
    extraction: {
      layoutVersion: "reporte-equipos-01-capture",
      cells: [
        { sectionId: "identificacion", itemId: "turno", result: "dia", confidence: 0.99 },
        { sectionId: "identificacion", itemId: "folio_papel", result: "03101", confidence: 0.98 },
      ],
    },
    uploadedByUserId: "user-audit-jefa",
    createdAt: now,
  })

  // Plan de emergencia con los insumos que consume el detalle: escenario,
  // organigrama, recursos, contacto y simulacro. El resultado mejorable del
  // simulacro mantiene la trazabilidad hacia la CAPA ya sembrada.
  await db.insert(schema.preventionEmergencyPlans).values({
    id: "plan-audit-1",
    worksiteId,
    code: "PEE-2026-001",
    title: "Plan de emergencia Faena Mininco 2026",
    status: "draft",
    description: "Respuesta coordinada para incendio en instalaciones operativas y evacuación de cuadrillas.",
    createdByUserId: userId,
    version: 1,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionEmergencyScenarios).values({
    id: "emergency-scenario-audit-1",
    planId: "plan-audit-1",
    type: "incendio_estructural",
    title: "Incendio en línea de corte",
    description: "Foco incipiente en zona de equipos con presencia de cuadrilla.",
    responseProcedure: "Detener operación, activar alarma, evacuar al punto seguro y coordinar con Bomberos.",
    createdAt: now,
  })
  await db.insert(schema.preventionEmergencyRoles).values([
    { id: "emergency-role-audit-1", planId: "plan-audit-1", roleName: "Jefa de emergencia", assigneeWorkerId: "worker-audit-3", backupWorkerId: "worker-audit-1", createdAt: now },
    { id: "emergency-role-audit-2", planId: "plan-audit-1", roleName: "Guía de evacuación", assigneeWorkerId: "worker-audit-1", backupWorkerId: "worker-audit-2", createdAt: now },
  ])
  await db.insert(schema.preventionEmergencyResources).values({
    id: "emergency-resource-audit-1",
    // Era "worksite-audit-1", un id que nunca existió: la FK abortaba el seed
    // completo acá, así que ninguna corrida de capturas llegaba al navegador.
    worksiteId,
    planId: "plan-audit-1",
    name: "Extintor PQS 10 kg",
    kind: "Extintor",
    location: "Acceso línea de corte",
    lastInspectedAt: "2026-06-01",
    nextInspectionAt: "2026-07-01",
    status: "operational",
    createdAt: now,
    updatedAt: now,
  })
  /*
   * Padrón físico por faena (inventario-faena). La ficha `/admin/inventario-faena/[id]`
   * consulta tipo, asignaciones, eventos y casos de servicio por separado: sembrar
   * un extintor sin su punto ni eventos dejaría la captura visualmente pobre y
   * restaría evidencia al ciclo del recurso.
   */
  await db.insert(schema.preventionEmergencyResourceTypes).values({
    id: "invertype-audit-pqs10",
    resourceClass: "extinguisher",
    agent: "PQS",
    capacity: 10,
    capacityUnit: "kg",
    canonicalName: "Extintor PQS 10 kg",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionEmergencyResourcePoints).values({
    id: "inventory-point-audit-1",
    worksiteId,
    code: "PT-CORTE-01",
    label: "Punto fijo acceso línea de corte",
    pointKind: "fixed",
    fixedLocation: "Acceso línea de corte",
    requiredTypeId: "invertype-audit-pqs10",
    isActive: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionEmergencyResources).values({
    id: "inventory-audit-1",
    worksiteId,
    planId: "plan-audit-1",
    assetCode: "EXT-CORTE-01",
    typeId: "invertype-audit-pqs10",
    name: "Extintor PQS 10 kg · acceso línea de corte",
    kind: "Extintor",
    location: "Acceso línea de corte",
    serialNumber: "PQS-10-2026-0042",
    lastMaintenanceAt: "2026-04-12",
    lastInspectedAt: "2026-06-01",
    nextInspectionAt: "2026-09-01",
    expiresAt: "2027-04-12",
    status: "operational",
    version: 1,
    createdAt: now,
    updatedAt: now,
  })
  /*
   * Catálogo de contenedores: la ficha `/admin/contenedores/[id]` muestra el
   * historial de inspecciones, así que sembrar el contenedor sin ninguna
   * dejaría la captura vacía justo en lo que la ficha existe para mostrar.
   */
  await db.insert(schema.preventionContainers).values([
    {
      id: "container-audit-1",
      worksiteId,
      code: "CT-014",
      location: "Acopio norte",
      status: "operational",
      isActive: true,
      version: 1,
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "container-audit-2",
      worksiteId,
      code: "CT-021",
      location: "Portería",
      status: "observed",
      isActive: true,
      version: 1,
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    },
  ])
  /* La ficha del contenedor existe para mostrar su historial, así que la
   * captura necesita una inspección que lo tome como sujeto: sin esto el panel
   * salía vacío y la cobertura declarada ("con inspección ejecutada") mentía. */
  await db.insert(schema.preventionInspectionRuns).values({
    id: "insp-audit-contenedor",
    code: "INSP-2026-0007",
    templateId: "inspection-template-audit-1",
    worksiteId,
    subjectType: "contenedor",
    subjectLabel: "CT-014 · Acopio norte",
    subjectContainerId: "container-audit-1",
    scheduledFor: "2026-06-20",
    status: "reviewed",
    assignedToUserId: "user-audit-prevencion",
    executedByUserId: "user-audit-prevencion",
    executedAt: "2026-06-20T10:15:00.000Z",
    reviewedByUserId: userId,
    reviewedAt: "2026-06-20T16:00:00.000Z",
    conformingCount: 8,
    nonConformingCount: 1,
    notApplicableCount: 1,
    compliancePercent: 89,
    version: 1,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionEmergencyResourceAssignments).values({
    id: "inventory-assignment-audit-1",
    pointId: "inventory-point-audit-1",
    resourceId: "inventory-audit-1",
    assignedAt: now,
    reason: "Alta inicial del padrón físico de faena.",
    actorUserId: userId,
  })
  await db.insert(schema.preventionEmergencyResourceEvents).values([
    {
      id: "inventory-event-audit-import",
      worksiteId,
      resourceId: "inventory-audit-1",
      eventType: "imported",
      occurredAt: now,
      actorUserId: userId,
      sourceType: "xlsx",
      notes: "Importado desde padrón histórico 2026-04-12 con su mantenimiento al día.",
      snapshot: { assetCode: "EXT-CORTE-01", kind: "Extintor" },
    },
    {
      id: "inventory-event-audit-inspected",
      worksiteId,
      resourceId: "inventory-audit-1",
      eventType: "classified",
      occurredAt: now,
      actorUserId: "user-audit-prevencion",
      notes: "Inspección preventiva del 2026-06-01: presión, sello y señalización OK.",
    },
  ])
  await db.insert(schema.preventionEmergencyContacts).values({
    id: "emergency-contact-audit-1",
    planId: "plan-audit-1",
    name: "Central de emergencias",
    org: "Bomberos de Mininco",
    role: "Despacho de emergencia",
    phone: "+56 9 5555 0101",
    createdAt: now,
  })
  await db.insert(schema.preventionEmergencyDrills).values({
    id: "emergency-drill-audit-1",
    planId: "plan-audit-1",
    worksiteId,
    scenarioType: "incendio_estructural",
    scheduledFor: "2026-06-09T10:00:00.000Z",
    executedAt: "2026-06-09T10:00:00.000Z",
    status: "completed",
    durationMinutes: 18,
    evacuationSeconds: 245,
    observations: "La cuadrilla evacuó, pero la señalización del punto seguro requiere actualización.",
    outcome: "needs_improvement",
    capaActionId: "capa-audit-1",
    createdByUserId: "user-audit-prevencion",
    version: 1,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionEmergencyDrillEvidence).values({
    id: "emergency-drill-evidence-audit-1",
    drillId: "emergency-drill-audit-1",
    fileName: "acta-simulacro-sismo.pdf",
    storagePath: "storage/prevention-drill-evidence/acta-simulacro-sismo.pdf",
    mimeType: "application/pdf",
    fileSizeBytes: 2048,
    sha256: "d".repeat(64),
    state: "active",
    uploadedByUserId: userId,
    uploadedAt: now,
  })

  // Permiso activo completo. El detalle une el tipo y la cabecera, y consulta
  // controles, LOTO, mediciones, AST y cuadrilla por separado; se siembran
  // todos para evitar un permiso aparentemente habilitable pero sin controles.
  await db.insert(schema.preventionPermitTypes).values({
    id: "permit-type-audit-1",
    code: "LOTO-MANT",
    name: "Mantención con bloqueo de energías",
    description: "Permiso para intervenir equipo con aislamiento eléctrico y AST.",
    requiresIsolation: true,
    requiresMeasurement: true,
    requiresJsa: true,
    measurementValidityMinutes: 60,
    maxDurationHours: 8,
    legalBasis: "DS 44 y procedimiento interno de LOTO",
    isActive: true,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionWorkPermits).values({
    id: "permit-audit-1",
    code: "PT-2026-001",
    permitTypeId: "permit-type-audit-1",
    worksiteId,
    taskDescription: "Cambio de guarda lateral y verificación de enclavamiento en línea de corte.",
    location: "Línea de corte, sector norte",
    supervisorUserId: "user-audit-prevencion",
    plannedStartAt: "2026-06-09T09:00:00.000Z",
    plannedEndAt: "2026-06-09T17:00:00.000Z",
    status: "active",
    requestedByUserId: userId,
    submittedAt: now,
    approvedByUserId: userId,
    approvedAt: now,
    activatedByUserId: "user-audit-prevencion",
    activatedAt: now,
    version: 1,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionPermitCrew).values([
    { id: "permit-crew-audit-1", permitId: "permit-audit-1", workerId: "worker-audit-1", role: "executor", acknowledgedAt: now, acknowledgementSha256: "b".repeat(64), createdAt: now },
    { id: "permit-crew-audit-2", permitId: "permit-audit-1", workerId: "worker-audit-2", role: "standby", acknowledgedAt: now, acknowledgementSha256: "c".repeat(64), createdAt: now },
  ])
  await db.insert(schema.preventionPermitControls).values([
    { id: "permit-control-audit-1", permitId: "permit-audit-1", description: "Área delimitada y señalizada antes de intervenir.", isMandatory: true, verified: true, verifiedByUserId: "user-audit-prevencion", verifiedAt: now, createdAt: now },
    { id: "permit-control-audit-2", permitId: "permit-audit-1", description: "EPP anticorte y protección ocular verificados.", isMandatory: true, verified: true, verifiedByUserId: "user-audit-prevencion", verifiedAt: now, createdAt: now },
  ])
  await db.insert(schema.preventionPermitIsolations).values({
    id: "permit-isolation-audit-1",
    permitId: "permit-audit-1",
    energySource: "electrical",
    equipmentTag: "LC-01",
    isolationMethod: "Interruptor bloqueado y tarjeta personal",
    lockTagId: "LOTO-2026-001",
    appliedByUserId: "user-audit-prevencion",
    appliedAt: now,
    verifiedZeroEnergy: true,
    createdAt: now,
  })
  await db.insert(schema.preventionPermitMeasurements).values({
    id: "permit-measurement-audit-1",
    permitId: "permit-audit-1",
    parameter: "Oxígeno",
    value: "20.9",
    unit: "%",
    acceptableMin: "19.5",
    acceptableMax: "23.5",
    withinRange: true,
    equipmentTag: "GAS-01",
    calibrationDate: "2026-05-20",
    takenByUserId: "user-audit-prevencion",
    takenAt: now,
    createdAt: now,
  })
  await db.insert(schema.preventionJsaSteps).values({
    id: "permit-jsa-audit-1",
    permitId: "permit-audit-1",
    stepOrder: 1,
    stepDescription: "Aislar la energía e instalar la guarda lateral.",
    hazards: ["Energía eléctrica", "Atrapamiento"],
    controls: ["LOTO", "Prueba de energía cero", "EPP anticorte"],
    residualRisk: "low",
    createdByUserId: "user-audit-prevencion",
    createdAt: now,
  })

  // Comité con paridad mínima, acta cerrada y acuerdo enlazado a CAPA. El
  // estado del comité calcula paridad y cadencia desde estas entidades, no
  // sólo desde la cabecera del comité.
  await db.insert(schema.preventionCommittees).values({
    id: "comite-audit-1",
    worksiteId,
    name: "Comité Paritario Faena Mininco",
    constitutedOn: "2026-01-15",
    mandateEndsOn: "2028-01-14",
    status: "active",
    meetingDayOfMonth: 15,
    version: 1,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionCommitteeMembers).values([
    { id: "committee-member-audit-1", committeeId: "comite-audit-1", workerId: "worker-audit-1", representation: "workers", seat: "titular", role: "presidente", electedOn: "2026-01-15", hasFuero: true, status: "active", createdAt: now, updatedAt: now },
    { id: "committee-member-audit-2", committeeId: "comite-audit-1", workerId: "worker-audit-2", representation: "company", seat: "titular", role: "secretario", electedOn: "2026-01-15", hasFuero: false, status: "active", createdAt: now, updatedAt: now },
  ])
  await db.insert(schema.preventionCommitteeMeetings).values({
    id: "committee-meeting-audit-1",
    code: "CPHS-2026-006",
    committeeId: "comite-audit-1",
    meetingType: "ordinary",
    scheduledFor: "2026-06-15T10:00:00.000Z",
    heldAt: "2026-06-15T10:00:00.000Z",
    agenda: "Revisión de hallazgos, capacitación y simulacro de emergencia.",
    minutes: "Se revisó el hallazgo de la línea de corte y se acordó verificar la guarda y actualizar la pauta de preuso antes del siguiente turno.",
    status: "closed",
    quorumReached: true,
    closedByUserId: userId,
    closedAt: now,
    version: 1,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionCommitteeAttendance).values([
    { id: "committee-attendance-audit-1", meetingId: "committee-meeting-audit-1", memberId: "committee-member-audit-1", attended: true, createdAt: now },
    { id: "committee-attendance-audit-2", meetingId: "committee-meeting-audit-1", memberId: "committee-member-audit-2", attended: true, createdAt: now },
  ])
  await db.insert(schema.preventionCommitteeAgreements).values({
    id: "committee-agreement-audit-1",
    meetingId: "committee-meeting-audit-1",
    description: "Verificar eficacia de la guarda lateral y su pauta de inspección antes del siguiente turno.",
    capaActionId: "capa-audit-1",
    createdAt: now,
    updatedAt: now,
  })

  // Higiene industrial: ambos detalles (GES y programa de vigilancia) se
  // basan en el mismo agente, grupo y trabajadores. La medición y matrículas
  // permiten revisar decisión de vigilancia, no sólo nombres de catálogos.
  await db.insert(schema.preventionExposureAgents).values({
    id: "hygiene-agent-audit-1",
    code: "RUIDO",
    name: "Ruido ocupacional",
    agentType: "physical",
    unit: "dB(A)",
    permissibleLimit: "85",
    actionLevelFactor: "0.5",
    limitBasis: "DS 594 y protocolo PREXOR",
    surveillanceProtocol: "PREXOR",
    isActive: true,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionExposureGroups).values({
    id: "grupo-audit-1",
    code: "GES-RUIDO-001",
    name: "Operadores línea de corte",
    worksiteId,
    agentId: "hygiene-agent-audit-1",
    processDescription: "Operación y mantención menor en línea de corte con exposición continua a ruido.",
    surveillanceRequired: true,
    surveillanceReason: "La medición alcanza el nivel de acción definido por PREXOR.",
    isActive: true,
    version: 1,
    createdByUserId: "user-audit-prevencion",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionExposureGroupMembers).values([
    { id: "hygiene-group-member-audit-1", groupId: "grupo-audit-1", workerId: "worker-audit-1", joinedOn: "2026-01-15", createdAt: now },
    { id: "hygiene-group-member-audit-2", groupId: "grupo-audit-1", workerId: "worker-audit-2", joinedOn: "2026-01-15", createdAt: now },
  ])
  await db.insert(schema.preventionExposureMeasurements).values({
    id: "hygiene-measurement-audit-1",
    groupId: "grupo-audit-1",
    measuredOn: "2026-06-03",
    value: "81",
    unit: "dB(A)",
    permissibleLimitSnapshot: "85",
    actionLevelSnapshot: "80",
    outcome: "above_action",
    method: "Dosimetría personal de jornada completa",
    laboratoryName: "Laboratorio Higiene Audit",
    equipmentTag: "DOS-01",
    calibrationDate: "2026-05-15",
    sampleDurationMinutes: 480,
    reportReference: "HIG-2026-014",
    recordedByUserId: "user-audit-prevencion",
    createdAt: now,
  })
  await db.insert(schema.preventionSurveillancePrograms).values({
    id: "programa-audit-1",
    code: "PV-RUIDO-2026",
    name: "Vigilancia auditiva Faena Mininco",
    protocol: "PREXOR",
    agentId: "hygiene-agent-audit-1",
    worksiteId,
    periodicityMonths: 12,
    legalBasis: "DS 594 y protocolo PREXOR",
    status: "active",
    createdByUserId: "user-audit-prevencion",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionSurveillanceEnrollments).values([
    { id: "hygiene-enrollment-audit-1", programId: "programa-audit-1", workerId: "worker-audit-1", groupId: "grupo-audit-1", enrolledOn: "2026-06-04", dueOn: "2027-06-04", status: "summoned", summonedAt: now, createdAt: now, updatedAt: now },
    { id: "hygiene-enrollment-audit-2", programId: "programa-audit-1", workerId: "worker-audit-2", groupId: "grupo-audit-1", enrolledOn: "2026-06-04", dueOn: "2027-06-04", status: "attended", attendedOn: "2026-06-07", createdAt: now, updatedAt: now },
  ])

  await db.insert(schema.purchaseRequests).values([
    {
      id: requestId,
      code: "SOL-2026-0001",
      worksiteId,
      requesterId: "user-audit-prevencion",
      requestType: "epp",
      urgency: "high",
      requiredDate: "2026-06-20",
      status: "submitted",
      submittedAt: now,
      notes: "Reposición para cuadrilla de mantención.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: pendingRequestId,
      code: "SOL-2026-0002",
      worksiteId,
      requesterId: "user-audit-prevencion",
      requestType: "otro",
      urgency: "critical",
      requiredDate: "2026-06-19",
      status: "submitted",
      submittedAt: now,
      notes: "Solicitud urgente para mostrar cola de aprobaciones.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: deliveryRequestId,
      code: "SOL-2026-0003",
      worksiteId,
      requesterId: "user-audit-prevencion",
      requestType: "epp",
      urgency: "normal",
      requiredDate: "2026-06-21",
      status: "closed",
      submittedAt: now,
      closedAt: now,
      notes: "Solicitud recibida para capturas de entrega nominal.",
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.purchaseRequestItems).values([
    {
      id: requestItemId,
      requestId,
      productId,
      quantity: 12,
      unitOfMeasure: "par",
      status: "approved",
      urgency: "high",
      requiredDate: "2026-06-20",
      workerId: "worker-audit-1",
      suggestedSupplierId: supplierId,
      sortOrder: 0,
      notes: "Talla L para turno día.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "req-item-audit-2",
      requestId,
      productId: "prod-audit-2",
      quantity: 4,
      unitOfMeasure: "rollo",
      status: "pending_purchase",
      urgency: "normal",
      requiredDate: "2026-06-20",
      suggestedSupplierId: "sup-audit-2",
      sortOrder: 1,
      notes: "Para demarcación temporal.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: pendingRequestItemId,
      requestId: pendingRequestId,
      productId: "prod-audit-2",
      quantity: 8,
      unitOfMeasure: "rollo",
      status: "requested",
      urgency: "critical",
      requiredDate: "2026-06-19",
      suggestedSupplierId: "sup-audit-2",
      sortOrder: 0,
      notes: "Pendiente para panel de aprobaciones.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: deliverableRequestItemId,
      requestId: deliveryRequestId,
      productId: deliverableProductId,
      quantity: 5,
      unitOfMeasure: "unidad",
      status: "partially_delivered",
      urgency: "normal",
      requiredDate: "2026-06-21",
      workerId: "worker-audit-2",
      suggestedSupplierId: supplierId,
      sortOrder: 0,
      notes: "EPP disponible para entrega a trabajador.",
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.requestItemAttributes).values([
    {
      id: "req-attr-audit-1",
      requestItemId,
      attributeId: "attr-audit-1",
      attributeName: "Talla",
      value: "L",
    },
    {
      id: "req-attr-audit-2",
      requestItemId: deliverableRequestItemId,
      attributeId: "attr-audit-1",
      attributeName: "Talla",
      value: "M",
    },
  ])
  await db.insert(schema.approvalDecisions).values([
    {
      id: "approval-audit-1",
      requestItemId,
      requestId,
      type: "approve",
      decidedBy: "user-audit-jefa",
      decidedAt: now,
      reason: "Stock requerido para continuidad operacional.",
      roleContext: "jefa_chome",
    },
    {
      id: "approval-audit-2",
      requestItemId: deliverableRequestItemId,
      requestId: deliveryRequestId,
      type: "approve",
      decidedBy: "user-audit-jefa",
      decidedAt: now,
      reason: "EPP aprobado para entrega nominal.",
      roleContext: "jefa_chome",
    },
  ])

  await db.insert(schema.purchaseRequests).values([
    {
      id: repuestoRequestId,
      code: "REP-2026-0001",
      worksiteId,
      requesterId: userId,
      requestType: "repuestos",
      urgency: "normal",
      requiredDate: "2026-06-24",
      status: "submitted",
      submittedAt: now,
      notes: "Proveedor único disponible para el repuesto crítico.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: serviceRequestId,
      code: "SRV-2026-0001",
      worksiteId,
      requesterId: userId,
      requestType: "servicios",
      urgency: "high",
      requiredDate: "2026-06-25",
      status: "submitted",
      submittedAt: now,
      notes: "Servicio técnico programado con disponibilidad limitada.",
      createdAt: now,
      updatedAt: now,
    },
  ])

  await db.insert(schema.purchaseRequestItems).values([
    {
      id: repuestoItemId,
      requestId: repuestoRequestId,
      productNameFree: "Filtro hidráulico principal",
      quantity: 2,
      unitOfMeasure: "unidad",
      status: "requested",
      urgency: "normal",
      requiredDate: "2026-06-24",
      supplierHint: "TRECK Seguridad Industrial",
      sortOrder: 0,
      notes: "Compatible con equipo de mantención.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: serviceItemId,
      requestId: serviceRequestId,
      productNameFree: "Mantención preventiva de generador",
      quantity: 1,
      unitOfMeasure: "servicio",
      status: "requested",
      urgency: "high",
      requiredDate: "2026-06-25",
      supplierHint: "APRO Suministros",
      sortOrder: 0,
      notes: "Coordinar acceso con jefe de faena.",
      createdAt: now,
      updatedAt: now,
    },
  ])

  await db.insert(schema.requestItemAttributes).values([
    { id: "rep-attr-part", requestItemId: repuestoItemId, attributeName: "N° de Parte", value: "FH-9001" },
    { id: "rep-attr-equipment", requestItemId: repuestoItemId, attributeName: "Equipo", value: "Excavadora CAT 320" },
    { id: "rep-attr-patent", requestItemId: repuestoItemId, attributeName: "Patente/Código", value: "EQ-17" },
    { id: "rep-attr-brand", requestItemId: repuestoItemId, attributeName: "Marca", value: "Caterpillar" },
    { id: "rep-attr-model", requestItemId: repuestoItemId, attributeName: "Modelo", value: "320D" },
    { id: "srv-attr-location", requestItemId: serviceItemId, attributeName: "Ubicación", value: "Sala generador faena Mininco" },
    { id: "srv-attr-equipment", requestItemId: serviceItemId, attributeName: "Equipo", value: "Generador industrial" },
    { id: "srv-attr-patent", requestItemId: serviceItemId, attributeName: "Patente/Código", value: "GEN-04" },
    { id: "srv-attr-brand", requestItemId: serviceItemId, attributeName: "Marca", value: "Cummins" },
    { id: "srv-attr-model", requestItemId: serviceItemId, attributeName: "Modelo", value: "C220D5" },
  ])

  await db.insert(schema.repuestoQuotations).values([
    {
      id: "rep-quote-audit-1",
      requestId: repuestoRequestId,
      supplierId,
      fileName: "cotizacion-repuesto-2026-0001.pdf",
      filePath: "/storage/repuestos/cotizacion-repuesto-2026-0001.pdf",
      fileSize: "192410",
      totalAmount: 245000,
      status: "pending",
      notes: "Incluye despacho a faena.",
      createdAt: now,
      updatedAt: now,
    },
  ])

  await db.insert(schema.serviceQuotations).values([
    {
      id: "srv-quote-audit-1",
      requestId: serviceRequestId,
      supplierId: "sup-audit-2",
      fileName: "cotizacion-servicio-2026-0001.pdf",
      filePath: "/storage/servicios/cotizacion-servicio-2026-0001.pdf",
      fileSize: "221600",
      totalAmount: 680000,
      status: "pending",
      notes: "Incluye visita técnica y repuestos menores.",
      createdAt: now,
      updatedAt: now,
    },
  ])

  // ── SST Evaluations ──────────────────────────────────────────────────────
  await db.insert(schema.sstEvaluations).values([
    {
      id: "sst-audit-1",
      worksiteId,
      workerId: "worker-audit-1",
      createdBy: userId,
      definicionCode: "trabajador_nuevo",
      definicionVersion: "01",
      tipo: "nuevo",
      fechaEvaluacion: "2026-06-09",
      estado: "cerrado",
      cargosJson: JSON.stringify(["operador_maquinaria"]),
      resultadoFinal: "apto",
      porcentajeCumplimiento: 95.5,
      observacionesGenerales: "Evaluación de ingreso para trabajador nuevo.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sst-audit-2",
      worksiteId,
      workerId: "worker-audit-2",
      createdBy: userId,
      definicionCode: "trabajador_antiguo",
      definicionVersion: "01",
      tipo: "seguimiento",
      motivo: "accidente",
      descripcionEvento: "Seguimiento post-incidente menor.",
      fechaEvaluacion: "2026-06-09",
      estado: "cerrado",
      cargosJson: JSON.stringify(["mecanico"]),
      resultadoFinal: "apto",
      porcentajeCumplimiento: 88.0,
      resultadoEficacia: "eficaz",
      observacionesGenerales: "Seguimiento por incidente menor en faena.",
      createdAt: now,
      updatedAt: now,
    },
  ])

  // D11: el plan de acción de la evaluación vive en CAPA; `n` es la fila del
  // acta y viaja en el `source_ref`.
  await db.insert(schema.preventionCapaActions).values([
    {
      id: "capa-sst-audit-1",
      code: `CAPA-2026-0902-${Date.now()}`,
      sourceType: "sst_evaluation",
      sourceId: "sst-audit-1",
      worksiteId,
      finding: "Falta EPP en sector norte",
      actionDescription: "Entregar kit completo al trabajador",
      responsibleSnapshot: "Jefe de faena",
      priority: "medium",
      targetDate: "2026-06-15",
      status: "pending_verification",
      evidenceRequired: true,
      sourceRef: { n: 1 },
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    },
  ])

  await db.insert(schema.safetyIndicators).values({
    id: "indicator-audit-2026-06",
    worksiteId,
    year: 2026,
    month: 6,
    trabajadores: 38,
    horasHombre: 7600,
    accConTiempoPerdido: 1,
    accSinTiempoPerdido: 2,
    diasPerdidos: 4,
    incidentes: 3,
    danoMaterial: 1,
    danoAmbiental: 0,
    updatedByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })

  await db.insert(schema.pdtpPrograms).values({
    id: "prog-audit-1",
    year: 2026,
    version: 1,
    status: "active",
    title: "Programa de Trabajo Preventivo 2026",
    elaboratedByName: "Prevencionista Auditor",
    elaboratedByTitle: "Experto en Prevención",
    complianceTarget: 0.9,
    createdAt: now,
    updatedAt: now,
  })
  // El editor de programas sólo acepta borradores: un programa activo redirige
  // al detalle. Sin un borrador, la ruta de edición nunca se podía capturar y
  // la evidencia de TASK-UI-009 quedaba sin la pantalla que se corrige.
  await db.insert(schema.pdtpPrograms).values({
    id: "prog-audit-2",
    year: 2027,
    version: 1,
    status: "draft",
    title: "Programa de Trabajo Preventivo 2027 (borrador)",
    elaboratedByName: "Prevencionista Auditor",
    elaboratedByTitle: "Experto en Prevención",
    complianceTarget: 0.9,
    createdAt: now,
    updatedAt: now,
  })
  // Ejecución PDTP completa. La vista de verificación valida en conjunto la
  // actividad del programa, la evidencia aprobada, el checklist por sujeto y
  // las acciones correctivas; se siembran como una misma cadena auditable.
  const pdtpChecklistDefinition = {
    code: "PDTP-LOTO-001",
    version: "01",
    revisionDate: "2026-01-01",
    title: "Verificación de bloqueo y etiquetado",
    tipo: "seguimiento",
    legalFramework: ["DS 44", "Procedimiento LOTO"],
    applicableTo: "Personal de mantención autorizado",
    objective: "Confirmar el uso de barreras críticas antes de intervenir equipos energizados.",
    sections: [{
      id: "barreras-criticas",
      title: "Barreras críticas LOTO",
      countsForCompliance: true,
      items: [
        { id: "candado-personal", label: "Cada trabajador mantiene su candado personal instalado", kind: "cumple_nocumple_na_obs", required: true, danoPotencial: "grave" },
        { id: "energia-cero", label: "La prueba de energía cero queda registrada antes de intervenir", kind: "cumple_nocumple_na_obs", required: true, danoPotencial: "fatal" },
      ],
    }],
    closingAct: { title: "Cierre de verificación", resultOptions: [], signatureRoles: ["Ejecutor", "Supervisor"] },
  }
  await db.insert(schema.pdtpActivities).values({
    id: "pdtp-activity-audit-1",
    programId: "prog-audit-1",
    n: 63,
    displayOrder: 63,
    status: "active",
    activity: "Verificación de controles críticos de bloqueo y etiquetado",
    program: "Programa de Trabajo Preventivo 2026",
    responsibleSlugs: ["prevencion", "supervision"],
    responsibleDisplay: "Prevención y supervisión de mantención",
    audienceRoles: ["mecanico", "supervisor"],
    scheduleMode: "scheduled",
    scheduleClassificationStatus: "confirmed",
    recurrenceRule: { frequency: "monthly" },
    evidenceRequirement: "Checklist firmado, evidencia fotográfica y registro de acciones correctivas.",
    indicatorMode: "planned_vs_completed",
    targetValue: 1,
    targetUnit: "verificación",
    sourceSheetRow: 63,
    notes: "Actividad de control crítico vinculada al procedimiento LOTO.",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.pdtpActivitySchedule).values({
    id: "pdtp-schedule-audit-1",
    activityId: "pdtp-activity-audit-1",
    year: 2026,
    month: 6,
    week: 2,
    plannedQuantity: 1,
    sourceColumn: "JUN-S2",
  })
  await db.insert(schema.pdtpActivityChecklists).values({
    id: "pdtp-checklist-audit-1",
    activityId: "pdtp-activity-audit-1",
    programId: "prog-audit-1",
    version: "01",
    label: "Checklist de verificación LOTO",
    definitionJson: pdtpChecklistDefinition,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.pdtpExecutions).values({
    id: "exec-audit-1",
    activityId: "pdtp-activity-audit-1",
    worksiteId,
    year: 2026,
    month: 6,
    week: 2,
    executedQuantity: 1,
    status: "approved",
    evidenceText: "Checklist de barreras críticas aplicado al tablero eléctrico N.º 2; se identificó una brecha de registro que quedó en plan de acción.",
    evidenceUrl: "captures/pdtp/exec-audit-1-evidencia.pdf",
    evidencePhotos: ["captures/pdtp/exec-audit-1-tablero.jpg"],
    executedByUserId: "user-audit-prevencion",
    executedAt: "2026-06-12T09:30:00.000Z",
    approvedByUserId: userId,
    approvedAt: "2026-06-12T16:00:00.000Z",
    origin: "manual",
    idempotencyKey: "capture-pdtp-exec-audit-1",
    sourceMetadataJson: { source: "capture-audit", permitId: "permit-audit-1" },
    evidenceStatus: "provided",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.pdtpExecutionChecklists).values({
    id: "exec-audit-1-cli-worker-audit-1",
    executionId: "exec-audit-1",
    checklistId: "pdtp-checklist-audit-1",
    definitionSnapshotJson: pdtpChecklistDefinition,
    overallStatus: "completado",
    porcentajeCumplimiento: 50,
    completedByUserId: "user-audit-prevencion",
    completedAt: "2026-06-12T10:00:00.000Z",
    subjectType: "trabajador",
    subjectId: "worker-audit-1",
    subjectLabel: "Daniela Fuentes · operadora",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.pdtpExecutionChecklistResponses).values([
    { id: "exec-response-audit-1", checklistInstanceId: "exec-audit-1-cli-worker-audit-1", seccionId: "barreras-criticas", itemId: "candado-personal", estado: "cumple", observacion: "Candado personal instalado y etiquetado.", respondedByUserId: "user-audit-prevencion", respondedAt: "2026-06-12T09:45:00.000Z" },
    { id: "exec-response-audit-2", checklistInstanceId: "exec-audit-1-cli-worker-audit-1", seccionId: "barreras-criticas", itemId: "energia-cero", estado: "no_cumple", observacion: "La medición fue realizada, pero el folio no quedó registrado en el permiso.", accionCorrectiva: "Incorporar el folio de energía cero al permiso antes de liberar la intervención.", respondedByUserId: "user-audit-prevencion", respondedAt: "2026-06-12T09:50:00.000Z" },
  ])
  // D11: la acción correctiva del PDTP vive en CAPA. El seed apuntaba al espejo
  // y su `capaActionId` colgaba de una CAPA `manual` ajena a esta ejecución.
  await db.insert(schema.preventionCapaActions).values({
    id: "capa-pdtp-audit-1",
    code: "CAPA-2026-0901",
    sourceType: "pdtp",
    sourceId: "exec-audit-1",
    worksiteId,
    finding: "Folio de la prueba de energía cero ausente en el permiso de trabajo.",
    actionDescription: "Actualizar el permiso LOTO y verificar el registro antes de reanudar intervenciones equivalentes.",
    responsibleUserId: "user-audit-prevencion",
    responsibleSnapshot: "Paula Mella",
    responsibleRole: "Supervisor de mantención",
    priority: "high",
    targetDate: "2026-06-19",
    status: "in_progress",
    evidenceRequired: true,
    // A12: de qué ítem del checklist nació.
    sourceRef: { seccionId: "barreras-criticas", itemId: "energia-cero" },
    createdByUserId: "user-audit-prevencion",
    startedByUserId: "user-audit-prevencion",
    startedAt: "2026-06-15T12:00:00.000Z",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionCapaTransitions).values({
    id: "capat-pdtp-audit-1",
    actionId: "capa-pdtp-audit-1",
    changeType: "status",
    fromStatus: "pending",
    toStatus: "in_progress",
    reason: "Formato de permiso actualizado; queda validar en próxima intervención.",
    actorUserId: "user-audit-prevencion",
    createdAt: now,
  })

  // ── Prevención: CGRD (G15, DS 44) ───────────────────────────────────────
  // Faena con 3 trabajadores → corresponde coordinador (umbral 26 personas).
  // El comité activo queda para ws-audit-2: muestra la otra variante de la
  // estructura y su acta cerrada con acuerdo derivado a CAPA.
  await db.insert(schema.preventionGrdCoordinators).values({
    id: "grd-coordinator-audit-1",
    worksiteId,
    workerId: "worker-audit-2",
    designatedOn: shiftCaptureDateMonths(-4, 1),
    status: "active",
    evidenceUrl: "captures/cgrd/coordinador-audit-1-designacion.pdf",
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionGrdCommittees).values({
    id: "grd-committee-audit-1",
    worksiteId: "ws-audit-2",
    name: "CGRD Faena Sur",
    constitutedOn: shiftCaptureDateMonths(-8, 1),
    mandateEndsOn: shiftCaptureDateMonths(16, 1),
    status: "active",
    evidenceUrl: "captures/cgrd/comite-audit-1-constitucion.pdf",
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionGrdMembers).values([
    { id: "grd-member-audit-1", committeeId: "grd-committee-audit-1", workerId: "worker-audit-3", role: "presidente", status: "active", createdAt: now, updatedAt: now },
    { id: "grd-member-audit-2", committeeId: "grd-committee-audit-1", workerId: "worker-audit-1", role: "secretario", status: "active", createdAt: now, updatedAt: now },
  ])
  await db.insert(schema.preventionGrdMatrices).values({
    id: "grd-matrix-audit-1",
    worksiteId: "ws-audit-2",
    matrixVersion: 1,
    title: "Matriz GRD Faena Sur v1",
    status: "published",
    revisionReason: "Constitución del comité y análisis histórico de amenazas del sector.",
    evidenceUrl: "captures/cgrd/matriz-audit-1-publicada.pdf",
    createdByUserId: "user-audit-prevencion",
    publishedByUserId: userId,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionGrdThreats).values([
    {
      id: "grd-threat-audit-1",
      matrixId: "grd-matrix-audit-1",
      name: "Sismo mayor",
      origin: "obligatoria",
      historicalAnalysis: "Chile presenta sismicidad mayor al menos una vez por década en la zona centro-sur.",
      legalRequirement: "DS 44 art. 62 y Plan Nacional de Gestión Preventiva del Riesgo de Desastres.",
      workPlan: "Simulacro anual de evacuación por sismo y reposición de kit de emergencia.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "grd-threat-audit-2",
      matrixId: "grd-matrix-audit-1",
      name: "Incendio forestal de interfaz",
      origin: "detectada",
      historicalAnalysis: "Temporada 2025 registró incendios a menos de 10 km de la faena.",
      legalRequirement: "DS 44 art. 62; recomendación ONEMI/SenaPREDE para zonas de interfaz.",
      workPlan: "Cortafuegos perimetral, protocolo de suspensión de faena y coordinación con CONAF.",
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.preventionGrdMeetings).values({
    id: "grd-meeting-audit-1",
    code: "CGRD-2026-001",
    committeeId: "grd-committee-audit-1",
    heldOn: now,
    agenda: "Revisión de matriz GRD v1, plan de trabajo por amenaza y state de simulacros.",
    minutes: "Se revisó la matriz publicada, se asignó responsable al simulacro anual y se acordó verificar el cortafuegos antes del verano.",
    quorumReached: true,
    evidenceUrl: "captures/cgrd/acta-audit-1.pdf",
    createdByUserId: userId,
    createdAt: now,
  })
  // La CAPA nace antes del acuerdo: en producción `recordGrdMeeting` la crea
  // dentro de la misma transacción que registra el acta, y el acuerdo cuelga
  // de ella (FK). El seed respeta el mismo orden de dependencia.
  const capaCgrdId = `capa-cgrd-audit-${Date.now()}`
  await db.insert(schema.preventionCapaActions).values({
    id: capaCgrdId,
    code: `CAPA-2026-0902-${Date.now()}`,
    sourceType: "cgrd",
    sourceId: "grd-meeting-audit-1",
    worksiteId: "ws-audit-2",
    finding: "Cortafuegos perimetral con acumulación de material combustible en el tramo norte.",
    actionDescription: "Despejar el tramo norte del cortafuegos y programar su revisión trimestral.",
    responsibleUserId: "user-audit-prevencion",
    responsibleSnapshot: "Paula Mella",
    responsibleRole: "Supervisora faena sur",
    priority: "medium",
    targetDate: shiftCaptureDateMonths(1, 15),
    status: "in_progress",
    evidenceRequired: true,
    createdByUserId: "user-audit-prevencion",
    startedByUserId: "user-audit-prevencion",
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionGrdAgreements).values({
    id: "grd-agreement-audit-1",
    meetingId: "grd-meeting-audit-1",
    description: "Verificar el estado del cortafuegos perimetral y despejar el tramo norte.",
    capaActionId: capaCgrdId,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.preventionCapaTransitions).values({
    id: "capat-cgrd-audit-1",
    actionId: capaCgrdId,
    changeType: "status",
    fromStatus: "pending",
    toStatus: "in_progress",
    reason: "Despeje programado con cuadrilla forestal.",
    actorUserId: "user-audit-prevencion",
    createdAt: now,
  })

  // ── Prevención: constancias PDTP (G17) ─────────────────────────────────
  // Actividad de mechanism 'constancia' planificada en meses ya vencidos y
  // sin ejecución aprobada: así /prevencion/constancias muestra la deuda que
  // es la razón de ser del submódulo, no un panel vacío.
  await db.insert(schema.pdtpActivities).values({
    id: "pdtp-activity-constancia-audit-1",
    programId: "prog-audit-1",
    n: 84,
    displayOrder: 84,
    status: "active",
    activity: "Constancia de difusión mensual del reglamento interno",
    program: "Programa de Trabajo Preventivo 2026",
    responsibleSlugs: ["prevencion"],
    responsibleDisplay: "Prevención",
    scheduleMode: "scheduled",
    scheduleClassificationStatus: "confirmed",
    recurrenceRule: { frequency: "monthly" },
    mechanism: "constancia",
    evidenceRequirement: "Constancia firmada por el responsable de faena.",
    indicatorMode: "planned_vs_completed",
    sourceSheetRow: 84,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.pdtpActivitySchedule).values([
    { id: "pdtp-schedule-constancia-audit-1", activityId: "pdtp-activity-constancia-audit-1", year: 2026, month: 5, week: 1, plannedQuantity: 1, sourceColumn: "MAY-S1" },
    { id: "pdtp-schedule-constancia-audit-2", activityId: "pdtp-activity-constancia-audit-1", year: 2026, month: 6, week: 1, plannedQuantity: 1, sourceColumn: "JUN-S1" },
  ])
  // La faena auditable es miembro activo del programa; sin membresía el
  // resolutor de alcance devuelve el vacío y la deuda no aparece.
  await db.insert(schema.pdtpProgramWorksites).values({
    id: "pdtp-program-worksite-audit-1",
    programId: "prog-audit-1",
    worksiteId,
    isActive: true,
    addedByUserId: userId,
    addedAt: now,
  })

  await db.insert(schema.ppaSubmissions).values([
    {
      id: "ppa-audit-1",
      worksiteId,
      workerId: "worker-audit-1",
      workerName: "Daniela Fuentes",
      workerRut: "18.111.222-3",
      workerCompany: "Chome",
      manualIdentificacion: false,
      tipoTrabajo: "conductor_batea",
      esCritica: false,
      answersJson: {
        tipoTrabajo: "conductor_batea",
        cambioPlanificado: "no",
        peligroNoControlado: "no",
        controles: ["epp", "herramientas"],
        seguroComenzar: "si",
        complementarias: {},
      },
      resultado: "autorizado_auto",
      triggeredReasons: [],
      estado: "aprobado_auto",
      // La columna guarda el HASH: `getPpaByToken` compara sólo contra
      // sha256(token), así que sembrar el token en claro dejaba la ruta
      // pública del resultado en 404 en toda captura.
      publicToken: crypto.createHash("sha256").update("capture-ppa-token").digest("hex"),
      createdAt: now,
      updatedAt: now,
    },
  ])

  // ── Combustibles ─────────────────────────────────────────────────────────
  await db.insert(schema.fuelSuppliers).values([
    {
      id: "fuel-sup-audit-1",
      name: "COPEC Los Ángeles",
      rut: "76.555.666-7",
      contactName: "Francisco Muñoz",
      contactEmail: "fmunoz@copec.cl",
      contactPhone: "+56 9 7222 1133",
      notes: "Proveedor principal de combustible para la faena.",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ])

  await db.insert(schema.fuelVehicles).values([
    {
      id: "fuel-veh-audit-1",
      plate: "FD-71-22",
      type: "camioneta",
      equipmentTypeId: "fet-camioneta",
      meterType: "odometer",
      performanceUnit: "km_per_liter",
      brand: "Toyota",
      model: "Hilux 4x4",
      year: 2023,
      worksiteId,
      isActive: true,
      notes: "Vehículo de supervisión, consumo diésel.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "fuel-veh-audit-2",
      plate: "LK-45-10",
      type: "camion",
      equipmentTypeId: "fet-camion",
      meterType: "odometer",
      performanceUnit: "km_per_liter",
      brand: "Mercedes-Benz",
      model: "Atego 1726",
      year: 2022,
      worksiteId,
      isActive: true,
      notes: "Camión de carga para faena Mininco.",
      createdAt: now,
      updatedAt: now,
    },
  ])

  /*
   * Monitoreo GPS Entel OnWay. La página `/flota/monitoreo` une posiciones,
   * alertas, último run y dispositivos sin match. Sin sembrar nada la
   * captura muestra la lista vacía, que es evidencia de "no hay sync" y no
   * de "el módulo existe". Tres posiciones sobre la misma faena y dos
   * alertas bastan para ejercitar la vista de mapa, la tabla y el panel
   * de alertas.
   */
  await db.insert(schema.fleetGpsSyncRuns).values({
    id: "fleet-gps-run-audit-1",
    provider: "onway",
    trigger: "cron",
    status: "success",
    actorUserId: userId,
    devicesReceived: 3,
    devicesAccepted: 3,
    devicesRejected: 0,
    devicesUnmatched: 0,
    alertsReceived: 2,
    pointsReceived: 240,
    tripsReceived: 4,
    startedAt: now,
    finishedAt: now,
  })
  await db.insert(schema.fleetGpsLatestPositions).values([
    {
      id: "fleet-gps-pos-audit-1",
      provider: "onway",
      externalDeviceId: "onway-fd7122",
      externalGroupId: "mininco",
      vehicleId: "fuel-veh-audit-1",
      worksiteId,
      sourcePlate: "FD-71-22",
      normalizedPlate: "FD-71-22",
      latitude: -37.4716,
      longitude: -72.3527,
      speedKph: 0,
      headingDegrees: 0,
      ignition: true,
      sourceStatus: "moving",
      gpsReportedAt: now,
      gprsReportedAt: now,
      gpsStatus: "ok",
      gprsStatus: "ok",
      movementState: "stopped",
      odometer: 134122,
      hourMeter: 8421,
      observedAt: now,
      syncRunId: "fleet-gps-run-audit-1",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "fleet-gps-pos-audit-2",
      provider: "onway",
      externalDeviceId: "onway-lk4510",
      externalGroupId: "mininco",
      vehicleId: "fuel-veh-audit-2",
      worksiteId,
      sourcePlate: "LK-45-10",
      normalizedPlate: "LK-45-10",
      latitude: -37.4724,
      longitude: -72.3501,
      speedKph: 28.5,
      headingDegrees: 84,
      ignition: true,
      sourceStatus: "moving",
      gpsReportedAt: now,
      gprsReportedAt: now,
      gpsStatus: "ok",
      gprsStatus: "ok",
      movementState: "moving",
      odometer: 220118,
      hourMeter: 11020,
      observedAt: now,
      syncRunId: "fleet-gps-run-audit-1",
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.fleetGpsAlerts).values([
    {
      id: "fleet-gps-alert-audit-1",
      provider: "onway",
      externalDeviceId: "onway-lk4510",
      externalEventKey: "onway-lk4510-speeding-2026-06-09",
      vehicleId: "fuel-veh-audit-2",
      worksiteId,
      alertType: "speeding",
      category: "operational",
      title: "Exceso de velocidad detectado en faena",
      priority: "medium",
      occurredAt: now,
      latitude: -37.4724,
      longitude: -72.3501,
      speedKph: 78.4,
      processingStatus: "new",
    },
    {
      id: "fleet-gps-alert-audit-2",
      provider: "onway",
      externalDeviceId: "onway-fd7122",
      externalEventKey: "onway-fd7122-ignition-2026-06-09",
      vehicleId: "fuel-veh-audit-1",
      worksiteId,
      alertType: "ignition_off_outside_hours",
      category: "operational",
      title: "Encendido fuera de horario operativo",
      priority: "low",
      occurredAt: now,
      latitude: -37.4716,
      longitude: -72.3527,
      processingStatus: "ignored",
    },
  ])

  await db.insert(schema.maintenanceRecords).values({
    id: "maint-audit-1",
    code: "OT-2026-0001",
    vehicleId: "fuel-veh-audit-1",
    worksiteId,
    maintenanceDate: "2026-06-20",
    maintenanceType: "preventiva",
    status: "scheduled",
    priority: "normal",
    operationalImpact: "maintenance",
    netAmount: 180_000,
    taxAmount: 34_200,
    totalAmount: 214_200,
    notes: "Mantención preventiva de referencia para captura.",
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  })

  await db.insert(schema.fuelImportBatches).values({
    id: "fuel-import-audit-1",
    worksiteId,
    fuente: "COPEC TCT",
    periodoDesde: "2026-06-01",
    periodoHasta: "2026-06-30",
    archivoNombre: "consumo-copec-junio-2026.xlsx",
    archivoPath: "storage/captures/consumo-copec-junio-2026.xlsx",
    hashArchivo: "capture-fuel-import-audit-1",
    estado: "importado",
    totalFilas: 2,
    filasValidas: 2,
    filasInvalidas: 0,
    totalPatentes: 2,
    totalTarjetas: 2,
    totalTransacciones: 5,
    totalCantidad: 237.8,
    totalMonto: 402154,
    importadoPor: userId,
    notas: "Lote de consumo preparado para certificar detalle y conciliación de patente.",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.fuelConsumptionRecords).values([
    {
      id: "fuel-consumption-audit-1",
      batchId: "fuel-import-audit-1",
      worksiteId,
      vehicleId: "fuel-veh-audit-1",
      patente: "FD-71-22",
      numeroTarjetas: 1,
      numeroTransacciones: 3,
      cantidadUnidad: 152.3,
      monto: 257387,
      rendimientoPromedio: 9.4,
      precioPromedioUnidad: 1690,
      periodoDesde: "2026-06-01",
      periodoHasta: "2026-06-30",
      fuente: "COPEC TCT",
      rawRow: { patente: "FD-71-22", litros: 152.3 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "fuel-consumption-audit-2",
      batchId: "fuel-import-audit-1",
      worksiteId,
      vehicleId: null,
      patente: "ZZ-99-88",
      numeroTarjetas: 1,
      numeroTransacciones: 2,
      cantidadUnidad: 85.5,
      monto: 144767,
      rendimientoPromedio: 0,
      precioPromedioUnidad: 1693.18,
      periodoDesde: "2026-06-01",
      periodoHasta: "2026-06-30",
      fuente: "COPEC TCT",
      rawRow: { patente: "ZZ-99-88", litros: 85.5 },
      createdAt: now,
      updatedAt: now,
    },
  ])

  await db.insert(schema.fuelOperationBatches).values({
    id: "fuel-op-audit-1",
    archivoNombre: "log-operacional-combustibles-junio-2026.xlsx",
    archivoPath: "storage/captures/log-operacional-combustibles-junio-2026.xlsx",
    hashArchivo: "capture-fuel-operation-audit-1",
    estado: "importado",
    periodoDesde: "2026-06-01",
    periodoHasta: "2026-06-30",
    totalFilas: 2,
    filasValidas: 2,
    filasInvalidas: 0,
    totalEquipos: 2,
    totalLitros: 203.5,
    totalMonto: 344718,
    importadoPor: userId,
    notas: "Lote operativo con una faena pendiente para comprobar la corrección asistida.",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.fuelOperationRecords).values([
    {
      id: "fuel-operation-record-audit-1",
      batchId: "fuel-op-audit-1",
      worksiteId,
      vehicleId: "fuel-veh-audit-1",
      plate: "FD-71-22",
      code: "CAM-01",
      faenaNombre: "Faena Mininco",
      tipo: "Camioneta",
      marca: "Toyota",
      modelo: "Hilux 4x4",
      anio: 2023,
      fecha: "2026-06-08",
      horaCarga: "09:30",
      horometro: 45820,
      medidoPor: "km",
      liters: 98.5,
      operador: "Daniela Fuentes",
      supervisor: "Marco Silva",
      proveedorNombre: "COPEC Los Ángeles",
      fuelSupplierId: "fuel-sup-audit-1",
      precioLitro: 1690,
      monto: 166465,
      rendimiento: 9.4,
      tipoRendimiento: "km_lt",
      rawRow: { fecha: "2026-06-08", patente: "FD-71-22" },
      createdAt: now,
    },
    {
      id: "fuel-operation-record-audit-2",
      batchId: "fuel-op-audit-1",
      worksiteId: null,
      vehicleId: null,
      plate: "AB-12-34",
      code: "EQ-LEG-77",
      faenaNombre: "Faena histórica sin equivalencia",
      tipo: "Camión",
      marca: "Mercedes-Benz",
      modelo: "Atego 1726",
      anio: 2022,
      fecha: "2026-06-12",
      horaCarga: "14:10",
      horometro: 2860,
      medidoPor: "hora",
      liters: 105,
      operador: "Operador histórico",
      supervisor: "Supervisor histórico",
      proveedorNombre: "COPEC Los Ángeles",
      fuelSupplierId: "fuel-sup-audit-1",
      precioLitro: 1697.65,
      monto: 178253,
      rendimiento: 12.1,
      tipoRendimiento: "lt_hr",
      rawRow: { fecha: "2026-06-12", patente: "AB-12-34" },
      createdAt: now,
    },
  ])

  await db.insert(schema.fuelTaeLoadingPoints).values({
    id: "tae-point-audit-1",
    worksiteId,
    name: "Estanque móvil Mininco",
    type: "truck_dispenser",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })

  await db.insert(schema.fuelMonthlyStatements).values([
    {
      id: "cc-audit-1",
      month: "2026-06",
      fuelSupplierId: "fuel-sup-audit-1",
      totalLiters: 850,
      totalBaseAmount: 1428000,
      totalIec: 102000,
      totalIva: 290700,
      totalAmount: 1820700,
      paidAmount: 910350,
      dueDate: "2026-07-15",
      status: "partial",
      notes: "Estado de cuenta parcial de junio 2026.",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    },
  ])

  await db.insert(schema.fuelLoads).values([
    {
      id: "fuel-audit-1",
      statementId: "cc-audit-1",
      loadDate: "2026-06-09",
      month: "2026-06",
      serviceType: "TCT",
      vehicleId: "fuel-veh-audit-1",
      fuelSupplierId: "fuel-sup-audit-1",
      worksiteId,
      product: "PETROLEO DIESEL",
      productId: "fuel-diesel",
      receiptNumber: "B-88231",
      odometerReading: 45820,
      hourMeterReading: null,
      liters: 85.5,
      iecFixed: 5130,
      iecVariable: 5130,
      baseAmount: 145350,
      iecTotal: 10260,
      ivaAmount: 26262,
      totalAmount: 181872,
      status: "registered",
      notes: "Carga regular para vehículo de supervisión.",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    },
  ])

  await db.insert(schema.fuelTaeSubmissions).values({
    id: "tae-audit-1",
    clientSubmissionId: "capture-tae-submission-1",
    source: "public_pwa",
    publicResultToken: "capture-tae-result-token",
    worksiteId,
    loadingPointId: "tae-point-audit-1",
    vehicleId: "fuel-veh-audit-1",
    productId: "fuel-diesel",
    equipmentCodeSnapshot: "FD-71-22",
    plateSnapshot: "FD-71-22",
    loadedAt: "2026-06-09T10:30:00.000Z",
    submittedAt: now,
    driverWorkerId: "worker-audit-1",
    driverNameSnapshot: "Daniela Fuentes",
    supervisorWorkerId: "worker-audit-2",
    supervisorNameSnapshot: "Marco Silva",
    meterType: "odometer",
    meterReading: 45820,
    meterReadingSource: "manual",
    liters: 85.5,
    status: "validated",
    reviewNote: "Carga TAE validada para la auditoría visual.",
    reviewedBy: userId,
    reviewedAt: now,
    createdAt: now,
    updatedAt: now,
  })

  await db.insert(schema.fuelTaeImportBatches).values({
    id: "tae-import-audit-1",
    fileName: "historico-tae-junio-2026.xlsx",
    filePath: "storage/captures/historico-tae-junio-2026.xlsx",
    fileHash: "capture-tae-import-audit-1",
    status: "imported",
    totalRows: 2,
    validRows: 1,
    observedRows: 1,
    invalidRows: 1,
    totalLiters: 74.2,
    importedBy: userId,
    notes: "Histórico de TAE con una identidad que requiere decisión y una fila rechazada trazable.",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.fuelTaeSubmissions).values({
    id: "tae-import-submission-audit-1",
    clientSubmissionId: "capture-tae-import-submission-1",
    importBatchId: "tae-import-audit-1",
    source: "legacy_xlsx",
    legacySourceId: "TAE-HIST-00021",
    publicResultToken: "capture-tae-import-result-token-1",
    worksiteId,
    loadingPointId: "tae-point-audit-1",
    vehicleId: null,
    productId: "fuel-diesel",
    equipmentCodeSnapshot: "EQ-LEG-77",
    plateSnapshot: "AB-12-34",
    loadedAt: "2026-06-05T08:45:00.000Z",
    submittedAt: now,
    driverWorkerId: null,
    driverNameSnapshot: "Conductor histórico",
    supervisorWorkerId: "worker-audit-2",
    supervisorNameSnapshot: "Marco Silva",
    meterType: "hour_meter",
    meterReading: 2860,
    meterReadingSource: "import",
    liters: 74.2,
    status: "observed",
    reviewNote: "Requiere asociar equipo y conductor del registro histórico.",
    rawRow: { equipo: "EQ-LEG-77", conductor: "Conductor histórico", litros: 74.2 },
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.fuelTaeImportRejections).values({
    id: "tae-import-rejection-audit-1",
    batchId: "tae-import-audit-1",
    rowIndex: 3,
    stage: "worksite",
    field: "Faena",
    message: "No fue posible asociar la faena histórica 'Base externa'.",
    legacySourceId: "TAE-HIST-00022",
    rawRow: { faena: "Base externa", equipo: "EQ-LEG-78" },
    createdAt: now,
  })

  await db.insert(schema.fuelPayments).values([
    {
      id: "fuel-pay-audit-1",
      statementId: "cc-audit-1",
      paymentDate: "2026-06-20",
      amount: 910350,
      paymentMethod: "transferencia",
      reference: "TRF-2026-0610",
      notes: "Pago parcial estado de cuenta junio.",
      createdBy: userId,
      createdAt: now,
    },
  ])

  await db.insert(schema.purchaseOrders).values([
    {
      id: orderId,
      code: "OC-2026-0001",
      worksiteId,
      supplierId,
      createdBy: userId,
      // El ítem de esta OC va con 6 de 12 recibidas en oficina y en faena, así
      // que `recalcOrderStatus` (lib/services/receiving.ts) la dejaría en
      // `partially_received`: hay `anyFaena` y no `allFaena`. Estaba en `sent`,
      // un estado que el servicio nunca habría producido con esas cantidades, y
      // eso hizo que la auditoría UI/UX 2026-07-29 reportara como bug del
      // stepper (A-10) lo que era incoherencia del fixture. El seed escribe
      // filas sin pasar por el servicio: le toca a él mantener el invariante.
      status: "partially_received",
      issuedAt: now,
      sentAt: now,
      estimatedDelivery: "2026-06-18",
      deliveryAddress: "Bodega central Mininco",
      paymentTerms: "30 días",
      netAmount: 142800,
      taxAmount: 27132,
      totalAmount: 169932,
      notes: "Compra auditada para capturas.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: officeOrderId,
      code: "OC-2026-0002",
      worksiteId,
      supplierId: "sup-audit-2",
      createdBy: "user-audit-jefa",
      status: "office_received",
      issuedAt: now,
      sentAt: now,
      confirmedAt: now,
      estimatedDelivery: "2026-06-22",
      deliveryAddress: "Oficina Chome Los Ángeles",
      paymentTerms: "Contado",
      netAmount: 66400,
      taxAmount: 12616,
      totalAmount: 79016,
      notes: "OC con recepción de oficina pendiente de despacho a faena.",
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.purchaseOrderItems).values([
    {
      id: orderItemId,
      purchaseOrderId: orderId,
      requestItemId,
      productId,
      quantity: 12,
      unitOfMeasure: "par",
      unitPrice: 11900,
      discount: 0,
      subtotal: 142800,
      quantityOfficeReceived: 6,
      quantityReceived: 6,
      // ARQ-12: purchase_order_items.status sólo es 'issued'/'cancelled'.
      status: "issued",
      sortOrder: 0,
      notes: "Entrega parcial coordinada.",
    },
    {
      id: officeOrderItemId,
      purchaseOrderId: officeOrderId,
      requestItemId: null,
      productId: "prod-audit-2",
      quantity: 8,
      unitOfMeasure: "rollo",
      unitPrice: 8300,
      discount: 0,
      subtotal: 66400,
      quantityOfficeReceived: 8,
      quantityReceived: 0,
      status: "issued",
      sortOrder: 0,
      notes: "Recibido en oficina, pendiente para faena.",
    },
  ])

  await db.insert(schema.purchaseOrderInvoices).values([
    {
      id: "invoice-audit-1",
      purchaseOrderId: orderId,
      invoiceNumber: "F-88231",
      amount: 169932,
      issueDate: "2026-06-18",
      fileName: "factura-oc-2026-0001.pdf",
      filePath: "storage/purchase-orders/factura-oc-2026-0001.pdf",
      fileSize: 348120,
      mimeType: "application/pdf",
      uploadedBy: userId,
      uploadedAt: now,
    },
  ])

  await db.insert(schema.receipts).values([
    {
      id: receiptId,
      code: "REC-2026-0001",
      purchaseOrderId: orderId,
      receivedBy: userId,
      receivedAt: now,
      locationType: "faena",
      worksiteId,
      dispatchGuideNo: "GD-88231",
      status: "open",
      notes: "Recepción parcial sin rechazo.",
      createdAt: now,
    },
    {
      id: officeReceiptId,
      code: "REC-2026-0002",
      purchaseOrderId: officeOrderId,
      receivedBy: "user-audit-bodega",
      receivedAt: now,
      locationType: "office",
      worksiteId: null,
      dispatchGuideNo: "GD-88232",
      status: "open",
      notes: "Recepción en oficina pendiente de traslado.",
      createdAt: now,
    },
  ])
  await db.insert(schema.receiptItems).values([
    {
      id: "rec-item-audit-1",
      receiptId,
      purchaseOrderItemId: orderItemId,
      quantityReceived: 6,
      quantityRejected: 0,
      quantityDamaged: 0,
      status: "partially_received",
      notes: "Saldo pendiente proveedor.",
    },
    {
      id: "rec-item-audit-office",
      receiptId: officeReceiptId,
      purchaseOrderItemId: officeOrderItemId,
      quantityReceived: 8,
      quantityRejected: 0,
      quantityDamaged: 0,
      status: "received",
      notes: "Ingreso a oficina sin observaciones.",
    },
  ])

  await db.insert(schema.worksiteStock).values([
    {
      id: "stock-audit-1",
      worksiteId,
      productId,
      quantity: 6,
      minStock: 10,
      lastMovementAt: now,
      updatedAt: now,
    },
    {
      id: "stock-audit-2",
      worksiteId,
      productId: deliverableProductId,
      quantity: 3,
      minStock: 2,
      lastMovementAt: now,
      updatedAt: now,
    },
    {
      id: "stock-audit-3",
      worksiteId: "ws-audit-2",
      productId: "prod-audit-2",
      quantity: 14,
      minStock: 5,
      lastMovementAt: now,
      updatedAt: now,
    },
    // Saldos que sostienen la GDI despachada: 20 en oficina menos las 4 que
    // salieron, y las mismas 4 abonadas en la faena de destino.
    {
      id: "stock-audit-office",
      worksiteId: officeWorksiteId,
      productId: "prod-audit-2",
      quantity: 16,
      minStock: 8,
      lastMovementAt: now,
      updatedAt: now,
    },
    {
      id: "stock-audit-4",
      worksiteId,
      productId: "prod-audit-2",
      quantity: 4,
      minStock: 2,
      lastMovementAt: now,
      updatedAt: now,
    },
  ])
  // `inventoryMovements.quantity` es un delta CON SIGNO (ver lib/services/stock-movement.ts):
  // positivo = ingreso, negativo = egreso. Este seed escribe filas directas sin pasar por
  // applyMovement, así que la invariante se valida aquí — una fila que la viole produce
  // capturas engañosas (un egreso rendereado como "+2" con el saldo bajando).
  const auditMovements = [
    {
      id: "mov-audit-1",
      worksiteId,
      productId,
      type: "ingreso_oc",
      quantity: 6,
      referenceType: "purchase_order",
      referenceId: receiptId,
      stockBefore: 0,
      stockAfter: 6,
      performedBy: userId,
      performedAt: now,
      reason: "Recepción parcial OC-2026-0001",
    },
    {
      id: "mov-audit-2",
      worksiteId,
      productId: deliverableProductId,
      type: "ingreso_oc",
      quantity: 5,
      referenceType: "purchase_order",
      referenceId: deliveryRequestId,
      stockBefore: 0,
      stockAfter: 5,
      performedBy: "user-audit-bodega",
      performedAt: now,
      reason: "Ingreso EPP para entrega nominal",
    },
    {
      id: "mov-audit-3",
      worksiteId,
      productId: deliverableProductId,
      type: "egreso_entrega",
      quantity: -2,
      referenceType: "delivery",
      referenceId: deliveryId,
      stockBefore: 5,
      stockAfter: 3,
      performedBy: "user-audit-bodega",
      performedAt: now,
      reason: "Entrega parcial a trabajador",
    },
    {
      // Saldo inicial de la oficina. Sin esta fila el kardex de la oficina
      // sumaba -4: el egreso del traslado sin el ingreso que lo financió.
      id: "mov-audit-office-ajuste",
      worksiteId: officeWorksiteId,
      productId: "prod-audit-2",
      type: "ajuste",
      quantity: 20,
      referenceType: "manual",
      referenceId: "carga-inicial-oficina",
      stockBefore: 0,
      stockAfter: 20,
      performedBy: "user-audit-bodega",
      performedAt: now,
      reason: "Carga inicial de bodega de oficina",
    },
    {
      id: "mov-audit-4",
      worksiteId: officeWorksiteId,
      productId: "prod-audit-2",
      type: "egreso_traslado",
      quantity: -4,
      referenceType: "dispatch_guide",
      referenceId: "gdi-audit-1",
      stockBefore: 20,
      stockAfter: 16,
      performedBy: "user-audit-bodega",
      performedAt: now,
      reason: "Guía GDI-000001 · salida a Faena Mininco",
    },
    {
      id: "mov-audit-5",
      worksiteId,
      productId: "prod-audit-2",
      type: "ingreso_traslado",
      quantity: 4,
      referenceType: "dispatch_guide",
      referenceId: "gdi-audit-1",
      stockBefore: 0,
      stockAfter: 4,
      performedBy: "user-audit-bodega",
      performedAt: now,
      reason: "Guía GDI-000001 · ingreso desde Oficina CHOME",
    },
  ]
  for (const m of auditMovements) {
    if (m.stockAfter !== m.stockBefore + m.quantity) {
      throw new Error(
        `Seed inconsistente en ${m.id}: stockBefore(${m.stockBefore}) + quantity(${m.quantity}) != stockAfter(${m.stockAfter})`,
      )
    }
  }
  await db.insert(schema.inventoryMovements).values(auditMovements)

  await db.insert(schema.deliveries).values({
    id: deliveryId,
    code: "ENT-2026-0001",
    deliveredBy: userId,
    deliveredAt: now,
    destinationType: "worker",
    worksiteId,
    workerId: "worker-audit-1",
    receiverName: "Daniela Fuentes",
    notes: "Entrega parcial a trabajador.",
    createdAt: now,
  })
  await db.insert(schema.deliveryItems).values({
    id: "del-item-audit-1",
    deliveryId,
    requestItemId: deliverableRequestItemId,
    productId: deliverableProductId,
    quantity: 2,
    unitOfMeasure: "unidad",
    notes: "Entrega inicial.",
  })

  await db.insert(schema.attachments).values([
    {
      id: "att-audit-1",
      entityType: "purchase_order",
      entityId: orderId,
      fileName: "factura-oc-2026-0001.pdf",
      filePath: "/uploads/factura-oc-2026-0001.pdf",
      fileSize: 348120,
      mimeType: "application/pdf",
      uploadedBy: userId,
      uploadedAt: now,
    },
    {
      id: "att-audit-delivery-1",
      entityType: "delivery",
      entityId: deliveryId,
      fileName: "comprobante-entrega-2026-0001.pdf",
      filePath: "/uploads/comprobante-entrega-2026-0001.pdf",
      fileSize: 128420,
      mimeType: "application/pdf",
      uploadedBy: "user-audit-bodega",
      uploadedAt: now,
    },
  ])
  await db.insert(schema.auditLog).values([
    {
      id: "audit-audit-1",
      userId,
      userEmail: "admin.audit@chome.cl",
      action: "create",
      entityType: "purchase_request",
      entityId: requestId,
      entityCode: "SOL-2026-0001",
      newState: JSON.stringify({ status: "submitted" }),
      createdAt: now,
    },
    {
      id: "audit-audit-2",
      userId,
      userEmail: "admin.audit@chome.cl",
      action: "status_change",
      entityType: "purchase_order",
      entityId: orderId,
      entityCode: "OC-2026-0001",
      oldState: JSON.stringify({ status: "issued" }),
      newState: JSON.stringify({ status: "sent" }),
      createdAt: now,
    },
    {
      id: "audit-audit-3",
      userId: "user-audit-bodega",
      userEmail: "bodega.audit@chome.cl",
      action: "create",
      entityType: "delivery",
      entityId: deliveryId,
      entityCode: "ENT-2026-0001",
      newState: JSON.stringify({ destinationType: "worker", quantity: 2 }),
      createdAt: now,
    },
    {
      id: "audit-audit-4",
      userId: userId,
      userEmail: "admin.audit@chome.cl",
      action: "update",
      entityType: "system_settings",
      entityId: "company_name",
      entityCode: "Configuración",
      oldState: JSON.stringify({ value: "Chome" }),
      newState: JSON.stringify({ value: "Chome Operaciones" }),
      reason: "Actualización de datos para capturas",
      createdAt: now,
    },
  ])
  await db.insert(schema.statusHistory).values([
    {
      id: "status-audit-1",
      entityType: "purchase_request",
      entityId: requestId,
      fromStatus: "draft",
      toStatus: "submitted",
      changedBy: "user-audit-prevencion",
      reason: "Solicitud enviada a aprobación.",
      changedAt: now,
    },
    {
      id: "status-audit-2",
      entityType: "purchase_request",
      entityId: requestId,
      fromStatus: "submitted",
      toStatus: "partially_approved",
      changedBy: "user-audit-jefa",
      reason: "Aprobación parcial para compra.",
      changedAt: now,
    },
    {
      id: "status-audit-rep-1",
      entityType: "purchase_request",
      entityId: repuestoRequestId,
      fromStatus: "draft",
      toStatus: "submitted",
      changedBy: "user-audit-prevencion",
      reason: "Cotización adjunta para evaluación.",
      changedAt: now,
    },
    {
      id: "status-audit-srv-1",
      entityType: "purchase_request",
      entityId: serviceRequestId,
      fromStatus: "draft",
      toStatus: "submitted",
      changedBy: "user-audit-prevencion",
      reason: "Servicio externo enviado a evaluación.",
      changedAt: now,
    },
    // El seed sólo sembraba historial de solicitudes, así que la pestaña
    // "Historial" del detalle de OC salía vacía en TODA captura y nadie la había
    // revisado nunca (auditoría UI/UX 2026-07-29). El rastro reproduce el camino
    // que el servicio habría escrito para llegar a `partially_received`.
    {
      id: "status-audit-oc-1",
      entityType: "purchase_order",
      entityId: orderId,
      fromStatus: null,
      toStatus: "draft",
      changedBy: userId,
      reason: "Orden creada a partir de ítems aprobados.",
      changedAt: now,
    },
    {
      id: "status-audit-oc-2",
      entityType: "purchase_order",
      entityId: orderId,
      fromStatus: "draft",
      toStatus: "issued",
      changedBy: "user-audit-jefa",
      reason: "Orden emitida para envío al proveedor.",
      changedAt: now,
    },
    {
      id: "status-audit-oc-3",
      entityType: "purchase_order",
      entityId: orderId,
      fromStatus: "issued",
      toStatus: "sent",
      changedBy: "user-audit-jefa",
      reason: "Enviada a TRECK Seguridad Industrial.",
      changedAt: now,
    },
    {
      id: "status-audit-oc-4",
      entityType: "purchase_order",
      entityId: orderId,
      fromStatus: "sent",
      toStatus: "partially_received",
      changedBy: "user-audit-bodega",
      reason: "Llegada parcial: 6 de 12 pares.",
      changedAt: now,
    },
    {
      id: "status-audit-oc-office-1",
      entityType: "purchase_order",
      entityId: officeOrderId,
      fromStatus: "sent",
      toStatus: "office_received",
      changedBy: "user-audit-bodega",
      reason: "Recibida completa en oficina Chome, pendiente de despacho.",
      changedAt: now,
    },
  ])
  await db.insert(schema.notifications).values([
    {
      id: "noti-audit-1",
      userId,
      type: "request_submitted",
      title: "Nueva solicitud: SOL-2026-0001",
      body: "Prevencionista Faena envió una solicitud con 2 ítems",
      entityType: "purchase_request",
      entityId: requestId,
      entityHref: `/solicitudes/${requestId}`,
      isRead: false,
      createdAt: now,
    },
    {
      id: "noti-audit-2",
      userId,
      type: "oc_sent",
      title: "OC enviada: OC-2026-0001",
      body: "La orden de compra fue enviada al proveedor TRECK.",
      entityType: "purchase_order",
      entityId: orderId,
      entityHref: `/compras/${orderId}`,
      isRead: true,
      createdAt: now,
    },
    {
      id: "noti-audit-3",
      userId,
      type: "dispatch_done",
      title: "Entrega registrada: ENT-2026-0001",
      body: "Se registró una entrega nominal de EPP.",
      entityType: "delivery",
      entityId: deliveryId,
      entityHref: "/entregas",
      isRead: false,
      createdAt: now,
    },
  ])
  await db.insert(schema.feedbackReports).values([
    {
      id: "sop-audit-1",
      tipo: "bug",
      titulo: "Validar detalle de importación desde soporte",
      descripcion: "El equipo operativo reportó que necesita revisar el lote y sus filas antes de confirmar cambios en el catálogo.",
      pagina: "/admin/productos/importar/batch-audit-1",
      priority: "alta",
      dueAt: "2026-06-12T12:00:00.000Z",
      estado: "en_progreso",
      notaInterna: "Fixture de auditoría: validar flujo de revisión y respuesta del gestor.",
      createdBy: "user-audit-prevencion",
      resolvedBy: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sop-audit-2",
      tipo: "consulta",
      titulo: "Consulta resuelta sobre lectura TAE",
      descripcion: "La carga fue explicada y el operador recibió la guía de conciliación.",
      pagina: "/combustibles/tae",
      priority: "normal",
      dueAt: "2026-06-10T12:00:00.000Z",
      estado: "resuelto",
      notaInterna: "Cierre incluido para que la lista tenga estados diversos.",
      createdBy: "user-audit-prevencion",
      resolvedBy: userId,
      resolvedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ])
  // ── Guías de Despacho Internas (Oficina → Faena) ─────────────────────────
  // Una guía despachada (con sus dos patas de kardex más arriba) y un borrador,
  // que es el único estado en que el editor abre.
  await db.insert(schema.dispatchGuides).values([
    {
      id: "gdi-audit-1",
      code: "GDI-000001",
      status: "dispatched",
      originWorksiteId: officeWorksiteId,
      destinationWorksiteId: worksiteId,
      issuedBy: "user-audit-bodega",
      issuedAt: now,
      dispatcherWorkerId: "worker-audit-2",
      receiverWorkerId: "worker-audit-1",
      notes: "Traslado de insumos de señalización para el frente de mantención.",
      dispatchedAt: now,
      dispatchedBy: "user-audit-bodega",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "gdi-audit-2",
      code: "GDI-000002",
      status: "draft",
      originWorksiteId: officeWorksiteId,
      destinationWorksiteId: "ws-audit-2",
      issuedBy: "user-audit-bodega",
      issuedAt: now,
      dispatcherWorkerId: "worker-audit-2",
      notes: "Preparación pendiente de confirmar con la faena.",
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.dispatchGuideItems).values([
    { id: "gdi-item-audit-1", guideId: "gdi-audit-1", productId: "prod-audit-2", quantity: 4, unitOfMeasure: "rollo", sortOrder: 0 },
    { id: "gdi-item-audit-2", guideId: "gdi-audit-2", productId: "prod-audit-2", quantity: 2, unitOfMeasure: "rollo", sortOrder: 0 },
  ])
  await db.insert(schema.statusHistory).values([
    { id: "status-audit-gdi-1", entityType: "dispatch_guide", entityId: "gdi-audit-1", fromStatus: null, toStatus: "draft", changedBy: "user-audit-bodega", changedAt: now },
    { id: "status-audit-gdi-2", entityType: "dispatch_guide", entityId: "gdi-audit-1", fromStatus: "draft", toStatus: "dispatched", changedBy: "user-audit-bodega", reason: "Despacho confirmado en oficina.", changedAt: now },
    { id: "status-audit-gdi-3", entityType: "dispatch_guide", entityId: "gdi-audit-2", fromStatus: null, toStatus: "draft", changedBy: "user-audit-bodega", changedAt: now },
  ])

  // ── Equipos de servicio (instrumentos que se mandan a calibrar) ───────────
  await db.insert(schema.serviceEquipment).values([
    {
      id: "equip-audit-1",
      code: "MG-014",
      name: "Detector monogás H2S",
      kind: "monogas",
      brand: "Draeger",
      model: "Pac 6500",
      serialNumber: "ARJH-0142",
      worksiteId,
      isActive: true,
      notes: "Calibración anual vigente; se envía a laboratorio cada 12 meses.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "equip-audit-2",
      code: "ALC-003",
      name: "Alcotest de control de acceso",
      kind: "alcotest",
      brand: "Draeger",
      model: "Alcotest 6820",
      serialNumber: "ARBB-0031",
      worksiteId: "ws-audit-2",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ])

  // ── Prevención: alcotest (G14, DO-48) ───────────────────────────────────
  // Controles con resultado distinto (uno de tercero, sin worker) y el envío
  // mensual del lote del mes anterior. Sin esto /prevencion/alcotest se
  // capturaba vacía. Va después de service_equipment porque el control
  // referencia al alcotómetro ALC-003 (equip-audit-2).
  await db.insert(schema.alcoholTests).values([
    {
      id: "alcohol-test-audit-1",
      worksiteId,
      performedByUserId: "user-audit-prevencion",
      testedWorkerId: "worker-audit-1",
      equipmentId: "equip-audit-2",
      shift: "dia",
      performedAt: now,
      result: "negativo",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "alcohol-test-audit-2",
      worksiteId,
      performedByUserId: "user-audit-prevencion",
      testedPersonName: "Chofer proveedor Transportes RB",
      shift: "noche",
      performedAt: now,
      result: "negativo",
      createdAt: now,
      updatedAt: now,
    },
  ])
  // DO-48 reporta el lote del mes anterior al envío; chileDateParts().month - 1
  // con wrap a diciembre del año previo (el CHECK exige mes 1–12).
  const chileNow = chileDateParts(now)
  const dispatchReportYear = chileNow.month === 1 ? chileNow.year - 1 : chileNow.year
  const dispatchReportMonth = chileNow.month === 1 ? 12 : chileNow.month - 1
  await db.insert(schema.alcoholTestDispatches).values({
    id: "alcohol-dispatch-audit-1",
    worksiteId,
    year: dispatchReportYear,
    month: dispatchReportMonth,
    sentByUserId: "user-audit-prevencion",
    sentAt: now,
    recipient: "Administrador de contrato — Mandante",
    testCount: 2,
    createdAt: now,
    updatedAt: now,
  })

  // ── Visitas, fiscalizaciones y coordinación (DS 44 art. 20 y 70) ──────────
  await db.insert(schema.preventionExternalEngagements).values([
    {
      id: "eng-audit-1",
      code: "VIS-2026-001",
      worksiteId,
      kind: "fiscalizacion",
      direction: "received",
      counterpartyType: "direccion_trabajo",
      counterpartyName: "Inspección Provincial del Trabajo de Concepción",
      counterpartyRut: "61.502.000-9",
      occurredOn: "2026-06-04",
      subject: "Fiscalización programada de condiciones sanitarias y ambientales básicas.",
      summary: "Se revisaron servicios higiénicos, comedor y registro de entrega de EPP.",
      outcome: "Dos observaciones sin multa; plazo de 15 días para acreditar corrección.",
      officialReference: "F-8.1-2026-1174",
      createdByUserId: userId,
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "eng-audit-2",
      code: "VIS-2026-002",
      worksiteId,
      kind: "coordinacion",
      direction: "delivered",
      counterpartyType: "mandante",
      counterpartyName: "Forestal Arauco S.A.",
      occurredOn: "2026-05-28",
      subject: "Entrega de información preventiva al mandante del centro de trabajo.",
      summary: "Se entregó matriz de riesgos, programa de trabajo y nómina de trabajadores.",
      infoTypes: ["riesgos", "programa_preventivo", "dotacion"],
      createdByUserId: "user-audit-prevencion",
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
  ])
  // Medida prescrita por la fiscalización: el detalle de la visita se lee como
  // el acta que originó la acción correctiva, no como una lista suelta.
  await db.insert(schema.preventionCapaActions).values({
    id: "capa-audit-engagement",
    code: "CAPA-2026-014",
    sourceType: "external_engagement",
    sourceId: "eng-audit-1",
    worksiteId,
    finding: "Comedor sin lavamanos habilitado durante el turno de tarde.",
    immediateMeasure: "Se habilitó un lavamanos portátil el mismo día de la visita.",
    actionDescription: "Instalar lavamanos fijo y dejar registro de mantención semanal.",
    responsibleUserId: "user-audit-prevencion",
    responsibleSnapshot: "Prevencionista Faena",
    responsibleRole: "prevencionista",
    priority: "high",
    targetDate: "2026-06-19",
    status: "in_progress",
    evidenceRequired: true,
    requiresImmediateStop: false,
    createdByUserId: userId,
    startedByUserId: "user-audit-prevencion",
    startedAt: now,
    reconciliationStatus: "reconciled",
    effectivenessStatus: "pending",
    version: 1,
    createdAt: now,
    updatedAt: now,
  })

  // ── Facturación y cobranza ───────────────────────────────────────────────
  /*
   * El módulo se capturaba en blanco porque este seed nunca lo pobló. Lo que
   * sigue cubre los estados que sus nueve pantallas existen para mostrar: una
   * factura parcialmente pagada con gestión de cobranza, una pagada, una
   * vencida, una nota de crédito, una sin vínculo (la cola del resumen), una de
   * compra, un par candidato a duplicado, propuestas en revisión y aprobada, y
   * corridas de sincronización con y sin error.
   *
   * `paidAmount`/`paymentStatus` son caché derivada de los pagos confirmados
   * (`recomputeInvoicePaymentStatus`): acá se escriben a mano, así que tienen
   * que cuadrar con los pagos insertados más abajo o la captura mostraría un
   * estado que el servicio nunca produce.
   */
  const chomeTaxId = "76.099.887-1"
  const chomeName = "Chome SpA"
  await db.insert(schema.clients).values([
    {
      id: "cl-audit-1",
      rut: "76.541.220-4",
      name: "Forestal Arauco S.A.",
      tradeName: "Arauco",
      businessActivity: "Explotación forestal",
      email: "pagos@arauco.example",
      phone: "+56 41 240 0000",
      address: "Av. El Golf 150",
      commune: "Las Condes",
      city: "Santiago",
      paymentTermsDays: 30,
      defaultCurrency: "CLP",
      ownerUserId: userId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "cl-audit-2",
      rut: "77.310.905-6",
      name: "Constructora Andes SpA",
      businessActivity: "Obras civiles",
      email: "finanzas@andes.example",
      paymentTermsDays: 45,
      defaultCurrency: "CLP",
      ownerUserId: "user-audit-jefa",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.clientContacts).values([
    { id: "cl-contact-audit-1", clientId: "cl-audit-1", name: "Verónica Paredes", role: "Jefa de pagos", email: "vparedes@arauco.example", phone: "+56 9 7412 8890", isBilling: true, isActive: true, createdAt: now, updatedAt: now },
    { id: "cl-contact-audit-2", clientId: "cl-audit-2", name: "Rodrigo Cifuentes", role: "Administrador de contrato", email: "rcifuentes@andes.example", isBilling: true, isActive: true, createdAt: now, updatedAt: now },
  ])
  await db.insert(schema.contracts).values([
    {
      id: "ctr-audit-1",
      code: "CTR-2026-0001",
      clientId: "cl-audit-1",
      name: "Servicios de prevención y bodega — Faena Mininco",
      worksiteId,
      clientPoNumber: "OC-ARAUCO-88120",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      currency: "CLP",
      paymentTermsDays: 30,
      billingCycle: "monthly",
      periodAmount: 1000000,
      ownerUserId: userId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "ctr-audit-2",
      code: "CTR-2026-0002",
      clientId: "cl-audit-2",
      name: "Habilitación de instalaciones — por hitos",
      worksiteId: "ws-audit-2",
      startDate: "2026-03-01",
      currency: "CLP",
      paymentTermsDays: 45,
      billingCycle: "milestone",
      ownerUserId: "user-audit-jefa",
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.billingInvoices).values([
    {
      id: "inv-audit-1",
      direction: "sale",
      docType: "33",
      folio: 1041,
      issuerTaxId: chomeTaxId,
      issuerName: chomeName,
      receiverTaxId: "76.541.220-4",
      receiverName: "Forestal Arauco S.A.",
      issueDate: "2026-06-05",
      dueDate: "2026-07-05",
      dueDateSource: "contract",
      currency: "CLP",
      netAmount: 1000000,
      taxAmount: 190000,
      totalAmount: 1190000,
      documentStatus: "accepted",
      paymentStatus: "partial",
      collectionStatus: "committed",
      paidAmount: 500000,
      source: "factura_en_linea",
      sourceLastSyncedAt: now,
      ownerUserId: userId,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "inv-audit-2",
      direction: "sale",
      docType: "33",
      folio: 1040,
      issuerTaxId: chomeTaxId,
      issuerName: chomeName,
      receiverTaxId: "76.541.220-4",
      receiverName: "Forestal Arauco S.A.",
      issueDate: "2026-05-05",
      dueDate: "2026-06-04",
      dueDateSource: "contract",
      currency: "CLP",
      netAmount: 1000000,
      taxAmount: 190000,
      totalAmount: 1190000,
      documentStatus: "accepted",
      paymentStatus: "paid",
      collectionStatus: "closed",
      paidAmount: 1190000,
      source: "factura_en_linea",
      sourceLastSyncedAt: now,
      ownerUserId: userId,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "inv-audit-3",
      direction: "sale",
      docType: "33",
      folio: 1038,
      issuerTaxId: chomeTaxId,
      issuerName: chomeName,
      receiverTaxId: "77.310.905-6",
      receiverName: "Constructora Andes SpA",
      issueDate: "2026-04-02",
      dueDate: "2026-05-17",
      dueDateSource: "client",
      currency: "CLP",
      netAmount: 720000,
      taxAmount: 136800,
      totalAmount: 856800,
      documentStatus: "accepted",
      paymentStatus: "unpaid",
      collectionStatus: "in_progress",
      paidAmount: 0,
      source: "factura_en_linea",
      sourceLastSyncedAt: now,
      ownerUserId: "user-audit-jefa",
      notes: "Cliente pidió reemitir con la orden de compra en el detalle.",
      createdAt: now,
      updatedAt: now,
    },
    {
      // Nota de crédito: total negativo. Es el caso que rompe cualquier
      // agregación que asuma montos positivos.
      id: "inv-audit-4",
      direction: "sale",
      docType: "61",
      folio: 214,
      issuerTaxId: chomeTaxId,
      issuerName: chomeName,
      receiverTaxId: "77.310.905-6",
      receiverName: "Constructora Andes SpA",
      issueDate: "2026-05-20",
      currency: "CLP",
      netAmount: -120000,
      taxAmount: -22800,
      totalAmount: -142800,
      documentStatus: "accepted",
      paymentStatus: "unpaid",
      collectionStatus: "none",
      paidAmount: 0,
      source: "factura_en_linea",
      sourceLastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      // Sin vínculo a cliente/contrato: alimenta la cola "por atribuir" del
      // resumen, que era la mitad de esa pantalla sin evidencia.
      id: "inv-audit-5",
      direction: "sale",
      docType: "33",
      folio: 1042,
      issuerTaxId: chomeTaxId,
      issuerName: chomeName,
      receiverTaxId: "76.541.220-4",
      receiverName: "Forestal Arauco S A",
      issueDate: "2026-06-11",
      dueDate: "2026-07-11",
      dueDateSource: "provider",
      currency: "CLP",
      netAmount: 350000,
      taxAmount: 66500,
      totalAmount: 416500,
      documentStatus: "issued",
      paymentStatus: "unpaid",
      collectionStatus: "none",
      paidAmount: 0,
      source: "factura_en_linea",
      sourceLastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "inv-audit-6",
      direction: "purchase",
      docType: "33",
      folio: 88231,
      issuerTaxId: "76.123.456-7",
      issuerName: "TRECK Seguridad Industrial",
      receiverTaxId: chomeTaxId,
      receiverName: chomeName,
      issueDate: "2026-06-18",
      dueDate: "2026-07-18",
      dueDateSource: "provider",
      currency: "CLP",
      netAmount: 142800,
      taxAmount: 27132,
      totalAmount: 169932,
      documentStatus: "accepted",
      paymentStatus: "unpaid",
      collectionStatus: "none",
      paidAmount: 0,
      source: "factura_en_linea",
      sourceLastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      // Par candidato a duplicado: mismo folio y monto, RUT receptor con el
      // dígito verificador distinto. La identidad tributaria no colisiona, así
      // que la deduplicación exacta no lo resuelve y queda para ojo humano.
      id: "inv-audit-dup",
      direction: "sale",
      docType: "33",
      folio: 1041,
      issuerTaxId: chomeTaxId,
      issuerName: chomeName,
      receiverTaxId: "76.541.220-K",
      receiverName: "Forestal Arauco SA",
      issueDate: "2026-06-05",
      dueDate: "2026-07-05",
      dueDateSource: "provider",
      currency: "CLP",
      netAmount: 1000000,
      taxAmount: 190000,
      totalAmount: 1190000,
      documentStatus: "unknown",
      paymentStatus: "unpaid",
      collectionStatus: "none",
      paidAmount: 0,
      source: "chipax",
      sourceLastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.billingInvoiceItems).values([
    { id: "inv-item-audit-1", invoiceId: "inv-audit-1", description: "Servicio de prevención de riesgos — junio 2026", quantity: 1, unit: "mes", unitPrice: 1000000, netAmount: 1000000, taxAmount: 190000, totalAmount: 1190000, sortOrder: 0 },
    { id: "inv-item-audit-2", invoiceId: "inv-audit-3", description: "Habilitación de instalaciones — hito 1", quantity: 1, unit: "hito", unitPrice: 720000, netAmount: 720000, taxAmount: 136800, totalAmount: 856800, sortOrder: 0 },
  ])
  await db.insert(schema.billingExternalRefs).values([
    { id: "inv-ref-audit-1", invoiceId: "inv-audit-1", provider: "factura_en_linea", externalId: "FEL-1041", externalFolio: "1041", externalStatus: "aceptado", accountRef: "433", payloadHash: "capture-fel-1041", snapshot: { folio: 1041, total: 1190000 }, firstSeenAt: now, lastSeenAt: now },
    { id: "inv-ref-audit-2", invoiceId: "inv-audit-dup", provider: "chipax", externalId: "CHX-556120", externalFolio: "1041", accountRef: "chome", payloadHash: "capture-chx-556120", snapshot: { folio: 1041, total: 1190000 }, firstSeenAt: now, lastSeenAt: now },
  ])
  await db.insert(schema.billingInvoiceLinks).values([
    { id: "inv-link-audit-1", invoiceId: "inv-audit-1", clientId: "cl-audit-1", contractId: "ctr-audit-1", worksiteId, servicePeriod: "2026-06", clientPoNumber: "OC-ARAUCO-88120", status: "confirmed", matchedBy: "user", confirmedBy: userId, confirmedAt: now, createdBy: userId, createdAt: now, updatedAt: now },
    { id: "inv-link-audit-2", invoiceId: "inv-audit-2", clientId: "cl-audit-1", contractId: "ctr-audit-1", worksiteId, servicePeriod: "2026-05", status: "confirmed", matchedBy: "auto", confidence: "high", confirmedBy: userId, confirmedAt: now, createdBy: userId, createdAt: now, updatedAt: now },
    { id: "inv-link-audit-3", invoiceId: "inv-audit-3", clientId: "cl-audit-2", contractId: "ctr-audit-2", worksiteId: "ws-audit-2", servicePeriod: "2026-04", status: "confirmed", matchedBy: "user", confirmedBy: "user-audit-jefa", confirmedAt: now, createdBy: "user-audit-jefa", createdAt: now, updatedAt: now },
    // Sugerencia sin confirmar: el vínculo propuesto por el match automático.
    { id: "inv-link-audit-4", invoiceId: "inv-audit-4", clientId: "cl-audit-2", status: "suggested", matchedBy: "auto", confidence: "medium", evidence: { rut: "coincide", monto: "no aplica" }, createdBy: userId, createdAt: now, updatedAt: now },
  ])
  await db.insert(schema.billingInvoicePayments).values([
    { id: "pay-audit-1", invoiceId: "inv-audit-1", paymentDate: "2026-06-28", amount: 500000, currency: "CLP", method: "transferencia", source: "manual", verificationStatus: "confirmed", matchedBy: "user", confirmedBy: userId, confirmedAt: now, createdBy: userId, createdAt: now, updatedAt: now },
    { id: "pay-audit-2", invoiceId: "inv-audit-2", paymentDate: "2026-06-02", amount: 1190000, currency: "CLP", method: "transferencia", source: "manual", verificationStatus: "confirmed", matchedBy: "user", confirmedBy: userId, confirmedAt: now, createdBy: userId, createdAt: now, updatedAt: now },
    // Pago sugerido y sin confirmar: no suma a `paidAmount` a propósito.
    { id: "pay-audit-3", invoiceId: "inv-audit-3", paymentDate: "2026-06-30", amount: 300000, currency: "CLP", method: "transferencia", source: "manual", verificationStatus: "suggested", confidence: "medium", matchedBy: "auto", evidence: { glosa: "folio 1038 en el detalle" }, createdBy: userId, createdAt: now, updatedAt: now },
  ])
  await db.insert(schema.billingCollectionActions).values([
    { id: "coll-audit-1", invoiceId: "inv-audit-1", contactName: "Verónica Paredes", actionDate: "2026-06-20", actionType: "commitment", channel: "phone", outcome: "promised_payment", commitmentDate: "2026-07-05", commitmentAmount: 690000, nextActionDate: "2026-07-06", notes: "Compromete el saldo con la liberación del estado de pago.", assigneeUserId: userId, createdBy: userId, createdAt: now },
    { id: "coll-audit-2", invoiceId: "inv-audit-3", contactName: "Rodrigo Cifuentes", actionDate: "2026-06-16", actionType: "call", channel: "phone", outcome: "no_answer", nextActionDate: "2026-06-23", assigneeUserId: "user-audit-jefa", createdBy: "user-audit-jefa", createdAt: now },
  ])
  await db.insert(schema.billingProposals).values([
    {
      id: "prop-audit-1",
      code: "PF-2026-0011",
      clientId: "cl-audit-1",
      contractId: "ctr-audit-1",
      worksiteId,
      servicePeriod: "2026-07",
      currency: "CLP",
      estimatedNet: 1000000,
      estimatedTax: 190000,
      estimatedTotal: 1190000,
      clientPoNumber: "OC-ARAUCO-88120",
      status: "in_review",
      ownerUserId: userId,
      submittedBy: userId,
      submittedAt: now,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prop-audit-2",
      code: "PF-2026-0010",
      clientId: "cl-audit-2",
      contractId: "ctr-audit-2",
      worksiteId: "ws-audit-2",
      servicePeriod: "2026-06",
      currency: "CLP",
      estimatedNet: 480000,
      estimatedTax: 91200,
      estimatedTotal: 571200,
      missingDocuments: "Falta el acta de recepción del hito firmada por el mandante.",
      status: "approved",
      ownerUserId: "user-audit-jefa",
      submittedBy: "user-audit-jefa",
      submittedAt: now,
      reviewedBy: userId,
      reviewedAt: now,
      approvedBy: userId,
      approvedAt: now,
      createdBy: "user-audit-jefa",
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(schema.billingProposalItems).values([
    { id: "prop-item-audit-1", proposalId: "prop-audit-1", description: "Servicio de prevención de riesgos — julio 2026", quantity: 1, unit: "mes", unitPrice: 1000000, netAmount: 1000000, sortOrder: 0 },
    { id: "prop-item-audit-2", proposalId: "prop-audit-2", description: "Habilitación de instalaciones — hito 2", quantity: 1, unit: "hito", unitPrice: 480000, netAmount: 480000, sortOrder: 0 },
  ])
  await db.insert(schema.billingDuplicateCandidates).values({
    id: "dup-audit-1",
    invoiceId: "inv-audit-1",
    otherInvoiceId: "inv-audit-dup",
    classification: "probable",
    evidence: { folio: "coincide", total: "coincide", receptor: "difiere el dígito verificador", fuente: "factura_en_linea vs chipax" },
    status: "open",
    createdAt: now,
  })
  await db.insert(schema.billingInvoiceEvents).values([
    { id: "inv-event-audit-1", invoiceId: "inv-audit-1", eventType: "invoice_imported", actorKind: "provider", detail: { proveedor: "factura_en_linea", folio: 1041 }, occurredAt: now },
    { id: "inv-event-audit-2", invoiceId: "inv-audit-1", eventType: "link_confirmed", actorKind: "user", actorUserId: userId, detail: { cliente: "Forestal Arauco S.A.", periodo: "2026-06" }, occurredAt: now },
    { id: "inv-event-audit-3", invoiceId: "inv-audit-1", eventType: "payment_confirmed", actorKind: "user", actorUserId: userId, detail: { monto: 500000, estado: "partial" }, occurredAt: now },
  ])
  await db.insert(schema.billingSyncRuns).values([
    { id: "sync-audit-1", provider: "factura_en_linea", scope: "sales_invoices", trigger: "cron", status: "success", dryRun: false, periodFrom: "2026-06", periodTo: "2026-06", recordsFetched: 6, recordsCreated: 5, recordsUpdated: 1, recordsUnchanged: 0, duplicatesDetected: 1, conflictsDetected: 0, errorsCount: 0, correlationId: "capture-sync-0001", triggeredBy: userId, startedAt: now, finishedAt: now },
    { id: "sync-audit-2", provider: "chipax", scope: "bank_transactions", trigger: "manual", status: "failed", dryRun: false, periodFrom: "2026-06", periodTo: "2026-06", recordsFetched: 0, errorsCount: 1, errorSummary: "El proveedor respondió 401: credenciales rechazadas.", correlationId: "capture-sync-0002", triggeredBy: userId, startedAt: now, finishedAt: now },
  ])

  // ── Portal DTE (Bandeja de Entrada y corridas de sincronización) ─────────
  /*
   * `codEmp` tiene que coincidir con la configuración efectiva del portal o la
   * bandeja filtra por una empresa distinta y sale vacía: `buildCaptureEnv`
   * fija `DTE_PORTAL_CODEMP` con este mismo valor.
   */
  const captureCodEmp = "433"
  await db.insert(schema.dteSyncRuns).values([
    { id: "dte-run-audit-1", periodo: "2026-06", codEmp: captureCodEmp, trigger: "cron", status: "success", rowsSeen: 3, rowsInserted: 3, rowsUpdated: 0, importerId: userId, correlationId: "capture-dte-0001", reconciliationStatus: "success", startedAt: now, finishedAt: now },
    { id: "dte-run-audit-2", periodo: "2026-05", codEmp: captureCodEmp, trigger: "manual", status: "partial", rowsSeen: 4, rowsInserted: 2, rowsUpdated: 1, importerId: userId, correlationId: "capture-dte-0002", error: "Una fila del panel no traía folio legible.", reconciliationStatus: "partial", reconciliationError: "Un documento quedó sin factura de OC candidata.", startedAt: now, finishedAt: now },
  ])
  await db.insert(schema.dteDocuments).values([
    {
      // Conciliado contra la factura de la OC. El monto calza al peso: una
      // diferencia acá se rendereaba como discrepancia y no lo es.
      id: "dte-doc-audit-1",
      tipoDte: "33",
      folio: 12715,
      rutEmisor: "76.123.456-7",
      razonSocialEmisor: "TRECK Seguridad Industrial",
      fechaEmision: "2026-06-18",
      montoNeto: 142800,
      iva: 27132,
      montoTotal: 169932,
      estadoSii: "aceptado",
      estadoIntercambio: "aceptado",
      estadoPlataforma: "Recibido",
      codEmp: captureCodEmp,
      periodo: "2026-06",
      portalRecordId: "918234",
      rawHash: "capture-dte-33-12715",
      purchaseOrderInvoiceId: "invoice-audit-1",
      syncRunId: "dte-run-audit-1",
      syncedAt: now,
      createdAt: now,
    },
    {
      id: "dte-doc-audit-2",
      tipoDte: "33",
      folio: 12980,
      rutEmisor: "77.845.120-2",
      razonSocialEmisor: "Ferretería Industrial Biobío Ltda",
      fechaEmision: "2026-06-22",
      montoNeto: 84000,
      iva: 15960,
      montoTotal: 99960,
      estadoSii: "aceptado",
      estadoIntercambio: "pendiente",
      estadoPlataforma: "Recibido",
      codEmp: captureCodEmp,
      periodo: "2026-06",
      portalRecordId: "918470",
      rawHash: "capture-dte-33-12980",
      syncRunId: "dte-run-audit-1",
      syncedAt: now,
      createdAt: now,
    },
    {
      // Nota de crédito: monto negativo y sin vínculo interno.
      id: "dte-doc-audit-3",
      tipoDte: "61",
      folio: 4412,
      rutEmisor: "76.123.456-7",
      razonSocialEmisor: "TRECK Seguridad Industrial",
      fechaEmision: "2026-06-25",
      montoNeto: -18000,
      iva: -3420,
      montoTotal: -21420,
      estadoSii: "aceptado",
      estadoIntercambio: "aceptado",
      estadoPlataforma: "Recibido",
      codEmp: captureCodEmp,
      periodo: "2026-06",
      portalRecordId: "918602",
      rawHash: "capture-dte-61-4412",
      syncRunId: "dte-run-audit-1",
      syncedAt: now,
      createdAt: now,
    },
  ])

  await db.insert(schema.systemSettings).values([
    { key: "company_name", value: "Chome Operaciones", updatedAt: now },
    { key: "company_rut", value: "76.000.000-0", updatedAt: now },
    { key: "company_address", value: "Av. Industrial 1400, Los Ángeles", updatedAt: now },
    { key: "company_business_activity", value: "Servicios forestales y operaciones industriales", updatedAt: now },
    { key: "pdf_max_size_mb", value: "10", updatedAt: now },
    { key: "purchase_order_footer", value: "Documento generado para auditoría visual.", updatedAt: now },
  ])

  // Sync sequences past all hardcoded document codes inserted above.
  // Each call to next_document_code creates the sequence (if needed) and
  // consumes one value; setval then pins it at the max code we've inserted,
  // so the next real app call gets max+1 with no collisions.
  await db.execute(sql`
    DO $$
    DECLARE
      yr int := EXTRACT(YEAR FROM NOW())::int;
    BEGIN
      -- SOL uses year=0 per code-sequences.ts
      PERFORM next_document_code('SOL', 0);
      PERFORM setval('code_seq_sol_0', GREATEST(
        3,
        (SELECT COALESCE(MAX(CAST(split_part(code,'-',3) AS int)),0) FROM purchase_requests WHERE code ~ '^SOL-')
      ));

      PERFORM next_document_code('OC', yr);
      PERFORM setval('code_seq_oc_' || yr, GREATEST(
        2,
        (SELECT COALESCE(MAX(CAST(split_part(code,'-',3) AS int)),0) FROM purchase_orders WHERE code ~ ('^OC-' || yr || '-'))
      ));

      PERFORM next_document_code('REP', yr);
      PERFORM setval('code_seq_rep_' || yr, GREATEST(
        1,
        (SELECT COALESCE(MAX(CAST(split_part(code,'-',3) AS int)),0) FROM purchase_requests WHERE code ~ ('^REP-' || yr || '-'))
      ));

      PERFORM next_document_code('REC', yr);
      PERFORM setval('code_seq_rec_' || yr, GREATEST(
        2,
        (SELECT COALESCE(MAX(CAST(split_part(code,'-',3) AS int)),0) FROM receipts WHERE code ~ ('^REC-' || yr || '-'))
      ));

      PERFORM next_document_code('ENT', yr);
      PERFORM setval('code_seq_ent_' || yr, GREATEST(
        1,
        (SELECT COALESCE(MAX(CAST(split_part(code,'-',3) AS int)),0) FROM deliveries WHERE code ~ ('^ENT-' || yr || '-'))
      ));

      -- GDI usa serie continua (year=0), igual que SOL, y su correlativo va en
      -- el segundo segmento: "GDI-000002".
      PERFORM next_document_code('GDI', 0);
      PERFORM setval('code_seq_gdi_0', GREATEST(
        2,
        (SELECT COALESCE(MAX(CAST(split_part(code,'-',2) AS int)),0) FROM dispatch_guides WHERE code ~ '^GDI-')
      ));
    END;
    $$
  `)

  await pgClient.end()
}


const CAPTURE_BUILD_TIMEOUT_MS = 10 * 60_000

/** Directorios que participan del bundle de producción y deben invalidar el build. */
const CAPTURE_BUILD_SOURCES = [
  "app",
  "lib",
  "components",
  "modules",
  "db/schema",
  "db/migrations",
  "db/index.ts",
  "next.config.ts",
  "proxy.ts",
  "instrumentation.ts",
]

function newestSourceMtime(): number {
  let newest = 0
  for (const entry of CAPTURE_BUILD_SOURCES) {
    const fullPath = path.join(root, entry)
    if (!fs.existsSync(fullPath)) continue
    const stat = fs.statSync(fullPath)
    if (stat.isDirectory()) {
      const stack = [fullPath]
      while (stack.length > 0) {
        const dir = stack.pop()!
        for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
          const childPath = path.join(dir, child.name)
          if (child.isDirectory()) stack.push(childPath)
          else if (child.isFile()) newest = Math.max(newest, fs.statSync(childPath).mtimeMs)
        }
      }
    } else if (stat.isFile()) {
      newest = Math.max(newest, stat.mtimeMs)
    }
  }
  return newest
}

function hasProductionBuildArtifacts(): boolean {
  return (
    fs.existsSync(path.join(root, ".next", "BUILD_ID")) &&
    fs.existsSync(path.join(root, ".next", "standalone", "server.js"))
  )
}

/**
 * Un build es stale si el código fuente es más nuevo que el BUILD_ID: capturar
 * desde un build viejo reportaría como evidencia UI de una versión anterior
 * (mismo problema que obliga a `e2e/start-server.sh` a `rm -rf .next`).
 */
function isProductionBuildStale(): boolean {
  const buildIdPath = path.join(root, ".next", "BUILD_ID")
  if (!fs.existsSync(buildIdPath)) return true
  return fs.statSync(buildIdPath).mtimeMs < newestSourceMtime()
}

/**
 * C1: los viewports paralelos deben servirse desde un build de producción.
 * Dos `next dev` compartiendo el mismo `.next` se pisan entre sí (chunks
 * servidos como `text/plain` → ChunkLoadError → HTTP 500 en rutas
 * autenticadas). Si no hay build (o está desactualizado), se compila con el
 * entorno de captura y los servidores quedan como procesos read-only sobre
 * `.next`, igual que hace `e2e/start-server.sh` para Playwright.
 *
 * `CAPTURE_SKIP_BUILD=true` salta el build (útil para depurar el propio
 * script); sin build, dos `next dev` paralelos vuelven a romper las capturas.
 * `CAPTURE_FORCE_BUILD=true` borra `.next` antes de compilar (build limpia,
 * misma razón que `e2e/start-server.sh`).
 */
async function ensureProductionBuild(captureDbUrl: string) {
  const buildUpToDate = hasProductionBuildArtifacts() && !isProductionBuildStale()
  if (buildUpToDate) return
  if (process.env.CAPTURE_SKIP_BUILD === "true") {
    console.warn("⚠ CAPTURE_SKIP_BUILD=true: sin build de producción, dos `next dev` paralelos comparten `.next` y las rutas autenticadas pueden devolver 500.")
    return
  }

  if (process.env.CAPTURE_FORCE_BUILD === "true") {
    // Evita reusar el cache de Turbopack de un build anterior (la causa de
    // "Failed to find Server Action" documentada en e2e/start-server.sh).
    fs.rmSync(path.join(root, ".next"), { recursive: true, force: true })
  }

  const nextBin = path.join(root, "node_modules", ".bin", "next")
  const buildEnv = {
    ...buildCaptureEnv(captureDbUrl),
    // next build corre su propia verificación de TypeScript en un worker
    // aparte del proceso principal; el límite de heap por defecto de V8 se
    // agota ahí también (mismo ajuste que usa CI para el paso Build).
    ...(process.env.NODE_OPTIONS ? {} : { NODE_OPTIONS: "--max-old-space-size=4096" }),
  }

  await runWithSpinner("Compilando build de producción (next build)", async () => {
    await new Promise<void>((resolve, reject) => {
      const build = spawn(nextBin, ["build"], {
        cwd: root,
        env: buildEnv as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
      })
      const timeout = setTimeout(() => {
        build.kill("SIGKILL")
        reject(new Error(`next build excedió ${CAPTURE_BUILD_TIMEOUT_MS / 60_000} minutos y fue terminado`))
      }, CAPTURE_BUILD_TIMEOUT_MS)
      build.stdout.on("data", (chunk) => process.stdout.write(`[build] ${chunk}`))
      build.stderr.on("data", (chunk) => process.stderr.write(`[build] ${chunk}`))
      build.on("error", (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      build.on("close", (code) => {
        clearTimeout(timeout)
        if (code === 0) resolve()
        else reject(new Error(`next build falló con exit code ${code}`))
      })
    })
  })

  if (!hasProductionBuildArtifacts()) {
    throw new Error("next build terminó pero no se encontró .next/BUILD_ID ni .next/standalone/server.js")
  }
}

async function ensureDatabaseExists(databaseUrl: string) {
  const databaseName = getDatabaseNameFromUrl(databaseUrl)
  const maintenanceClient = postgres(getMaintenanceDatabaseUrl(databaseUrl), { max: 1 })
  try {
    const rows = await maintenanceClient<{ exists: number }[]>`
      SELECT 1 AS exists FROM pg_database WHERE datname = ${databaseName} LIMIT 1
    `
    if (rows.length === 0) {
      await maintenanceClient.unsafe(`CREATE DATABASE ${quotePostgresIdentifier(databaseName)}`)
    }
  } finally {
    await maintenanceClient.end()
  }
}

export type ServerLaunch = {
  command: string
  args: string[]
}

export type ServerLaunchInput = {
  useStandalone: boolean
  hasProductionBuild: boolean
  standaloneServer: string
  nextBin: string
  nodeExecPath: string
  /** Puerto propio de este servidor (3127, 3128...), nunca la base. */
  serverPort: number
}

/**
 * Una corrida de un viewport puede usar `next dev` de forma segura. Reservar
 * el artefacto standalone para los viewports simultáneos evita que un
 * standalone viejo sobreviva a una corrida dev y se mezcle con sus manifests
 * de cliente (Next responde 500 en rutas que aún no existen en ese build).
 */
export function shouldUseProductionCaptureServer(
  needsParallel: boolean,
  forceProduction: boolean = process.env.CAPTURE_USE_PRODUCTION_SERVER === "true",
): boolean {
  return needsParallel || forceProduction
}

/**
 * Decide cómo lanzar el servidor Next.js de la captura. Aislada y exportada
 * para poder testearla: el bug histórico (dos `next dev` compitiendo por el
 * mismo `.next`, chunks servidos como `text/plain` → 500 en rutas autenticadas)
 * vivía en esta ramificación, y la rama `next start` usaba el puerto base en
 * vez del puerto propio del servidor (C1/C2).
 */
export function resolveServerLaunch({
  useStandalone,
  hasProductionBuild,
  standaloneServer,
  nextBin,
  nodeExecPath,
  serverPort,
}: ServerLaunchInput): ServerLaunch {
  if (useStandalone) {
    return { command: nodeExecPath, args: [standaloneServer] }
  }
  if (hasProductionBuild) {
    return { command: nextBin, args: ["start", "--hostname", "127.0.0.1", "--port", String(serverPort)] }
  }
  return { command: nextBin, args: ["dev", "--hostname", "127.0.0.1", "--port", String(serverPort)] }
}

/**
 * Entorno compartido entre el build on-demand y los servidores de captura:
 * apunta la BD al fixture de captura, fija los secretos de auth y deja el
 * correo desactivado. Un solo punto de definición evita que build y servidores
 * diverjan en variables (p. ej. agregar una var a uno y olvidar la otra).
 */
function buildCaptureEnv(captureDbUrl: string, serverBaseUrl?: string): NodeJS.Dict<string> {
  const captureUrl = new URL(captureDbUrl)
  const socketHost = captureUrl.hostname ? undefined : (process.env.PGHOST ?? "/var/run/postgresql")
  return {
    ...(process.env as Record<string, string>),
    DATABASE_URL: captureDbUrl,
    STORAGE_PATH: resolveCaptureStoragePath(),
    ...(socketHost ? {
      PGHOST: socketHost,
      PGUSER: process.env.PGUSER ?? process.env.USER ?? "postgres",
    } : {}),
    AUTH_SECRET: authSecret,
    NEXTAUTH_SECRET: authSecret,
    ...(serverBaseUrl ? {
      AUTH_URL: serverBaseUrl,
      APP_URL: serverBaseUrl,
      NEXTAUTH_URL: serverBaseUrl,
      PORT: serverBaseUrl.slice(serverBaseUrl.lastIndexOf(":") + 1),
    } : {}),
    SMTP_HOST: "",
    SMTP_USER: "",
    SMTP_PASS: "",
    SMTP_FROM: "",
    SMTP_DISABLED: "true",
    SMTP_TIMEOUT_MS: "1000",
    // Portal DTE: sólo el código de empresa, que es por lo que filtra la Bandeja
    // de Entrada (y que el seed replica en `dte_documents.cod_emp`). Las
    // credenciales van vacías y la sincronización apagada para que ninguna
    // captura pueda golpear el portal real, ni herede las credenciales del
    // `.env` de quien corre el script.
    DTE_PORTAL_CODEMP: "433",
    DTE_PORTAL_RUT_USR: "",
    DTE_PORTAL_RUT_EMP: "",
    DTE_PORTAL_CLAVE: "",
    DTE_SYNC_ENABLED: "false",
  }
}

async function startServer(
  captureDbUrl: string,
  serverPort: number = port,
  useProductionServer: boolean = false,
) {
  const serverBaseUrl = `http://127.0.0.1:${serverPort}`
  const env = buildCaptureEnv(captureDbUrl, serverBaseUrl)
  const standaloneServer = path.join(root, ".next", "standalone", "server.js")
  const hasProductionBuild = useProductionServer && fs.existsSync(path.join(root, ".next", "BUILD_ID"))
  const useStandalone = useProductionServer && fs.existsSync(standaloneServer)
  if (useStandalone) {
    const standaloneStatic = path.join(root, ".next", "standalone", ".next", "static")
    if (!fs.existsSync(standaloneStatic)) {
      fs.mkdirSync(path.dirname(standaloneStatic), { recursive: true })
      fs.cpSync(path.join(root, ".next", "static"), standaloneStatic, { recursive: true })
    }
    fs.cpSync(path.join(root, "public"), path.join(root, ".next", "standalone", "public"), { recursive: true, force: true })
  }
  const { command, args } = resolveServerLaunch({
    useStandalone,
    hasProductionBuild,
    standaloneServer,
    nextBin: path.join(root, "node_modules", ".bin", "next"),
    nodeExecPath: process.execPath,
    serverPort,
  })
  const server = spawn(command, args, {
    cwd: root,
    env: env as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  })

  server.stdout.on("data", (chunk) => process.stdout.write(`[next] ${chunk}`))
  server.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`))

  await waitForServer(server, serverBaseUrl)
  return { server, serverBaseUrl }
}

async function waitForServer(server: ChildProcess, serverBaseUrl: string = baseUrl) {
  const deadline = Date.now() + 120_000
  let lastError = ""
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Next server exited early with code ${server.exitCode}`)
    }
    try {
      const response = await fetch(`${serverBaseUrl}/login`, { redirect: "manual" })
      if (response.status < 500) return
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`Next server did not become ready: ${lastError}`)
}

async function stopServer(server: ChildProcess) {
  if (server.exitCode !== null) return
  server.kill("SIGTERM")
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (server.exitCode === null) server.kill("SIGKILL")
      resolve()
    }, 5000)
    server.once("exit", () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

async function login(context: BrowserContext, serverBaseUrl: string = baseUrl) {
  const page = await context.newPage()
  const loginUrl = `${serverBaseUrl}/login`

  // Retry the full login flow (goto → fill → submit → wait for redirect)
  // up to 3 times. The server may be slow after a cold start or DB migration,
  // and Playwright's waitForURL can timeout on a 200 that never redirects
  // (e.g. wrong form selector, API error, CSRF mismatch).
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 45_000 })
      await page.getByLabel("Correo electrónico", { exact: true }).fill("admin.audit@chome.cl")
      await page.getByLabel("Contraseña", { exact: true }).fill("chome2026")
      await page.getByRole("button", { name: "Ingresar", exact: true }).click()
      // Wait for the redirect to /dashboard. 60s covers slow server startups
      // after a cold boot or heavy DB migration. No networkidle race — if the
      // URL doesn't change, the timeout fires and we retry.
      await page.waitForURL(/\/dashboard/, { timeout: 60_000 })
      await page.close()
      return
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.warn(`  ⚠ login attempt ${attempt} failed: ${reason} (at ${page.url()})`)
      if (attempt === 3) {
        await page.close()
        throw err
      }
    }
  }

  // Should not reach here, but safety net.
  await page.close()
  throw new Error("Login failed after 3 attempts")
}

type InteractionReset = {
  status: number | null
  finalUrl: string
  state: CaptureState
  ok: boolean
}

/** Every interactive artifact starts from the declared route, never from a prior control. */
async function resetRouteForInteraction(page: Page, route: RouteTarget, requestedUrl: string): Promise<InteractionReset> {
  const response = await page.goto(requestedUrl, { waitUntil: "domcontentloaded", timeout: 45_000 })
  await settle(page)
  const status = response?.status() ?? null
  const finalUrl = page.url()
  const state = resolveCaptureState(route, status, finalUrl)
  return { status, finalUrl, state, ok: isExpectedStatus(status, route) && isSuccessfulCaptureState(state) }
}

function recordInvalidInteraction(
  results: CaptureResult[],
  {
    viewport,
    route,
    requestedUrl,
    finalUrl,
    status,
    type,
    selector,
    error,
  }: {
    viewport: string
    route: RouteTarget
    requestedUrl: string
    finalUrl: string
    status: number | null
    type: NonNullable<CaptureResult["type"]>
    selector: string
    error: string
  },
) {
  results.push({
    viewport,
    slug: `${route.slug}-${type}-invalid`,
    path: route.path,
    requestedUrl,
    finalUrl,
    status,
    ok: false,
    state: "capture-invalid",
    type,
    selector,
    screenshot: "",
    error,
  })
}

/**
 * ¿Este trigger es el mismo elemento que el trigger de un modal declarado en la
 * ruta? Un modal declarado y el auto-discovery pueden apuntar al mismo botón con
 * slugs distintos (auditoría §3.2, caso 4): comparar por identidad de elemento
 * evita capturar dos veces el mismo diálogo con el mismo hash.
 */
async function isDeclaredModalTrigger(page: Page, route: RouteTarget, trigger: Locator): Promise<boolean> {
  if (!route.modals?.length) return false
  const handle = await trigger.elementHandle().catch(() => null)
  if (!handle) return false
  for (const modal of route.modals) {
    const declared = page.locator(modal.triggerSelector).first()
    const isSame = await declared
      .evaluate((el, target) => el === target, handle)
      .catch(() => false)
    if (isSame) return true
  }
  return false
}

async function captureModalsForRoute(
  page: Page,
  viewport: string,
  route: RouteTarget,
  requestedUrl: string,
  status: number | null,
  results: CaptureResult[]
) {
  if (route.modals && route.modals.length > 0) {
    for (const modal of route.modals) {
      try {
        const reset = await resetRouteForInteraction(page, route, requestedUrl)
        if (!reset.ok) {
          recordInvalidInteraction(results, {
            viewport, route, requestedUrl, finalUrl: reset.finalUrl, status: reset.status,
            type: "modal", selector: modal.triggerSelector,
            error: `La ruta base no coincide con su allowlist: ${getAllowedCapturePaths(route).join(", ")}`,
          })
          return
        }
        const trigger = page.locator(modal.triggerSelector).first()
        if (await trigger.isVisible({ timeout: 2000 }).catch(() => false)) {
          await trigger.click({ force: true })
          const modalSelector = modal.waitForSelector ?? '[role="dialog"], [role="alertdialog"], [data-state="open"], [data-radix-portal]'
          await page.waitForSelector(modalSelector, { state: "visible", timeout: 4000 }).catch(() => undefined)
          await page.waitForTimeout(100)

          const state = resolveCaptureState(route, reset.status, page.url(), "interaction")
          if (!isSuccessfulCaptureState(state)) {
            recordInvalidInteraction(results, {
              viewport, route, requestedUrl, finalUrl: page.url(), status: reset.status,
              type: "modal", selector: modal.triggerSelector,
              error: `La interacción abandonó la ruta declarada. Pathnames permitidos: ${getAllowedCapturePaths(route).join(", ")}`,
            })
            return
          }

          const modalScreenshot = path.join(outputDir, `${viewport}-${route.slug}-modal-${modal.slug}.png`)
          await page.screenshot({ path: modalScreenshot, fullPage: true })

          results.push({
            viewport,
            slug: `${route.slug}-modal-${modal.slug}`,
            path: route.path,
            requestedUrl,
            finalUrl: page.url(),
            status: reset.status,
            ok: true,
            state,
            type: "modal",
            screenshot: path.relative(root, modalScreenshot),
            screenshotHash: screenshotHash(modalScreenshot),
            selector: modal.triggerSelector,
            notes: modal.notes ?? `Modal/Sheet: ${modal.slug}`,
          })

          await page.keyboard.press("Escape").catch(() => undefined)
          await page.waitForTimeout(100)
        }
      } catch (modalErr) {
        const reason = modalErr instanceof Error ? modalErr.message : String(modalErr)
        console.warn(`  ⚠ modal "${modal.slug}" en ${viewport} ${route.slug}: ${reason}`)
        recordInvalidInteraction(results, {
          viewport, route, requestedUrl, finalUrl: page.url(), status,
          type: "modal", selector: modal.triggerSelector, error: reason,
        })
        return
      }
    }
  }

  try {
    // Patrones de botones que abre un Dialog / Sheet. La lista crece con
    // cada módulo nuevo: si un botón no está aquí, su modal no se captura
    // en la auditoría visual automática. Se usa has-text (parcial) porque
    // muchos botones llevan un ícono antes del texto.
    const triggers = page.locator([
      // ── Creación / alta ──
      'button:has-text("Nuevo")', 'button:has-text("Crear")',
      'button:has-text("Agregar")', 'button:has-text("Iniciar")',
      // ── Importación / carga ──
      'button:has-text("Importar")',
      // ── Filtrado / búsqueda ──
      'button:has-text("Filtrar")',
      // ── Acciones sobre registros existentes ──
      'button:has-text("Corregir")',   // TAE: corrección de lectura
      'button:has-text("Declarar")',   // Inspecciones: declarar ejecutada
      'button:has-text("Incorporar")', // Inspecciones catálogo: incorporar plantilla
      'button:has-text("Vincular")',   // PDTP cobertura: vincular fuente
      'button:has-text("Convocar")',   // CPHS: convocar sesión
      'button:has-text("Derivar")',    // Inspecciones: derivar a CAPA
      'button:has-text("Subir")',      // Documentación: subir nueva versión
      // ── Fallback genérico: cualquier botón que declara abrir un dialog ──
      '[data-state="closed"][aria-haspopup="dialog"]',
    ].join(", "))
    const count = await triggers.count().catch(() => 0)
    const maxDynamic = Math.min(count, 5)
    const usedModalSlugs = new Set<string>()

    for (let i = 0; i < maxDynamic; i++) {
      const reset = await resetRouteForInteraction(page, route, requestedUrl)
      if (!reset.ok) {
        recordInvalidInteraction(results, {
          viewport, route, requestedUrl, finalUrl: reset.finalUrl, status: reset.status,
          type: "modal", selector: `dynamic-modal-${i}`,
          error: `La ruta base no coincide con su allowlist: ${getAllowedCapturePaths(route).join(", ")}`,
        })
        return
      }
      const trigger = triggers.nth(i)
      if (!(await trigger.isVisible({ timeout: 1000 }).catch(() => false))) continue
      const text = (await trigger.textContent().catch(() => ""))?.trim() || `trigger-${i}`
      const baseSlug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)

      // Dedup por identidad de elemento, no por slug: un modal declarado puede
      // usar un slug distinto al que deriva del texto del botón (p. ej. modal
      // "nuevo-estado" cuyo trigger `button:has-text("Nuevo")` abre el botón
      // "Nuevo resumen") y entonces el dedup por slug no basta — ambos barridos
      // capturaban el mismo diálogo con el mismo hash (auditoría §3.2, caso 4).
      if (await isDeclaredModalTrigger(page, route, trigger)) continue
      if (route.modals?.some((m) => m.slug === baseSlug)) continue
      const cleanSlug = uniqueInteractionSlug(usedModalSlugs, baseSlug)

      /*
       * El selector anterior incluía `[data-state="open"]` y
       * `[data-radix-portal]`, que coinciden con cosas que **ya estaban
       * abiertas** en la página —un acordeón, cualquier contenedor de portal—.
       * `waitForSelector` resolvía al instante sin que se hubiera abierto nada,
       * y la captura resultante era la página tal cual: dos PNG con el mismo
       * hash y una evidencia de modal que no mostraba ningún modal.
       *
       * Ahora la condición es un aumento real en el número de diálogos
       * visibles. No depende de lo amplio que sea el selector: si tras el clic
       * no hay un diálogo más que antes, no se abrió nada y no hay evidencia
       * que guardar.
       */
      const dialogosAntes = await page
        .locator('[role="dialog"]:visible, [role="alertdialog"]:visible')
        .count()
      await trigger.click({ force: true }).catch(() => undefined)
      const opened = await page
        .waitForFunction(
          (previos) => {
            // Radix deja el diálogo en el DOM con `data-state="closed"`: contar
            // nodos no basta, hay que contar los que realmente se ven.
            const visibles = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
              .filter((el) => (el as HTMLElement).offsetParent !== null || getComputedStyle(el).position === "fixed")
              .filter((el) => getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none")
            return visibles.length > previos
          },
          dialogosAntes,
          { timeout: 2500 },
        )
        .then(() => true)
        .catch(() => false)

      if (opened) {
        /*
         * 100 ms no siempre alcanzan: el diálogo ya está en el árbol y visible,
         * pero su animación de entrada aún no terminó, así que la captura sale
         * con el overlay a opacidad cero — un PNG idéntico a la página sin
         * modal. Apareció como duplicado intermitente en la corrida completa y
         * no en la del módulo aislado, que es la firma de una carrera. En vez
         * de subir el tiempo a ojo, se espera a que el navegador declare
         * terminadas sus animaciones.
         */
        await settleAnimations(page)
        await page.waitForTimeout(100)
        const state = resolveCaptureState(route, reset.status, page.url(), "interaction")
        if (!isSuccessfulCaptureState(state)) {
          recordInvalidInteraction(results, {
            viewport, route, requestedUrl, finalUrl: page.url(), status: reset.status,
            type: "modal", selector: "dynamic-modal",
            error: `La interacción abandonó la ruta declarada. Pathnames permitidos: ${getAllowedCapturePaths(route).join(", ")}`,
          })
          return
        }
        const modalScreenshot = path.join(outputDir, `${viewport}-${route.slug}-modal-auto-${cleanSlug}.png`)
        await page.screenshot({ path: modalScreenshot, fullPage: true })

        results.push({
          viewport,
          slug: `${route.slug}-modal-auto-${cleanSlug}`,
          path: route.path,
          requestedUrl,
          finalUrl: page.url(),
          status: reset.status,
          ok: true,
          state,
          type: "modal",
          screenshot: path.relative(root, modalScreenshot),
          screenshotHash: screenshotHash(modalScreenshot),
          selector: "dynamic-modal",
          notes: `Modal automático: ${text}`,
        })

        await page.keyboard.press("Escape").catch(() => undefined)
        await page.waitForTimeout(100)
      }
    }
  } catch {
    // Dynamic modal scan fallback
  }
}

/**
 * Dos disparadores (o pestañas) con el mismo texto visible generaban el mismo
 * nombre de archivo: el segundo pisaba al primero y ambos resultados apuntaban
 * a una sola imagen. El sufijo mantiene una captura por interacción real.
 */
function isDeclaredElsewhere(route: RouteTarget, url: string): boolean {
  const parsed = new URL(url, baseUrl)
  const current = `${parsed.pathname}${parsed.search}`
  return getCaptureRoutes().some((other) => other.slug !== route.slug && other.path === current)
}

export function uniqueInteractionSlug(used: Set<string>, base: string): string {
  let slug = base
  let n = 2
  while (used.has(slug)) slug = `${base}-${n++}`
  used.add(slug)
  return slug
}

async function captureTabsForRoute(
  page: Page,
  viewport: string,
  route: RouteTarget,
  requestedUrl: string,
  status: number | null,
  results: CaptureResult[]
) {
  try {
    // Una ruta que ya declara su pestaña en la query (`?tab=facturacion`) es la
    // evidencia de esa pestaña. Volver a barrer todas desde ella multiplica el
    // mismo conjunto de vistas por cada ruta declarada y no agrega evidencia.
    if (new URL(route.path, baseUrl).searchParams.has("tab")) return
    const tabs = page.locator('[role="tab"], button[data-state="inactive"]')
    const count = await tabs.count().catch(() => 0)
    const maxTabs = Math.min(count, 5)
    const usedTabSlugs = new Set<string>()

    for (let i = 0; i < maxTabs; i++) {
      const reset = await resetRouteForInteraction(page, route, requestedUrl)
      if (!reset.ok) {
        recordInvalidInteraction(results, {
          viewport, route, requestedUrl, finalUrl: reset.finalUrl, status: reset.status,
          type: "tab", selector: `[role="tab"]:nth(${i})`,
          error: `La ruta base no coincide con su allowlist: ${getAllowedCapturePaths(route).join(", ")}`,
        })
        return
      }
      const tab = tabs.nth(i)
      if (!(await tab.isVisible({ timeout: 1000 }).catch(() => false))) continue
      // La pestaña ya activa es la vista que acaba de capturarse: repetirla
      // produce dos archivos idénticos y una cobertura nominal inflada.
      if ((await tab.getAttribute("data-state").catch(() => null)) === "active") continue
      if ((await tab.getAttribute("aria-selected").catch(() => null)) === "true") continue
      const text = (await tab.textContent().catch(() => ""))?.trim() || `tab-${i}`
      const cleanSlug = uniqueInteractionSlug(usedTabSlugs, text.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30))

      await tab.click({ force: true }).catch(() => undefined)
      await settle(page)

      const state = resolveCaptureState(route, reset.status, page.url(), "interaction")
      if (!isSuccessfulCaptureState(state)) {
        recordInvalidInteraction(results, {
          viewport, route, requestedUrl, finalUrl: page.url(), status: reset.status,
          type: "tab", selector: `[role="tab"]:nth(${i})`,
          error: `La interacción abandonó la ruta declarada. Pathnames permitidos: ${getAllowedCapturePaths(route).join(", ")}`,
        })
        return
      }

      // Si la pestaña deja la URL de otra ruta ya declarada, esa ruta es la
      // evidencia canónica: capturar aquí produce el mismo PNG dos veces.
      if (isDeclaredElsewhere(route, page.url())) continue

      const tabScreenshot = path.join(outputDir, `${viewport}-${route.slug}-tab-${cleanSlug}.png`)
      await page.screenshot({ path: tabScreenshot, fullPage: true })

      results.push({
        viewport,
        slug: `${route.slug}-tab-${cleanSlug}`,
        path: route.path,
        requestedUrl,
        finalUrl: page.url(),
        status: reset.status,
        ok: true,
        state,
        type: "tab",
        screenshot: path.relative(root, tabScreenshot),
        screenshotHash: screenshotHash(tabScreenshot),
        selector: `[role="tab"]:nth(${i})`,
        notes: `Pestaña React State: ${text}`,
      })
    }
  } catch {
    // Tab capture fallback
  }
}

async function captureSelectsForRoute(
  page: Page,
  viewport: string,
  route: RouteTarget,
  requestedUrl: string,
  status: number | null,
  results: CaptureResult[]
) {
  try {
    // El selector NO incluye `[aria-haspopup="menu"]`: un DropdownMenu de Radix
    // satisface a la vez ese atributo y `data-radix-dropdown-menu-trigger`, así
    // que el mismo control se capturaba como select-* y dropdown-* con el mismo
    // hash (auditoría §3.2, casos Columnas / Más acciones / Abrir menú).
    const triggers = page.locator('[role="combobox"], [aria-haspopup="listbox"], button[id*="select"]')
    const count = await triggers.count().catch(() => 0)
    const maxSelects = Math.min(count, 2)
    const usedSelectSlugs = new Set<string>()

    for (let i = 0; i < maxSelects; i++) {
      const reset = await resetRouteForInteraction(page, route, requestedUrl)
      if (!reset.ok) {
        recordInvalidInteraction(results, {
          viewport, route, requestedUrl, finalUrl: reset.finalUrl, status: reset.status,
          type: "select", selector: "[role=combobox]",
          error: `La ruta base no coincide con su allowlist: ${getAllowedCapturePaths(route).join(", ")}`,
        })
        return
      }
      const trigger = triggers.nth(i)
      if (!(await trigger.isVisible({ timeout: 1000 }).catch(() => false))) continue
      const label = (await trigger.getAttribute("aria-label").catch(() => "")) || (await trigger.textContent().catch(() => "")) || `select-${i}`
      const baseSlug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 25) || `select-${i}`
      const cleanSlug = uniqueInteractionSlug(usedSelectSlugs, baseSlug)

      await trigger.click({ force: true }).catch(() => undefined)
      const menuSelector = '[role="listbox"], [role="menu"], [data-radix-popper-content-wrapper]'
      const opened = await page.waitForSelector(menuSelector, { state: "visible", timeout: 2000 }).catch(() => null)

      if (opened) {
        /*
         * 100 ms no siempre alcanzan: el diálogo ya está en el árbol y visible,
         * pero su animación de entrada aún no terminó, así que la captura sale
         * con el overlay a opacidad cero — un PNG idéntico a la página sin
         * modal. Apareció como duplicado intermitente en la corrida completa y
         * no en la del módulo aislado, que es la firma de una carrera. En vez
         * de subir el tiempo a ojo, se espera a que el navegador declare
         * terminadas sus animaciones.
         */
        await settleAnimations(page)
        await page.waitForTimeout(100)
        const state = resolveCaptureState(route, reset.status, page.url(), "interaction")
        if (!isSuccessfulCaptureState(state)) {
          recordInvalidInteraction(results, {
            viewport, route, requestedUrl, finalUrl: page.url(), status: reset.status,
            type: "select", selector: "[role=combobox]",
            error: `La interacción abandonó la ruta declarada. Pathnames permitidos: ${getAllowedCapturePaths(route).join(", ")}`,
          })
          return
        }
        const selectScreenshot = path.join(outputDir, `${viewport}-${route.slug}-select-${cleanSlug}.png`)
        await page.screenshot({ path: selectScreenshot, fullPage: true })

        results.push({
          viewport,
          slug: `${route.slug}-select-${cleanSlug}`,
          path: route.path,
          requestedUrl,
          finalUrl: page.url(),
          status: reset.status,
          ok: true,
          state,
          type: "select",
          screenshot: path.relative(root, selectScreenshot),
          screenshotHash: screenshotHash(selectScreenshot),
          selector: "[role=combobox]",
          notes: `Desplegable / Select: ${label}`,
        })

        await page.keyboard.press("Escape").catch(() => undefined)
        await page.waitForTimeout(100)
      }
    }
  } catch {
    // Select capture fallback
  }
}

async function captureTooltipsForRoute(
  page: Page,
  viewport: string,
  route: RouteTarget,
  requestedUrl: string,
  status: number | null,
  results: CaptureResult[]
) {
  try {
    // El selector anterior incluía button.btn-primary que es demasiado amplio
    // y no distingue botones con tooltip de los que no lo tienen. El selector
    // Radix es preciso: TooltipTrigger envuelve al elemento objetivo y le
    // inyecta aria-describedby apuntando al contenido del tooltip.
    const tooltipTriggers = page.locator('[data-radix-tooltip-trigger], [data-state][aria-describedby]')
    const count = await tooltipTriggers.count().catch(() => 0)
    const maxHover = Math.min(count, 2)

    for (let i = 0; i < maxHover; i++) {
      const reset = await resetRouteForInteraction(page, route, requestedUrl)
      if (!reset.ok) {
        recordInvalidInteraction(results, {
          viewport, route, requestedUrl, finalUrl: reset.finalUrl, status: reset.status,
          type: "hover", selector: "[data-radix-tooltip-trigger]",
          error: `La ruta base no coincide con su allowlist: ${getAllowedCapturePaths(route).join(", ")}`,
        })
        return
      }
      const el = tooltipTriggers.nth(i)
      if (!(await el.isVisible({ timeout: 1000 }).catch(() => false))) continue
      const label = (await el.getAttribute("title").catch(() => "")) || (await el.textContent().catch(() => "")) || `hover-${i}`
      const cleanSlug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 25)

      await el.hover().catch(() => undefined)
      await page.waitForTimeout(150)

      const state = resolveCaptureState(route, reset.status, page.url(), "interaction")
      if (!isSuccessfulCaptureState(state)) {
        recordInvalidInteraction(results, {
          viewport, route, requestedUrl, finalUrl: page.url(), status: reset.status,
          type: "hover", selector: "[data-radix-tooltip-trigger]",
          error: `La interacción abandonó la ruta declarada. Pathnames permitidos: ${getAllowedCapturePaths(route).join(", ")}`,
        })
        return
      }

      const hoverScreenshot = path.join(outputDir, `${viewport}-${route.slug}-hover-${cleanSlug}.png`)
      await page.screenshot({ path: hoverScreenshot, fullPage: true })

      results.push({
        viewport,
        slug: `${route.slug}-hover-${cleanSlug}`,
        path: route.path,
        requestedUrl,
        finalUrl: page.url(),
        status: reset.status,
        ok: true,
        state,
        type: "hover",
        screenshot: path.relative(root, hoverScreenshot),
        screenshotHash: screenshotHash(hoverScreenshot),
        selector: "[data-radix-tooltip-trigger]",
        notes: `Estado Hover / Tooltip: ${label}`,
      })
      await page.mouse.move(0, 0).catch(() => undefined)
    }
  } catch {
    // Tooltip safe fallback
  }
}

// ── DropdownMenus ("⋮ Más acciones") ─────────────────────────────────────

/**
 * Captura menús DropdownMenu de Radix: los "⋮" / "Más acciones" que
 * abren un popover con acciones contextuales (ver, editar, eliminar,
 * exportar, etc.). El selector usa `data-radix-dropdown-menu-trigger`
 * que es el atributo que Radix inyecta en el `DropdownMenuTrigger`.
 *
 * Se limita a 3 por página para no explotar el tiempo de ejecución.
 */
async function captureDropdownMenusForRoute(
  page: Page,
  viewport: string,
  route: RouteTarget,
  requestedUrl: string,
  status: number | null,
  results: CaptureResult[]
) {
  try {
    // Excluye lo que el barrido de select ya cubrió ([role=combobox] y
    // aria-haspopup="listbox"): un control con ambos atributos se capturaba dos
    // veces con el mismo hash (auditoría §3.2, misma causa que la nota del scan
    // de select).
    const triggers = page.locator(
      '[data-radix-dropdown-menu-trigger]:not([role="combobox"]):not([aria-haspopup="listbox"]), [data-state="closed"][aria-haspopup="menu"]:not([role="combobox"]):not([aria-haspopup="listbox"]):not(button[id*="select"])'
    )
    const count = await triggers.count().catch(() => 0)
    const maxMenus = Math.min(count, 2)

    for (let i = 0; i < maxMenus; i++) {
      const reset = await resetRouteForInteraction(page, route, requestedUrl)
      if (!reset.ok) {
        recordInvalidInteraction(results, {
          viewport, route, requestedUrl, finalUrl: reset.finalUrl, status: reset.status,
          type: "dropdown", selector: "[data-radix-dropdown-menu-trigger]",
          error: `La ruta base no coincide con su allowlist: ${getAllowedCapturePaths(route).join(", ")}`,
        })
        return
      }
      const trigger = triggers.nth(i)
      if (!(await trigger.isVisible({ timeout: 1000 }).catch(() => false))) continue
      const label =
        (await trigger.getAttribute("aria-label").catch(() => "")) ||
        (await trigger.getAttribute("title").catch(() => "")) ||
        (await trigger.textContent().catch(() => "")) ||
        `dropdown-${i}`
      const cleanSlug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 25)

      // No duplicar si el modal auto-discovery ya lo capturó
      if (route.modals?.some((m) => m.slug === cleanSlug)) continue

      await trigger.click({ force: true }).catch(() => undefined)
      const menuSelector = '[role="menu"], [data-radix-dropdown-menu-content]'
      const opened = await page
        .waitForSelector(menuSelector, { state: "visible", timeout: 2000 })
        .catch(() => null)

      if (opened) {
        /*
         * 100 ms no siempre alcanzan: el diálogo ya está en el árbol y visible,
         * pero su animación de entrada aún no terminó, así que la captura sale
         * con el overlay a opacidad cero — un PNG idéntico a la página sin
         * modal. Apareció como duplicado intermitente en la corrida completa y
         * no en la del módulo aislado, que es la firma de una carrera. En vez
         * de subir el tiempo a ojo, se espera a que el navegador declare
         * terminadas sus animaciones.
         */
        await settleAnimations(page)
        await page.waitForTimeout(100)
        const state = resolveCaptureState(route, reset.status, page.url(), "interaction")
        if (!isSuccessfulCaptureState(state)) {
          recordInvalidInteraction(results, {
            viewport, route, requestedUrl, finalUrl: page.url(), status: reset.status,
            type: "dropdown", selector: "[data-radix-dropdown-menu-trigger]",
            error: `La interacción abandonó la ruta declarada. Pathnames permitidos: ${getAllowedCapturePaths(route).join(", ")}`,
          })
          return
        }
        const menuScreenshot = path.join(
          outputDir,
          `${viewport}-${route.slug}-dropdown-${cleanSlug}.png`
        )
        await page.screenshot({ path: menuScreenshot, fullPage: true })

        results.push({
          viewport,
          slug: `${route.slug}-dropdown-${cleanSlug}`,
          path: route.path,
          requestedUrl,
          finalUrl: page.url(),
          status: reset.status,
          ok: true,
          state,
          type: "dropdown",
          screenshot: path.relative(root, menuScreenshot),
          screenshotHash: screenshotHash(menuScreenshot),
          selector: "[data-radix-dropdown-menu-trigger]",
          notes: `Menú contextual: ${label}`,
        })

        await page.keyboard.press("Escape").catch(() => undefined)
        await page.waitForTimeout(100)
      }
    }
  } catch {
    // DropdownMenu capture fallback
  }
}

async function captureRoute(context: BrowserContext, viewport: string, route: RouteTarget, serverBaseUrl: string = baseUrl): Promise<CaptureResult[]> {
  const requestedUrl = `${serverBaseUrl}${route.path}`
  const screenshot = path.join(outputDir, `${viewport}-${route.slug}.png`)
  const relativeScreenshot = path.relative(root, screenshot)
  const results: CaptureResult[] = []

  const maxRetries = 2
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const page = await context.newPage()
    const pageErrors: string[] = []
    page.on("pageerror", (err) => {
      if (/Connection closed|WebSocket|net::ERR_/i.test(err.message)) return
      pageErrors.push(`[pageerror] ${err.message}`)
    })
    page.on("console", (msg) => {
      if (msg.type() !== "error") return
      const text = msg.text()
      if (/favicon|Failed to load resource|net::ERR_|Connection closed|WebSocket/i.test(text)) return
      if (/sentry\.io|Content Security Policy/i.test(text)) return
      pageErrors.push(`[console] ${text}`)
    })

    try {
      const response = await page.goto(requestedUrl, { waitUntil: "domcontentloaded", timeout: 45_000 })
      await settle(page)
      const status = response?.status() ?? null
      const finalUrl = page.url()
      const state = resolveCaptureState(route, status, finalUrl)
      const mainOk = isExpectedStatus(status, route) && isSuccessfulCaptureState(state)
      await discoverRenderedNavigation(page, serverBaseUrl, route.slug)
      const shouldCaptureView = route.captureView !== false
      if (shouldCaptureView) {
        await page.screenshot({ path: screenshot, fullPage: true })
      }

      // A-7: detección de scroll horizontal (WCAG 1.4.10 Reflow). La auditoría
      // 2026-07-24 encontró /prevencion/evaluaciones a 676px en un viewport de
      // 390px comparando anchos de PNG a mano; esto lo automatiza y además
      // nombra al elemento culpable, que fue justo lo que no se pudo identificar.
      // Las rutas de (print) son documentos A4: son anchas por diseño.
      const skipOverflowCheck = route.slug.endsWith("-print")
      const overflow = skipOverflowCheck ? null : await page.evaluate(() => {
        const vw = document.documentElement.clientWidth
        if (document.documentElement.scrollWidth <= vw + 1) return null
        const CONTAINED = ["clip", "hidden", "auto", "scroll"]
        /**
         * Un elemento sólo arrastra el ancho del documento si NADA entre él y el
         * <body> lo recorta. La sutileza que costó encontrar la causa de A-7: un
         * descendiente `absolute` sólo lo recorta un ancestro que además sea su
         * BLOQUE CONTENEDOR (`position` distinto de `static`). Si no lo hay, su
         * bloque contenedor es el <html> y escapa a todos los `overflow` del
         * camino — así un `.sr-only` de 1px dentro de una tabla ancha llevó el
         * documento a 676px en un viewport de 390px.
         */
        const culprits = [...document.querySelectorAll<HTMLElement>("body *")]
          .filter((el) => {
            const r = el.getBoundingClientRect()
            if (r.width === 0 || r.right <= vw + 1) return false
            const style = getComputedStyle(el)
            if (CONTAINED.includes(style.overflowX)) return false
            const escapesStaticClips = style.position === "absolute" || style.position === "fixed"
            for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
              const as = getComputedStyle(a)
              // Para un absolute/fixed, un ancestro `static` no recorta nada.
              if (escapesStaticClips && as.position === "static") continue
              if (CONTAINED.includes(as.overflowX)) return false
            }
            return true
          })
          .slice(0, 5)
          .map((el) => `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).trim().split(/\s+/).slice(0, 3).join(".") : ""} (right=${Math.round(el.getBoundingClientRect().right)}px)`)
        return { scrollWidth: document.documentElement.scrollWidth, viewportWidth: vw, culprits }
      }).catch(() => null)

      if (overflow) {
        console.warn(
          `  ⚠ scroll horizontal en ${viewport} ${route.slug}: ${overflow.scrollWidth}px > ${overflow.viewportWidth}px` +
          (overflow.culprits.length ? `\n      culpables: ${overflow.culprits.join(" · ")}` : ""),
        )
        horizontalOverflows.push({ viewport, slug: route.slug, ...overflow })
      }

      if (pageErrors.length > 0) {
        const messages = [...new Set(pageErrors)].slice(0, 5)
        console.warn(`  ⚠ error de cliente en ${viewport} ${route.slug}:`)
        for (const m of messages) console.warn(`      ${m}`)
        clientErrors.push({ viewport, slug: route.slug, messages })
      }

      results.push({
        viewport,
        slug: route.slug,
        path: route.path,
        requestedUrl,
        finalUrl,
        status,
        ok: mainOk,
        state,
        type: "view",
        screenshot: shouldCaptureView ? relativeScreenshot : "",
        screenshotHash: shouldCaptureView ? screenshotHash(screenshot) : undefined,
        error: mainOk
          ? undefined
          : state === "capture-invalid"
            ? `URL final no declarada. Permitidas: ${getAllowedCapturePaths(route).join(", ")}`
            : `Estado HTTP inesperado: ${status ?? "sin respuesta"}`,
        notes: route.notes,
      })

      // Una ruta inexistente no tiene interacción propia: barrer sus modales y
      // pestañas sólo produce capturas del chrome compartido, iguales entre sí.
      if (mainOk && shouldCaptureView && route.expectedStatus !== 404) {
        if (captureMode === "modals" || captureMode === "full") {
          await captureModalsForRoute(page, viewport, route, requestedUrl, status, results)
        }
        if (captureMode === "tabs" || captureMode === "modals" || captureMode === "full") {
          await captureTabsForRoute(page, viewport, route, requestedUrl, status, results)
        }
        if (captureMode === "interactive" || captureMode === "full") {
          await captureSelectsForRoute(page, viewport, route, requestedUrl, status, results)
          await captureDropdownMenusForRoute(page, viewport, route, requestedUrl, status, results)
          await captureTooltipsForRoute(page, viewport, route, requestedUrl, status, results)
        }
      }

      await page.close()
      return results
    } catch (error) {
      await page.close().catch(() => undefined)

      const errorMsg = error instanceof Error ? error.message : String(error)
      const isConnectionError = errorMsg.includes("ERR_CONNECTION_REFUSED") || errorMsg.includes("ERR_CONNECTION_RESET")

      if (isConnectionError && attempt < maxRetries) {
        console.log(`  Retry ${attempt + 1}/${maxRetries} for ${route.slug} (${errorMsg})`)
        await new Promise((resolve) => setTimeout(resolve, 2_000))
        continue
      }

      return [{
        viewport,
        slug: route.slug,
        path: route.path,
        requestedUrl,
        finalUrl: requestedUrl,
        status: null,
        ok: false,
        state: "capture-invalid",
        screenshot: relativeScreenshot,
        error: errorMsg,
        notes: route.notes,
      }]
    }
  }

  // TypeScript can't prove every iteration returns/continues, but in practice
  // the loop always exits via return. This satisfies the compiler.
  return []
}

async function settle(page: Page) {
  // 12s covers cold-start API calls (dashboard queries, analytics) that 8s
  // missed, causing screenshots with empty charts. The .catch keeps it
  // best-effort — pages that never reach networkidle still get captured.
  await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined)
  // 300ms after networkidle lets CSS animations and lazy images settle
  // without adding unnecessary wall-clock time across 170+ routes.
  await page.waitForTimeout(300)
}

function isExpectedStatus(status: number | null, route: RouteTarget) {
  if (route.expectedStatus !== undefined) {
    return status === route.expectedStatus
  }
  return !status || status < 400
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
