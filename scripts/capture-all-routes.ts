import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { spawn, type ChildProcess } from "node:child_process"
import crypto from "node:crypto"
import postgres from "postgres"
import bcrypt from "bcryptjs"
import { chromium, type BrowserContext, type Page } from "@playwright/test"
import { loadEnvConfig } from "@next/env"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { sql } from "drizzle-orm"
import * as schema from "../db/schema"
import { SYSTEM_PERMISSIONS } from "@/lib/auth/system-rbac"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  getRedactedDatabaseIdentifier,
  quotePostgresIdentifier,
} from "../lib/testing/destructive-database-guard"

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
 *     CAPTURE_CONCURRENCY               Workers en paralelo (def. 4)
 *     CAPTURE_ALLOW_DESTRUCTIVE_RESET   "true" para permitir reset de BD
 *
 * ── FILTRO POR MÓDULO ─────────────────────────────────────────────────────
 *
 *   Primer argumento (salvo que sea "desktop" o "mobile") es el prefijo del
 *   slug para capturar solo un submódulo. Prefijos disponibles:
 *     combustibles, prevencion, admin, solicitudes, compras, recepcion,
 *     bodega, entregas, trazabilidad, reportes, analitica, flota,
 *     mantenciones, repuestos, servicios, soporte
 *
 *   Las rutas públicas (login, etc.) siempre se incluyen para permitir
 *   la autenticación.
 *
 * ── FILTRO POR VIEWPORT ───────────────────────────────────────────────────
 *
 *   Cualquier argumento que sea "desktop" o "mobile" filtra las capturas
 *   a solo ese viewport. Puede ir como primer o segundo argumento:
 *
 *     npm run ss desktop                  Solo desktop 1920×1080
 *     npm run ss admin mobile             Solo admin en mobile 390×844
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
 *   1. Prepara BD:   resetea esquema → migraciones → inserta fixtures
 *   2. Inicia server Next.js embebido en CAPTURE_PORT
 *   3. Abre Chromium y captura en 1 o 2 viewports según filtro:
 *       a) Rutas públicas (sin auth)
 *       b) Login como admin.audit@chome.cl
 *       c) Rutas autenticadas
 *   4. Barra de progreso en vivo con spinner, ⏱ tiempo transcurrido y ETA
 *   5. Genera manifest.json con resultados y metadatos
 *   6. Cierra servidor y navegador
 */

loadEnvConfig(process.cwd())

function parseCliArgs(): { moduleFilter: string | undefined; viewportFilter: string | undefined } {
  const viewportNames = new Set(["desktop", "mobile"])
  const raw = process.argv.slice(2).map((a) => a.trim().toLowerCase()).filter(Boolean)
  let moduleFilter: string | undefined
  let viewportFilter: string | undefined
  for (const arg of raw) {
    if (viewportNames.has(arg)) {
      viewportFilter = arg
    } else {
      moduleFilter = arg
    }
  }
  return { moduleFilter, viewportFilter }
}

const { moduleFilter, viewportFilter } = parseCliArgs()

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
 * Errores de JavaScript en el navegador. Existe porque `/combustibles/bitacora`
 * renderizaba su error boundary con status 200 y el servidor no registraba nada:
 * el fallo era de cliente y el manifest lo reportaba como `ok: true`. Un 200 no
 * significa que la página funcione.
 */
interface ClientError { viewport: string; slug: string; messages: string[] }
const clientErrors: ClientError[] = []

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
  expectedStatus?: number
  notes?: string
  modals?: ModalTarget[]
}

export type CaptureSeedArea = {
  section: string
  fixtures: string[]
}

type CaptureResult = {
  viewport: string
  slug: string
  path: string
  requestedUrl: string
  finalUrl: string
  status: number | null
  ok: boolean
  screenshot: string
  error?: string
  notes?: string
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

function requireCaptureDatabaseUrl() {
  const databaseUrl = process.env.CAPTURE_DATABASE_URL
  if (!databaseUrl) throw new Error("CAPTURE_DATABASE_URL is required")
  return databaseUrl
}

const desktop = { name: "desktop", width: 1920, height: 1080 }
const mobile = { name: "mobile", width: 390, height: 844 }

const routeTargets: RouteTarget[] = [
  { slug: "root", path: "/", auth: false },
  { slug: "login", path: "/login", auth: false },
  { slug: "registro", path: "/registro", auth: false },
  { slug: "recuperar", path: "/recuperar", auth: false },
  { slug: "recuperar-token", path: "/recuperar/capture-reset-token", auth: false },
  { slug: "not-found", path: "/ruta-inexistente-auditoria", auth: true, expectedStatus: 404 },
  { slug: "dashboard", path: "/dashboard", auth: true },
  { slug: "perfil", path: "/perfil", auth: true },
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
  {
    slug: "recepcion",
    path: "/recepcion",
    auth: true,
    modals: [
      { slug: "leyenda", triggerSelector: 'summary:has-text("Qué significa cada estado")', waitForSelector: 'text=llegaron a oficina Chome', notes: "Leyenda de estados de recepción expandida" },
    ],
  },
  { slug: "recepcion-nueva", path: "/recepcion/nueva?oc=po-audit-1", auth: true },
  { slug: "recepcion-detalle", path: "/recepcion/rec-audit-1", auth: true },
  {
    slug: "bodega",
    path: "/bodega",
    auth: true,
    modals: [
      { slug: "movimiento", triggerSelector: 'button:has-text("Movimiento"), button:has-text("Registrar")', notes: "Sheet de movimiento de bodega" },
    ],
  },
  { slug: "entregas", path: "/entregas", auth: true },
  { slug: "entregas-print", path: "/entregas/del-audit-1/print", auth: true },
  { slug: "trazabilidad", path: "/trazabilidad", auth: true },
  { slug: "trazabilidad-detalle", path: "/trazabilidad/req-item-audit-1", auth: true },
  { slug: "trazabilidad-trabajador", path: "/trazabilidad/trabajador/worker-audit-1", auth: true },
  { slug: "reportes", path: "/reportes", auth: true },
  { slug: "analitica", path: "/analitica", auth: true },
  { slug: "flota", path: "/flota", auth: true },
  { slug: "flota-detalle", path: "/flota/fuel-veh-audit-1", auth: true },
  { slug: "mantenciones", path: "/mantenciones", auth: true },
  // ── Combustibles ──────────────────────────────────────────────────────
  { slug: "combustibles", path: "/combustibles", auth: true },
  { slug: "combustibles-nueva", path: "/combustibles/nueva", auth: true },
  { slug: "combustibles-detalle", path: "/combustibles/fuel-audit-1", auth: true },
  { slug: "combustibles-reportes", path: "/combustibles/reportes", auth: true },
  { slug: "combustibles-vehiculos-legacy", path: "/combustibles/vehiculos", auth: true, notes: "Compatibilidad: redirige al catálogo administrativo canónico." },
  { slug: "combustibles-proveedores-legacy", path: "/combustibles/proveedores-combustible", auth: true, notes: "Compatibilidad: redirige al catálogo administrativo canónico." },
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
  { slug: "combustibles-bitacora-historial", path: "/combustibles/bitacora/historial/sst/entity-audit-1", auth: true },
  { slug: "combustibles-ciclo", path: "/combustibles/ciclo", auth: true },
  { slug: "combustibles-sellos", path: "/combustibles/sellos", auth: true },
  { slug: "repuestos", path: "/repuestos", auth: true },
  { slug: "repuestos-nueva", path: "/repuestos/nueva", auth: true },
  { slug: "repuestos-detalle", path: "/repuestos/rep-audit-1", auth: true },
  { slug: "servicios", path: "/servicios", auth: true },
  { slug: "servicios-nueva", path: "/servicios/nueva", auth: true },
  { slug: "servicios-detalle", path: "/servicios/srv-audit-1", auth: true },
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
  { slug: "prevencion-pdtp-editar", path: "/prevencion/pdtp/prog-audit-1/editar", auth: true },
  { slug: "prevencion-pdtp-ejecucion", path: "/prevencion/pdtp/prog-audit-1/ejecucion/exec-audit-1", auth: true },
  { slug: "prevencion-pdtp-reporte", path: "/prevencion/pdtp/prog-audit-1/reporte", auth: true },
  { slug: "prevencion-pdtp-acciones", path: "/prevencion/pdtp/acciones", auth: true },
  { slug: "prevencion-pdtp-aplicabilidad", path: "/prevencion/pdtp/aplicabilidad", auth: true },
  { slug: "prevencion-pdtp-obligaciones", path: "/prevencion/pdtp/obligaciones", auth: true },
  { slug: "prevencion-pdtp-plantillas", path: "/prevencion/pdtp/plantillas", auth: true },
  { slug: "prevencion-pdtp-nuevo", path: "/prevencion/pdtp/nuevo", auth: true },
  { slug: "prevencion-pdtp-aprobaciones", path: "/prevencion/pdtp/aprobaciones", auth: true },
  { slug: "prevencion-pdtp-cobertura", path: "/prevencion/pdtp/cobertura", auth: true },
  { slug: "prevencion-capa", path: "/prevencion/capa", auth: true },
  { slug: "prevencion-capa-detalle", path: "/prevencion/capa/capa-audit-1", auth: true, expectedStatus: 404, notes: "Inventario de ruta; la base de captura no crea aún una CAPA de detalle." },
  { slug: "prevencion-incidentes", path: "/prevencion/incidentes", auth: true },
  { slug: "prevencion-incidentes-reportar", path: "/prevencion/incidentes/reportar", auth: true },
  { slug: "prevencion-incidentes-importar", path: "/prevencion/incidentes/importar", auth: true },
  { slug: "prevencion-incidentes-detalle", path: "/prevencion/incidentes/inc-audit-1", auth: true, expectedStatus: 404, notes: "Inventario de ruta; la base de captura no crea aún un incidente de detalle." },
  { slug: "prevencion-incidentes-procedimiento", path: "/prevencion/incidentes/inc-audit-1/procedimiento", auth: true, expectedStatus: 404, notes: "Inventario de ruta; procedimiento del incidente." },
  { slug: "prevencion-miper", path: "/prevencion/miper", auth: true },
  { slug: "prevencion-miper-control", path: "/prevencion/miper/controles/risk-control-audit-1", auth: true, expectedStatus: 404, notes: "Inventario de ruta; la base de captura no crea aún un control MIPER de detalle." },
  { slug: "prevencion-requisitos-legales", path: "/prevencion/requisitos-legales", auth: true },
  { slug: "prevencion-requisito-legal", path: "/prevencion/requisitos-legales/legal-requirement-audit-1", auth: true, expectedStatus: 404, notes: "Inventario de ruta; la base de captura no crea aún un requisito de detalle." },
  { slug: "prevencion-privacidad-auditoria", path: "/prevencion/privacidad/auditoria", auth: true },
  { slug: "prevencion-privacidad-solicitudes", path: "/prevencion/privacidad/solicitudes", auth: true },
  { slug: "prevencion-privacidad-solicitud", path: "/prevencion/privacidad/solicitudes/privacy-request-audit-1", auth: true, expectedStatus: 404, notes: "Inventario de ruta; la base de captura no crea aún una solicitud de privacidad de detalle." },
  // ── Prevención: capacidades P1 implementadas el 19-07-2026 ──
  { slug: "prevencion-capacitacion", path: "/prevencion/capacitacion", auth: true },
  { slug: "prevencion-capacitacion-catalogo", path: "/prevencion/capacitacion/catalogo", auth: true },
  { slug: "prevencion-capacitacion-competencias", path: "/prevencion/capacitacion/competencias", auth: true },
  { slug: "prevencion-capacitacion-brechas", path: "/prevencion/capacitacion/brechas", auth: true },
  { slug: "prevencion-capacitacion-sesion", path: "/prevencion/capacitacion/trsess-audit-1", auth: true, expectedStatus: 404, notes: "Inventario de ruta; la base de captura no crea aún una sesión de capacitación." },
  { slug: "prevencion-permisos", path: "/prevencion/permisos", auth: true },
  { slug: "prevencion-permiso-detalle", path: "/prevencion/permisos/permit-audit-1", auth: true, expectedStatus: 404, notes: "Inventario de ruta; la base de captura no crea aún un permiso de detalle." },
  { slug: "prevencion-inspecciones", path: "/prevencion/inspecciones", auth: true },
  { slug: "prevencion-inspecciones-catalogo", path: "/prevencion/inspecciones/catalogo", auth: true },
  { slug: "prevencion-inspeccion-detalle", path: "/prevencion/inspecciones/insp-audit-1", auth: true, expectedStatus: 404, notes: "Inventario de ruta; la base de captura no crea aún una inspección de detalle." },
  { slug: "prevencion-cphs", path: "/prevencion/cphs", auth: true },
  { slug: "prevencion-cphs-comite-detalle", path: "/prevencion/cphs/comite-audit-1", auth: true, expectedStatus: 404, notes: "Inventario de ruta; la base de captura no crea aún un comité de detalle." },
  { slug: "prevencion-higiene", path: "/prevencion/higiene", auth: true },
  { slug: "prevencion-higiene-grupo-detalle", path: "/prevencion/higiene/grupos/grupo-audit-1", auth: true, expectedStatus: 404, notes: "Inventario de ruta; la base de captura no crea aún un GES de detalle." },
  { slug: "prevencion-higiene-programa-detalle", path: "/prevencion/higiene/programas/programa-audit-1", auth: true, expectedStatus: 404, notes: "Inventario de ruta; la base de captura no crea aún un programa de detalle." },
  { slug: "prevencion-emergencias", path: "/prevencion/emergencias", auth: true },
  { slug: "prevencion-emergencias-plan-detalle", path: "/prevencion/emergencias/plan-audit-1", auth: true, expectedStatus: 404, notes: "Inventario de ruta; la base de captura no crea aún un plan de detalle." },
  { slug: "prevencion-gestion-cambio", path: "/prevencion/gestion-cambio", auth: true },
  { slug: "prevencion-gestion-cambio-detalle", path: "/prevencion/gestion-cambio/cambio-audit-1", auth: true, expectedStatus: 404, notes: "Inventario de ruta; la base de captura no crea aún un cambio de detalle." },
  { slug: "prevencion-epp-preventivo", path: "/prevencion/epp-preventivo", auth: true },
  { slug: "prevencion-documentacion", path: "/prevencion/documentacion", auth: true },
  { slug: "prevencion-documentacion-detalle", path: "/prevencion/documentacion/doc-audit-1", auth: true },
  { slug: "prevencion-documentacion-nuevo", path: "/prevencion/documentacion/nuevo", auth: true },
  { slug: "prevencion-documentacion-papelera", path: "/prevencion/documentacion/papelera", auth: true },
  { slug: "prevencion-documentacion-revisiones", path: "/prevencion/documentacion/revisiones", auth: true },
  { slug: "prevencion-documentacion-vencimientos", path: "/prevencion/documentacion/vencimientos", auth: true },
  { slug: "prevencion-documentacion-regularizacion", path: "/prevencion/documentacion/regularizacion", auth: true },
  { slug: "sst-print", path: "/sst/sst-audit-1/print", auth: true },
  { slug: "ppa-form", path: "/ppa", auth: false },
  { slug: "ppa-result", path: "/ppa/result/capture-ppa-token", auth: false },
  { slug: "tae-form", path: "/tae", auth: false },
  { slug: "tae-access", path: "/tae/access/capture-tae-token", auth: false },
  { slug: "tae-resultado", path: "/tae/resultado/capture-tae-result-token", auth: false },
  { slug: "prevencion-ppa", path: "/prevencion/ppa", auth: true },
  { slug: "prevencion-ppa-detalle", path: "/prevencion/ppa/ppa-audit-1", auth: true },
  { slug: "admin", path: "/admin", auth: true },
  { slug: "admin-auditoria", path: "/admin/auditoria", auth: true },
  { slug: "admin-catalogos-productos", path: "/admin/catalogos-productos", auth: true },
  { slug: "admin-centros-costo", path: "/admin/centros-costo", auth: true },
  { slug: "admin-configuracion", path: "/admin/configuracion", auth: true },
  { slug: "admin-correo-smtp", path: "/admin/correo-smtp", auth: true },
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
  { slug: "admin-productos-detalle", path: "/admin/productos/prod-audit-1", auth: true, notes: "Esta ruta redirige a /admin/productos." },
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
  { section: "bodega", fixtures: ["stock con mínimo crítico", "kardex ingreso OC", "kardex entrega a trabajador"] },
  { section: "entregas", fixtures: ["trabajadores activos", "EPP recibido pendiente de entrega", "historial de entregas"] },
  { section: "trazabilidad", fixtures: ["ítems aprobados", "ítems en OC", "ítems recibidos", "alerta sin OC"] },
  { section: "reportes", fixtures: ["solicitudes", "ítems", "OC", "recepciones", "estados variados"] },
  { section: "analitica", fixtures: ["compras", "combustible", "flota", "stock crítico", "EPP"] },
  { section: "flota", fixtures: ["vehículos activos", "cargas de combustible", "mantenciones"] },
  { section: "mantenciones", fixtures: ["vehículos", "proveedores", "mantenciones registradas"] },
  { section: "combustibles", fixtures: ["cargas de combustible", "carga TAE con resultado público", "vehículos de combustible", "proveedores de combustible", "cuentas corrientes", "reportes mensuales"] },
  { section: "repuestos", fixtures: ["solicitud de repuestos", "ítem libre", "cotización pendiente"] },
  { section: "servicios", fixtures: ["solicitud de servicios", "ítem libre", "cotización pendiente"] },
  { section: "prevencion", fixtures: ["evaluación nueva", "evaluación seguimiento", "plan de acción",    "indicadores mensuales de seguridad y salud en el trabajo", "indicadores material y ambiental"] },
  { section: "admin-faenas", fixtures: ["faenas activas"] },
  { section: "admin-plantillas", fixtures: ["plantillas de correo del sistema"] },
  { section: "admin-productos", fixtures: ["categorías", "productos EPP", "productos insumo", "proveedores preferidos", "importación EPP"] },
  { section: "admin-proveedores", fixtures: ["proveedores activos con contacto"] },
  { section: "admin-trabajadores", fixtures: ["trabajadores por faena"] },
  { section: "admin-usuarios", fixtures: ["usuarios con roles y faenas"] },
  { section: "admin-auditoria", fixtures: ["eventos create", "status_change", "update"] },
  { section: "admin-configuracion", fixtures: ["datos empresa", "pie OC", "límite PDF"] },
  { section: "notificaciones", fixtures: ["notificación no leída", "notificación leída"] },
  { section: "soporte", fixtures: ["reporte de soporte abierto", "reporte resuelto"] },
]

const moduleAliases: Record<string, string[]> = {
  adquisiciones: ["solicitudes", "compras", "recepcion"],
  compras: ["solicitudes", "compras", "recepcion"],
  sst: ["prevencion"],
  prevencion: ["prevencion"],
  combustible: ["combustibles"],
  combustibles: ["combustibles"],
  inventario: ["bodega", "entregas", "trazabilidad"],
}

export function getCaptureRoutes(filter?: string) {
  const routes = routeTargets.map((route) => ({ ...route }))
  if (!filter) return routes
  const allowedPrefixes = moduleAliases[filter] ?? [filter]
  return routes.filter(
    (r) => allowedPrefixes.some((prefix) => r.slug.startsWith(prefix)),
  )
}

export function getCaptureSeedCoverage() {
  return seedCoverage.map((area) => ({ ...area, fixtures: [...area.fixtures] }))
}

/**
 * Captura rutas en paralelo usando un pool de workers que comparten una cola.
 * Cada worker toma la siguiente ruta disponible (índice atómico en JS
 * single-threaded), ejecuta captureRoute y almacena el resultado en la
 * posición original para mantener el orden. El factor limitante es el
 * servidor Next.js (monoproceso); 4-8 workers son óptimos localmente.
 * La concurrencia se configura con CAPTURE_CONCURRENCY (default 4).
 */
async function captureRouteBatch(
  context: BrowserContext,
  viewport: string,
  routes: RouteTarget[],
  concurrency: number = Number(process.env.CAPTURE_CONCURRENCY) || 4,
): Promise<CaptureResult[]> {
  if (routes.length === 0) return []

  const total = routes.length
  const results: CaptureResult[] = []
  let nextIndex = 0
  let completedCount = 0
  let errorCount = 0
  const startTime = Date.now()

  async function worker() {
    while (nextIndex < routes.length) {
      const idx = nextIndex++
      const routeStart = Date.now()
      const routeResults = await captureRoute(context, viewport, routes[idx]!)
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
  finalizeProgress(total, errorCount)
  return results
}

async function main() {
  const captureDbUrl = requireCaptureDatabaseUrl()
  const routes = getCaptureRoutes(moduleFilter)

  if (moduleFilter) {
    console.log(`📷 Módulo filtrado: "${moduleFilter}" → ${routes.length} rutas específicas`)
  } else {
    console.log(`📷 Capturando todas las rutas (${routes.length} total)`)
  }
  if (viewportFilter) {
    console.log(`📐 Viewport filtrado: "${viewportFilter}"`)
  }

  // ── Preparar directorio de salida ──
  // Cuando hay filtro de módulo, la carpeta es fija y se limpia al empezar
  // para que cada ejecución sobrescriba las capturas anteriores.
  if (moduleFilter && fs.existsSync(outputDir)) {
    const entries = fs.readdirSync(outputDir)
    for (const entry of entries) {
      if (entry.endsWith(".png") || entry === "manifest.json") {
        fs.rmSync(path.join(outputDir, entry), { force: true })
      }
    }
  }
  fs.mkdirSync(outputDir, { recursive: true })

  await runWithSpinner("Preparando base de datos (reset → migraciones → fixtures)", () => prepareDatabase(captureDbUrl))
  const server = await startServer(captureDbUrl)
  const browser = await chromium.launch()
  const results: CaptureResult[] = []

  const viewports = (
    viewportFilter === "desktop" ? [desktop]
    : viewportFilter === "mobile" ? [mobile]
    : [desktop, mobile]
  )

  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        locale: "es-CL",
      })

      const nonAuthRoutes = routes.filter((r) => !r.auth)
      if (nonAuthRoutes.length > 0) {
        const nonAuthResults = await captureRouteBatch(context, viewport.name, nonAuthRoutes)
        results.push(...nonAuthResults)
      }

      const authRoutes = routes.filter((r) => r.auth)
      if (authRoutes.length > 0) {
        await login(context)
        const authResults = await captureRouteBatch(context, viewport.name, authRoutes)
        results.push(...authResults)
      }

      await context.close()
    }
  } finally {
    await browser.close()
    await stopServer(server)
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
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
    horizontalOverflows,
    clientErrors,
    routes,
    results,
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
}

async function prepareDatabase(captureDbUrl: string) {
  assertSafeDestructiveDatabase({
    databaseUrl: captureDbUrl,
    allowDestructiveReset: process.env.CAPTURE_ALLOW_DESTRUCTIVE_RESET === "true",
    context: "CAPTURE",
  })
  await ensureDatabaseExists(captureDbUrl)

  // Reset Postgres schema and re-run migrations for a clean state
  const setupClient = postgres(captureDbUrl, { max: 1 })
  const setupDb = drizzle(setupClient)
  await setupDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
  await setupDb.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
  await setupDb.execute(sql`CREATE SCHEMA public`)
  await setupDb.execute(sql`GRANT ALL ON SCHEMA public TO PUBLIC`)
  await setupClient.end()

  const migrationClient = postgres(captureDbUrl, { max: 1 })
  await migrate(drizzle(migrationClient), { migrationsFolder: path.join(root, "db", "migrations") })
  await migrationClient.end()

  const pgClient = postgres(captureDbUrl, { max: 1 })
  const db = drizzle(pgClient, { schema })

  const now = new Date("2026-06-09T12:00:00.000Z").toISOString()
  const password = await bcrypt.hash("chome2026", 10)
  const userId = "user-audit-admin"
  const worksiteId = "ws-audit-1"
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
    "rol-jefa": ["requests:view_all", "approvals:approve", "purchasing:view", "purchasing:create_order", "purchasing:send_order", "receiving:view", "reports:view", "analytics:view", "analytics:export", "flota:view", "mantenciones:view", "mantenciones:create", "repuestos:view_all", "repuestos:approve", "servicios:view_all", "servicios:approve"],
    "rol-prevencion": ["requests:create", "requests:view_own", "requests:submit", "repuestos:create", "repuestos:view_own", "repuestos:submit", "servicios:create", "servicios:view_own", "servicios:submit", "sst:view", "sst:create", "sst:close", "sst:manage"],
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
  ])
  await db.insert(schema.worksiteUsers).values([
    { userId, worksiteId, isPrimary: true },
    { userId, worksiteId: "ws-audit-2", isPrimary: false },
    { userId: "user-audit-jefa", worksiteId, isPrimary: true },
    { userId: "user-audit-prevencion", worksiteId, isPrimary: true },
    { userId: "user-audit-bodega", worksiteId, isPrimary: true },
    { userId: "user-audit-inactive", worksiteId: "ws-audit-2", isPrimary: true },
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
  ])
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
  await db.insert(schema.productSuppliers).values([
    { id: "prod-sup-audit-1", productId, supplierId, unitPrice: 11900, isPreferred: true, lastUpdated: now },
    { id: "prod-sup-audit-2", productId: "prod-audit-2", supplierId: "sup-audit-2", unitPrice: 7900, isPreferred: true, lastUpdated: now },
    { id: "prod-sup-audit-3", productId: deliverableProductId, supplierId, unitPrice: 20500, isPreferred: true, lastUpdated: now },
    { id: "prod-sup-audit-4", productId: "prod-audit-4", supplierId: "sup-audit-3", unitPrice: 118000, isPreferred: true, lastUpdated: now },
  ])

  await db.insert(schema.workers).values([
    { id: "worker-audit-1", rut: "18.111.222-3", firstName: "Daniela", lastName: "Fuentes", position: "Operadora", worksiteId, isActive: true, createdAt: now },
    { id: "worker-audit-2", rut: "17.444.555-6", firstName: "Marco", lastName: "Silva", position: "Mecánico", worksiteId, isActive: true, createdAt: now },
    { id: "worker-audit-3", rut: "16.777.888-9", firstName: "Paula", lastName: "Mella", position: "Supervisora", worksiteId: "ws-audit-2", isActive: true, createdAt: now },
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

  await db.insert(schema.sstActionPlan).values([
    {
      id: "sst-action-audit-1",
      evaluationId: "sst-audit-1",
      n: 1,
      hallazgo: "Falta EPP en sector norte",
      accion: "Entregar kit completo al trabajador",
      responsable: "Jefe de faena",
      plazo: "2026-06-15",
      estado: "completado",
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
      publicToken: "capture-ppa-token",
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
      status: "partially_received",
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
    END;
    $$
  `)

  await pgClient.end()
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

async function startServer(captureDbUrl: string) {
  const captureUrl = new URL(captureDbUrl)
  const socketHost = captureUrl.hostname ? undefined : (process.env.PGHOST ?? "/var/run/postgresql")
  const env = {
    ...process.env,
    DATABASE_URL: captureDbUrl,
    ...(socketHost ? {
      PGHOST: socketHost,
      PGUSER: process.env.PGUSER ?? process.env.USER ?? "postgres",
    } : {}),
    AUTH_SECRET: authSecret,
    NEXTAUTH_SECRET: authSecret,
    AUTH_URL: baseUrl,
    APP_URL: baseUrl,
    NEXTAUTH_URL: baseUrl,
    PORT: String(port),
    SMTP_HOST: "",
    SMTP_USER: "",
    SMTP_PASS: "",
    SMTP_FROM: "",
    SMTP_DISABLED: "true",
    SMTP_TIMEOUT_MS: "1000",
  }
  const standaloneServer = path.join(root, ".next", "standalone", "server.js")
  const hasProductionBuild = fs.existsSync(path.join(root, ".next", "BUILD_ID"))
  const useStandalone = fs.existsSync(standaloneServer)
  if (useStandalone) {
    const standaloneStatic = path.join(root, ".next", "standalone", ".next", "static")
    if (!fs.existsSync(standaloneStatic)) {
      fs.mkdirSync(path.dirname(standaloneStatic), { recursive: true })
      fs.cpSync(path.join(root, ".next", "static"), standaloneStatic, { recursive: true })
    }
    fs.cpSync(path.join(root, "public"), path.join(root, ".next", "standalone", "public"), { recursive: true, force: true })
  }
  const command = useStandalone ? process.execPath : path.join(root, "node_modules", ".bin", "next")
  const args = useStandalone
    ? [standaloneServer]
    : hasProductionBuild
      ? ["start", "--hostname", "127.0.0.1", "--port", String(port)]
      : ["dev", "--hostname", "127.0.0.1", "--port", String(port)]
  const server = spawn(command, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })

  server.stdout.on("data", (chunk) => process.stdout.write(`[next] ${chunk}`))
  server.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`))

  await waitForServer(server)
  return server
}

async function waitForServer(server: ChildProcess) {
  const deadline = Date.now() + 120_000
  let lastError = ""
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Next server exited early with code ${server.exitCode}`)
    }
    try {
      const response = await fetch(`${baseUrl}/login`, { redirect: "manual" })
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

async function login(context: BrowserContext) {
  const page = await context.newPage()
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" })
  await page.getByLabel("Correo electrónico").fill("admin.audit@chome.cl")
  await page.getByLabel("Contraseña").fill("chome2026")
  await page.getByRole("button", { name: "Ingresar" }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
  await page.close()
}

async function captureRoute(context: BrowserContext, viewport: string, route: RouteTarget): Promise<CaptureResult[]> {
  const requestedUrl = `${baseUrl}${route.path}`
  const screenshot = path.join(outputDir, `${viewport}-${route.slug}.png`)
  const relativeScreenshot = path.relative(root, screenshot)
  const results: CaptureResult[] = []

  const maxRetries = 2
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const page = await context.newPage()
    const pageErrors: string[] = []
    page.on("pageerror", (err) => pageErrors.push(`[pageerror] ${err.message}`))
    page.on("console", (msg) => {
      if (msg.type() !== "error") return
      const text = msg.text()
      // Ruido conocido que no indica un fallo de la página: la CSP del entorno
      // de capturas bloquea la telemetría de Sentry, que es lo esperado.
      if (/favicon|Failed to load resource|net::ERR_/i.test(text)) return
      if (/sentry\.io|Content Security Policy/i.test(text)) return
      pageErrors.push(`[console] ${text}`)
    })

    try {
      const response = await page.goto(requestedUrl, { waitUntil: "domcontentloaded", timeout: 45_000 })
      await settle(page)
      await page.screenshot({ path: screenshot, fullPage: true })
      const status = response?.status() ?? null
      const finalUrl = page.url()
      const mainOk = isExpectedStatus(status, route, finalUrl)

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
        screenshot: relativeScreenshot,
        notes: route.notes,
      })

      if (mainOk && route.modals && route.modals.length > 0) {
        for (const modal of route.modals) {
          try {
            const trigger = page.locator(modal.triggerSelector).first()
            if (await trigger.isVisible({ timeout: 2000 }).catch(() => false)) {
              await trigger.click({ force: true })
              const modalSelector = modal.waitForSelector ?? '[role="dialog"], [role="alertdialog"], [data-state="open"], [data-radix-portal]'
              await page.waitForSelector(modalSelector, { state: "visible", timeout: 4000 }).catch(() => undefined)
              await page.waitForTimeout(400)

              const modalScreenshot = path.join(outputDir, `${viewport}-${route.slug}-modal-${modal.slug}.png`)
              await page.screenshot({ path: modalScreenshot, fullPage: true })

              results.push({
                viewport,
                slug: `${route.slug}-modal-${modal.slug}`,
                path: route.path,
                requestedUrl,
                finalUrl: page.url(),
                status,
                ok: true,
                screenshot: path.relative(root, modalScreenshot),
                notes: modal.notes ?? `Modal/Sheet: ${modal.slug}`,
              })

              await page.keyboard.press("Escape").catch(() => undefined)
              await page.waitForTimeout(300)
            }
          } catch (modalErr) {
            // No es fatal —la captura principal ya salió—, pero tragárselo en
            // silencio hacía que un disparador de modal roto pareciera éxito.
            const reason = modalErr instanceof Error ? modalErr.message : String(modalErr)
            console.warn(`  ⚠ modal "${modal.slug}" en ${viewport} ${route.slug}: ${reason}`)
          }
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
        screenshot: relativeScreenshot,
        error: errorMsg,
        notes: route.notes,
      }]
    }
  }

  throw new Error("Unexpected exit from retry loop")
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined)
  await page.waitForTimeout(500)
}

function isExpectedStatus(status: number | null, route: RouteTarget, finalUrl?: string) {
  if (route.expectedStatus !== undefined) {
    if (status === route.expectedStatus) return true
    if (route.expectedStatus === 404 && (status === 404 || status === 200 || finalUrl?.endsWith("/forbidden") || finalUrl?.includes("not-found"))) return true
    return false
  }
  return !status || status < 400
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
