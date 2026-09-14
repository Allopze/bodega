/**
 * lib/services/module-toggles.ts — Feature toggle system for modules/submodules
 *
 * Uses the existing `system_settings` key-value table.
 * Each module has a key `module.enabled:{moduleId}` with value "true" or "false".
 * Missing keys default to "true" (module is enabled).
 *
 * The toggle operates *on top of* the permissions system:
 * - Permissions control *who* can access a module.
 * - Toggles control *whether* a module is active in the system at all.
 *   When disabled, navigation, routes, actions and automation are blocked for
 *   every user until an administrator re-enables it through the recovery door.
 */

import { db } from "@/db"
import { systemSettings } from "@/db/schema"
import { eq, like } from "drizzle-orm"
import { registry } from "@/modules/registry"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { MODULE_TOGGLE_RECOVERY_PATH } from "@/lib/module-toggle-path"

// ── Key helpers ──────────────────────────────────────────────────────────────

const MODULE_PREFIX = "module.enabled"
const SUBMODULE_PREFIX = "submodule.enabled"
/** Puerta de recuperación: debe seguir accesible aun si Administración quedó apagado. */
export { MODULE_TOGGLE_RECOVERY_PATH } from "@/lib/module-toggle-path"

function moduleKey(id: string): string {
  return `${MODULE_PREFIX}:${id}`
}

function submoduleKey(moduleId: string, submoduleHref: string): string {
  return `${SUBMODULE_PREFIX}:${moduleId}:${submoduleHref}`
}

const PERMISSION_TO_MODULE = new Map<string, string>(
  (registry as readonly { id: string; permissions: readonly string[] }[])
    .flatMap((module) => module.permissions.map((permission) => [permission, module.id] as const)),
)

const NAV_ROUTE_TARGETS = (registry as readonly {
  id: string
  nav?: Array<{ items: Array<{ href: string; permissions?: readonly string[] }> }>
}[]).flatMap((module) => (module.nav ?? []).flatMap((section) =>
  section.items.map((item) => ({
    moduleId: module.id,
    submoduleHref: item.href,
    prefix: item.href,
    permissions: item.permissions ?? [],
  })),
))

interface RouteOwnerRule {
  moduleId: string
  /** href canónico que administra el toggle de submódulo. */
  submoduleHref?: string
  prefix?: string
  pattern?: RegExp
}

/**
 * Rutas operativas que no aparecen literalmente en navegación. Mantener este
 * inventario junto a las regresiones de cobertura: el menú no es un mapa de
 * autorización y los endpoints/jobs tampoco deberían depender de él.
 */
const ROUTE_OWNER_ALIASES: RouteOwnerRule[] = [
  // Administración no declara navegación en su manifest; toda su superficie
  // comparte un único toggle, salvo la puerta de recuperación exacta.
  { moduleId: "admin", submoduleHref: "/admin", prefix: "/admin" },

  // Evaluaciones SST: alta, detalle y ficha de trabajador son aliases del item.
  { moduleId: "sst", submoduleHref: "/prevencion/evaluaciones", prefix: "/prevencion/nueva" },
  { moduleId: "sst", submoduleHref: "/prevencion/evaluaciones", prefix: "/sst" },
  { moduleId: "sst", submoduleHref: "/prevencion/evaluaciones", prefix: "/prevencion/trabajador" },
  { moduleId: "sst", submoduleHref: "/prevencion/evaluaciones", pattern: /^\/prevencion\/[^/]+$/ },

  // Superficies públicas (PWA sin sesión) y APIs autenticadas/públicas.
  { moduleId: "ppa", submoduleHref: "/prevencion/ppa", prefix: "/ppa" },
  // INC-001: canal público de reporte de incidentes (sin sesión), gobernado
  // por el mismo toggle que el módulo de Incidentes que lo tría.
  { moduleId: "prevention", submoduleHref: "/prevencion/incidentes", prefix: "/reportar-incidente" },
  // CAP-002/PER-002: vía de acuse sin cuenta. Cada rama pertenece al submódulo
  // que emite el acuse, para que apagar Capacitación o Permisos también cierre
  // su enlace público y no queden puertas fuera del inventario.
  { moduleId: "prevention", submoduleHref: "/prevencion/capacitacion", prefix: "/acuse/capacitacion" },
  { moduleId: "prevention", submoduleHref: "/prevencion/permisos", prefix: "/acuse/permiso" },
  // Fallback del segmento dinámico `/acuse/[kind]/...`: cualquier rama que no
  // sea una de las dos anteriores pertenece igualmente a Prevención y nunca
  // debe quedar fuera del inventario.
  { moduleId: "prevention", prefix: "/acuse" },
  { moduleId: "combustibles", submoduleHref: "/combustibles/tae", prefix: "/tae" },
  { moduleId: "combustibles", submoduleHref: "/combustibles/tae", prefix: "/api/tae" },
  { moduleId: "combustibles", submoduleHref: "/combustibles/importar", prefix: "/api/combustibles/import" },
  { moduleId: "flota", submoduleHref: "/flota", prefix: "/api/flota" },
  { moduleId: "mantenciones", submoduleHref: "/mantenciones", prefix: "/api/mantenciones" },
  { moduleId: "warehouse", submoduleHref: "/bodega", prefix: "/api/bodega" },
  { moduleId: "deliveries", submoduleHref: "/entregas", prefix: "/api/entregas" },
  // Módulo TI: fotos y adjuntos sirven evidencia de asignaciones/actas.
  { moduleId: "ti", submoduleHref: "/ti", prefix: "/api/ti" },
  { moduleId: "ti", submoduleHref: "/ti", prefix: "/api/cron/ti-alerts" },
  // Sirve exclusivamente evidencia de entregas (ver S-08 en el handler).
  { moduleId: "deliveries", submoduleHref: "/entregas", prefix: "/api/attachments" },
  // Las facturas tienen toggle propio. Debe ir antes del owner general de
  // Facturación para que apagar sólo Facturas también cierre su API directa.
  { moduleId: "billing", submoduleHref: "/facturacion/facturas", prefix: "/api/facturacion/facturas" },
  { moduleId: "billing", submoduleHref: "/facturacion", prefix: "/api/facturacion" },
  { moduleId: "purchasing", submoduleHref: "/compras", prefix: "/api/purchase-orders" },
  { moduleId: "reports", submoduleHref: "/reportes", prefix: "/api/reportes" },
  { moduleId: "warehouse", submoduleHref: "/bodega/trazabilidad", prefix: "/api/bodega/trazabilidad" },
  { moduleId: "warehouse", submoduleHref: "/bodega/trazabilidad", prefix: "/api/trazabilidad" },
  // Trazabilidad se mudó bajo Bodega y `/trazabilidad/*` quedó como
  // redirección. Las páginas legadas siguen siendo superficie del módulo: sin
  // esto quedaban fuera del inventario y el toggle no las alcanzaba. El prefijo
  // de la API ya estaba; faltaba el de las páginas.
  { moduleId: "warehouse", submoduleHref: "/bodega/trazabilidad", prefix: "/trazabilidad" },
  { moduleId: "feedback", submoduleHref: "/soporte", prefix: "/api/soporte" },
  { moduleId: "repuestos", prefix: "/api/repuestos" },
  { moduleId: "servicios", prefix: "/api/servicios" },
  { moduleId: "admin", submoduleHref: "/admin", prefix: "/api/admin" },
  { moduleId: "admin", submoduleHref: "/admin", prefix: "/api/backups" },
  { moduleId: "admin", submoduleHref: "/admin", prefix: "/api/dte-portal" },

  // Endpoints de Prevención: primero los owners específicos y al final el fallback.
  { moduleId: "ppa", submoduleHref: "/prevencion/ppa", prefix: "/api/prevencion/ppa" },
  { moduleId: "prevention", submoduleHref: "/prevencion/pdtp", prefix: "/api/prevencion/pdtp" },
  { moduleId: "prevention", submoduleHref: "/prevencion/capacitacion", prefix: "/api/prevencion/capacitacion" },
  { moduleId: "prevention", submoduleHref: "/prevencion/capa", prefix: "/api/prevencion/capa" },
  { moduleId: "prevention", submoduleHref: "/prevencion/documentacion", prefix: "/api/prevencion/documentacion" },
  { moduleId: "prevention", submoduleHref: "/prevencion/documentacion", prefix: "/api/prevencion/archivos-sensibles" },
  { moduleId: "prevention", submoduleHref: "/prevencion/epp-preventivo", prefix: "/api/prevencion/epp" },
  { moduleId: "prevention", submoduleHref: "/prevencion/incidentes", prefix: "/api/prevencion/incidentes" },
  // Casos reservados es la superficie de Privacidad —igual que su override de
  // permiso—, no de Incidentes: apuntarlo a Incidentes hacía que el toggle de
  // ruta y el de permiso se contradijeran.
  { moduleId: "prevention", submoduleHref: "/prevencion/privacidad", prefix: "/api/prevencion/casos-reservados" },
  { moduleId: "prevention", submoduleHref: "/prevencion/indicadores-material-ambiental", prefix: "/api/prevencion/indicadores-material-ambiental" },
  { moduleId: "prevention", submoduleHref: "/prevencion/indicadores", prefix: "/api/prevencion/indicadores" },
  // Auditorías e inspecciones comparten estos endpoints. El owner exacto se
  // determina en el handler después de autenticar y cargar el kind real; el
  // proxy sólo aplica aquí el toggle del módulo Prevención.
  { moduleId: "prevention", prefix: "/api/prevencion/inspecciones" },
  { moduleId: "prevention", submoduleHref: "/prevencion/miper/mapa", prefix: "/api/prevencion/miper/mapa" },
  { moduleId: "prevention", submoduleHref: "/prevencion/miper", prefix: "/api/prevencion/miper" },
  { moduleId: "prevention", submoduleHref: "/prevencion/permisos", prefix: "/api/prevencion/permisos" },
  { moduleId: "prevention", submoduleHref: "/prevencion/privacidad", prefix: "/api/prevencion/privacidad" },
  { moduleId: "prevention", submoduleHref: "/prevencion/requisitos-legales", prefix: "/api/prevencion/requisitos-legales" },
  { moduleId: "prevention", submoduleHref: "/prevencion/higiene", prefix: "/api/prevencion/salud" },

  // Automatizaciones: el secreto se valida en el handler antes de consultar el toggle.
  { moduleId: "admin", submoduleHref: "/admin", prefix: "/api/cron/backup-health" },
  { moduleId: "billing", submoduleHref: "/facturacion/sincronizacion", prefix: "/api/cron/billing-sales-sync" },
  { moduleId: "billing", submoduleHref: "/facturacion/sincronizacion", prefix: "/api/cron/chipax-sync" },
  { moduleId: "admin", submoduleHref: "/admin", prefix: "/api/cron/dte-portal-sync" },
  { moduleId: "admin", submoduleHref: "/admin", prefix: "/api/cron/dte-sync-health" },
  { moduleId: "combustibles", submoduleHref: "/combustibles", prefix: "/api/cron/fuel-anomaly-detection" },
  { moduleId: "combustibles", submoduleHref: "/combustibles/importar", prefix: "/api/cron/fuel-copec-sync" },
  { moduleId: "combustibles", submoduleHref: "/combustibles/importar", prefix: "/api/cron/fuel-aramco-sync" },
  { moduleId: "combustibles", submoduleHref: "/combustibles", prefix: "/api/cron/fuel-statement-notifications" },
  { moduleId: "feedback", submoduleHref: "/soporte", prefix: "/api/cron/feedback-sla-reminders" },
  { moduleId: "flota", submoduleHref: "/flota/monitoreo", prefix: "/api/cron/fleet-onway-retention" },
  { moduleId: "flota", submoduleHref: "/flota/monitoreo", prefix: "/api/cron/fleet-onway-sync" },
  { moduleId: "mantenciones", submoduleHref: "/mantenciones", prefix: "/api/cron/maintenance-reminders" },
  // MNT-001: materializar el plan preventivo es del mismo módulo que su
  // recordatorio, y el prefijo más largo gana, así que no se pisan.
  { moduleId: "mantenciones", submoduleHref: "/mantenciones", prefix: "/api/cron/maintenance-plan-materialization" },
  { moduleId: "warehouse", submoduleHref: "/bodega/trazabilidad", prefix: "/api/cron/operational-integrity-scan" },
  // TRZ-001: el segundo libro de integridad, el que cubre entregas contra
  // recepción en faena.
  { moduleId: "warehouse", submoduleHref: "/bodega/trazabilidad", prefix: "/api/cron/traceability-integrity-scan" },
  /*
   * FLO-002, MIP-001 y PRI-001 comparten una corrida porque son el mismo
   * trabajo sobre tres tablas. Eso deja una ruta que no pertenece a un solo
   * módulo: se ancla en Prevención, que aporta dos de los tres barridos, y cada
   * barrido consulta sus propios permisos. Apagar Prevención silencia también
   * el aviso de documentos de flota — es la contrapartida de agruparlos, y se
   * anota aquí para que sea una decisión visible y no una sorpresa.
   */
  { moduleId: "prevention", submoduleHref: "/prevencion", prefix: "/api/cron/deadline-reminders" },
  { moduleId: "analytics", submoduleHref: "/analitica", prefix: "/api/cron/operational-metric-snapshots" },
  { moduleId: "analytics", submoduleHref: "/analitica", prefix: "/api/cron/operational-snapshot-health" },
  { moduleId: "prevention", submoduleHref: "/prevencion/pdtp", prefix: "/api/cron/pdtp-evidence-gc" },
  { moduleId: "prevention", submoduleHref: "/prevencion/pdtp", prefix: "/api/cron/pdtp-weekly-reminders" },
  { moduleId: "prevention", submoduleHref: "/prevencion/capa", prefix: "/api/cron/prevention-capa-reminders" },
  { moduleId: "prevention", submoduleHref: "/prevencion/cphs", prefix: "/api/cron/prevention-cphs-alerts" },
  { moduleId: "prevention", submoduleHref: "/prevencion/documentacion", prefix: "/api/cron/prevention-document-ack-reminders" },
  { moduleId: "prevention", submoduleHref: "/prevencion/incidentes", prefix: "/api/cron/prevention-incident-reminders" },
  { moduleId: "prevention", submoduleHref: "/prevencion/inspecciones", prefix: "/api/cron/prevention-inspection-programs" },
  { moduleId: "prevention", submoduleHref: "/prevencion/capacitacion", prefix: "/api/cron/prevention-training-reminders" },
  { moduleId: "sst", submoduleHref: "/prevencion/evaluaciones", prefix: "/api/cron/sst-weekly-alerts" },
]

const ROUTE_TARGETS: RouteOwnerRule[] = [
  ...ROUTE_OWNER_ALIASES,
  ...NAV_ROUTE_TARGETS,
].sort((left, right) => (right.prefix?.length ?? 0) - (left.prefix?.length ?? 0))

const PERMISSION_TARGET_OVERRIDES: Array<{ test: (permission: string) => boolean; href: string }> = [
  { test: (permission) => permission.startsWith("combustibles:tae_"), href: "/combustibles/tae" },
  { test: (permission) => permission === "combustibles:import" || permission === "combustibles:revert", href: "/combustibles/importar" },
  { test: (permission) => permission.startsWith("sst:"), href: "/prevencion/evaluaciones" },
  { test: (permission) => permission.startsWith("ppa:"), href: "/prevencion/ppa" },
  { test: (permission) => permission.startsWith("prevention:pdtp:"), href: "/prevencion/pdtp" },
  { test: (permission) => permission.startsWith("prevention:risk:"), href: "/prevencion/miper" },
  { test: (permission) => permission.startsWith("prevention:legal:"), href: "/prevencion/requisitos-legales" },
  { test: (permission) => permission.startsWith("prevention:training:"), href: "/prevencion/capacitacion" },
  { test: (permission) => permission.startsWith("prevention:capa:"), href: "/prevencion/capa" },
  { test: (permission) => permission.startsWith("prevention:incidents:"), href: "/prevencion/incidentes" },
  { test: (permission) => permission.startsWith("prevention:permits:"), href: "/prevencion/permisos" },
  { test: (permission) => permission.startsWith("prevention:cphs:"), href: "/prevencion/cphs" },
  { test: (permission) => permission.startsWith("prevention:hygiene:") || permission.startsWith("prevention:health:"), href: "/prevencion/higiene" },
  { test: (permission) => permission.startsWith("prevention:emergency:"), href: "/prevencion/emergencias" },
  { test: (permission) => permission.startsWith("prevention:change:"), href: "/prevencion/gestion-cambio" },
  { test: (permission) => permission.startsWith("prevention:epp:"), href: "/prevencion/epp-preventivo" },
  // Las campañas del programa anual se registran en el catálogo controlado;
  // el permiso legado conserva compatibilidad, pero ya no deriva al alta libre.
  { test: (permission) => permission.startsWith("prevention:campaign:"), href: "/prevencion/capacitacion" },
  { test: (permission) => permission.startsWith("prevention:engagement:"), href: "/prevencion/coordinacion" },
  { test: (permission) => permission.startsWith("prevention:docs:"), href: "/prevencion/documentacion" },
  { test: (permission) => permission.startsWith("prevention:indicadores:"), href: "/prevencion/indicadores" },
  { test: (permission) => permission.startsWith("prevention:privacy:") || permission.startsWith("prevention:reserved_case:"), href: "/prevencion/privacidad" },
]

export class ModuleDisabledError extends Error {
  constructor(public readonly moduleId: string, public readonly submoduleHref?: string) {
    super(submoduleHref
      ? `Submódulo inactivo: ${moduleId}:${submoduleHref}`
      : `Módulo inactivo: ${moduleId}`)
    this.name = "ModuleDisabledError"
  }
}

export class ModuleToggleUnavailableError extends Error {
  constructor() {
    super("No se pudo verificar el estado de los módulos")
    this.name = "ModuleToggleUnavailableError"
  }
}

export interface NavigationToggleState {
  enabledModuleIds: Set<string>
  disabledSubmoduleHrefs: Set<string>
}

function routeMatches(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function resolveModuleRoute(pathname: string) {
  const target = ROUTE_TARGETS.find((candidate) =>
    candidate.pattern?.test(pathname) || (candidate.prefix ? routeMatches(pathname, candidate.prefix) : false))
  if (!target) return null
  return { moduleId: target.moduleId, submoduleHref: target.submoduleHref }
}

function canonicalPermissionRoute(permission: string): string | undefined {
  const override = PERMISSION_TARGET_OVERRIDES.find((candidate) => candidate.test(permission))
  if (override) return override.href

  const directTargets = NAV_ROUTE_TARGETS.filter((target) => target.permissions.includes(permission))
  const distinctHrefs = [...new Set(directTargets.map((target) => target.submoduleHref))]
  if (distinctHrefs.length === 1) return distinctHrefs[0]

  const moduleId = PERMISSION_TO_MODULE.get(permission)
  if (!moduleId) return undefined
  const moduleTargets = NAV_ROUTE_TARGETS.filter((target) => target.moduleId === moduleId)
  return moduleTargets.length === 1 ? moduleTargets[0]?.submoduleHref : undefined
}

async function readNavigationToggleState(): Promise<NavigationToggleState> {
  try {
    const [moduleRows, submoduleRows] = await Promise.all([
      db.query.systemSettings.findMany({ where: like(systemSettings.key, `${MODULE_PREFIX}:%`) }),
      db.query.systemSettings.findMany({ where: like(systemSettings.key, `${SUBMODULE_PREFIX}:%`) }),
    ])
    const enabledModuleIds = new Set(getModuleEntries().map((module) => module.id))
    for (const row of moduleRows) {
      if (row.value === "false") enabledModuleIds.delete(row.key.replace(`${MODULE_PREFIX}:`, ""))
    }
    const disabledSubmoduleHrefs = new Set<string>()
    for (const row of submoduleRows) {
      if (row.value !== "false") continue
      const target = NAV_ROUTE_TARGETS.find(({ moduleId, submoduleHref }) =>
        submoduleKey(moduleId, submoduleHref) === row.key)
      if (target) disabledSubmoduleHrefs.add(target.submoduleHref)
    }
    return { enabledModuleIds, disabledSubmoduleHrefs }
  } catch (err) {
    logger.error("[module-toggles] Error reading navigation toggle state:", err)
    throw new ModuleToggleUnavailableError()
  }
}

export async function getNavigationToggleState(): Promise<NavigationToggleState> {
  return readNavigationToggleState()
}

/** Boundary helper for HTTP/public flows: a read failure must never reactivate work. */
export async function isRouteOperational(pathname: string): Promise<boolean> {
  try {
    return routeIsEnabled(pathname, await getNavigationToggleState())
  } catch {
    return false
  }
}

export function routeIsEnabled(pathname: string, state: NavigationToggleState): boolean {
  if (routeMatches(pathname, MODULE_TOGGLE_RECOVERY_PATH)) return true
  const target = resolveModuleRoute(pathname)
  if (!target) return true
  return state.enabledModuleIds.has(target.moduleId)
    && (!target.submoduleHref || !state.disabledSubmoduleHrefs.has(target.submoduleHref))
}

export async function assertRouteModuleEnabled(pathname: string): Promise<void> {
  if (routeMatches(pathname, MODULE_TOGGLE_RECOVERY_PATH)) return
  const target = resolveModuleRoute(pathname)
  if (!target) return
  const state = await getNavigationToggleState()
  if (!state.enabledModuleIds.has(target.moduleId)) throw new ModuleDisabledError(target.moduleId)
  if (target.submoduleHref && state.disabledSubmoduleHrefs.has(target.submoduleHref)) {
    throw new ModuleDisabledError(target.moduleId, target.submoduleHref)
  }
}

/** Segunda barrera para acciones/endpoints: el permiso identifica su módulo. */
export async function assertPermissionModuleEnabled(
  permission: string,
  pathname?: string,
  operationPathname?: string,
): Promise<void> {
  // Esta puerta de recuperación debe seguir disponible para volver a encender
  // un módulo desactivado accidentalmente, incluso si Administración está off.
  if (permission === "admin:module_management") return
  const moduleId = PERMISSION_TO_MODULE.get(permission)
  if (!moduleId) return
  const state = await getNavigationToggleState()
  if (!state.enabledModuleIds.has(moduleId)) throw new ModuleDisabledError(moduleId)
  const candidates = [operationPathname, canonicalPermissionRoute(permission), pathname]
  for (const candidate of candidates) {
    if (!candidate) continue
    const target = resolveModuleRoute(candidate)
    if (target?.moduleId === moduleId && target.submoduleHref && state.disabledSubmoduleHrefs.has(target.submoduleHref)) {
      throw new ModuleDisabledError(moduleId, target.submoduleHref)
    }
  }
}

// ── Nombre propio de cada módulo (evita importar de components/ en lib/) ─────

/**
 * ID de módulo → nombre propio.
 *
 * Antes esto devolvía el nombre del **área** de navegación, de modo que la
 * pantalla de módulos mostraba seis tarjetas llamadas "Adquisiciones", tres
 * "Control operacional", tres "Bodega" y tres "Prevención". Lo único que las
 * distinguía era el identificador técnico en inglés (`purchasing`,
 * `receiving`, `traceability`), justo el tipo de jerga que la auditoría
 * pide retirar del flujo estándar — y quien apagaba un módulo no podía saber
 * cuál estaba apagando. Cada módulo tiene ahora su propio nombre; el área
 * sigue disponible aparte para agrupar.
 */
const MODULE_LABELS: Record<string, string> = {
  admin:           "Administración",
  requests:        "Solicitudes",
  approvals:       "Aprobaciones",
  purchasing:      "Órdenes de compra",
  receiving:       "Recepción",
  warehouse:       "Bodega",
  deliveries:      "Entregas",
  traceability:    "Trazabilidad",
  reports:         "Reportes",
  analytics:       "Analítica",
  repuestos:       "Repuestos",
  servicios:       "Servicios",
  sst:             "Evaluaciones SST",
  ppa:             "PPA digital",
  feedback:        "Soporte",
  combustibles:    "Combustibles",
  flota:           "Flota",
  mantenciones:    "Mantenciones",
  prevention:      "Prevención",
  operations:      "Pendientes operacionales",
  billing:         "Facturación y cobranza",
}

function getModuleLabel(moduleId: string): string {
  return MODULE_LABELS[moduleId] ?? moduleId.charAt(0).toUpperCase() + moduleId.slice(1)
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface SubmoduleToggle {
  label:         string
  href:          string
  enabled:       boolean
  permissions?:  readonly string[]
}

export interface ModuleToggle {
  id:               string
  label:            string
  enabled:          boolean
  submodules:       SubmoduleToggle[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Helper: get a plain array of module entries from the registry. */
function getModuleEntries(): Array<{ id: string; nav?: Array<{ areaId: string; items: Array<{ label: string; href: string; permissions?: readonly string[] }> }> }> {
  return registry as unknown as Array<{
    id: string
    nav?: Array<{
      areaId: string
      items: Array<{ label: string; href: string; permissions?: readonly string[] }>
    }>
  }>
}

// ── Read toggles (batched) ───────────────────────────────────────────────────

/** Read a single module toggle. Defaults to `true` (enabled). */
export async function getModuleToggle(id: string): Promise<boolean> {
  try {
    const row = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, moduleKey(id)),
    })
    return row?.value !== "false"
  } catch (err) {
    logger.error(`[module-toggles] Error reading toggle for ${id}:`, err)
    throw new ModuleToggleUnavailableError()
  }
}

/** Get the set of module IDs that are currently enabled (batched). */
export async function getEnabledModuleIds(): Promise<Set<string>> {
  return (await getNavigationToggleState()).enabledModuleIds
}

/**
 * Get toggle state for all registered modules and their submodules.
 * Batched DB reads: only 2 queries total regardless of module count.
 */
export async function getAllModuleToggles(): Promise<ModuleToggle[]> {
  const modulePattern = `${MODULE_PREFIX}:%`
  const submodulePattern = `${SUBMODULE_PREFIX}:%`

  const [moduleRows, submoduleRows] = await Promise.all([
    db.query.systemSettings.findMany({
      where: like(systemSettings.key, modulePattern),
    }),
    db.query.systemSettings.findMany({
      where: like(systemSettings.key, submodulePattern),
    }),
  ])

  // Build module toggle map (default: true)
  const moduleToggleMap = new Map<string, boolean>()
  for (const row of moduleRows) {
    const id = row.key.replace(`${MODULE_PREFIX}:`, "")
    moduleToggleMap.set(id, row.value !== "false")
  }

  // Build submodule toggle map (default: true)
  const submoduleToggleMap = new Map<string, boolean>()
  for (const row of submoduleRows) {
    const rest = row.key.replace(`${SUBMODULE_PREFIX}:`, "")
    submoduleToggleMap.set(rest, row.value !== "false")
  }

  const modEntries = getModuleEntries()
  const results: ModuleToggle[] = []

  for (const mod of modEntries) {
    const navItems = mod.nav?.flatMap((section) => section.items) ?? []

    const submodules: SubmoduleToggle[] = navItems.map((item) => ({
      label:        item.label,
      href:         item.href,
      enabled:      submoduleToggleMap.get(`${mod.id}:${item.href}`) ?? true,
      permissions:  item.permissions,
    }))

    results.push({
      id:         mod.id,
      label:      getModuleLabel(mod.id),
      enabled:    moduleToggleMap.get(mod.id) ?? true,
      submodules,
    })
  }

  return results
}

// ── Write toggles ────────────────────────────────────────────────────────────

export interface ToggleResult {
  ok:      boolean
  message: string
}

/**
 * Toggle a module on/off.
 * When toggling off, all submodules are also implicitly disabled (but the
 * individual submodule records remain unchanged, so re-enabling the module
 * restores previous submodule states).
 */
export async function setModuleToggle(
  moduleId: string,
  enabled: boolean,
  actor: { userId: string; userEmail?: string },
): Promise<ToggleResult> {
  if (!getModuleEntries().some((module) => module.id === moduleId)) {
    return { ok: false, message: "Módulo no registrado" }
  }
  const now = new Date().toISOString()

  try {
    await db
      .insert(systemSettings)
      .values({ key: moduleKey(moduleId), value: String(enabled), updatedAt: now })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: String(enabled), updatedAt: now },
      })

    await recordAudit({
      userId:    actor.userId,
      userEmail: actor.userEmail,
      action:    "update",
      entityType: "module_toggle",
      entityId:   moduleId,
      newState:   { enabled },
    })

    return { ok: true, message: enabled ? "Módulo activado" : "Módulo desactivado" }
  } catch (err) {
    logger.error(`[module-toggles] Error toggling module ${moduleId}:`, err)
    return { ok: false, message: "Error al guardar el cambio" }
  }
}

/**
 * Toggle a submodule on/off.
 */
export async function setSubmoduleToggle(
  moduleId: string,
  submoduleHref: string,
  enabled: boolean,
  actor: { userId: string; userEmail?: string },
): Promise<ToggleResult> {
  if (!NAV_ROUTE_TARGETS.some((target) => target.moduleId === moduleId && target.submoduleHref === submoduleHref)) {
    return { ok: false, message: "Submódulo no registrado" }
  }
  const now = new Date().toISOString()

  try {
    await db
      .insert(systemSettings)
      .values({ key: submoduleKey(moduleId, submoduleHref), value: String(enabled), updatedAt: now })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: String(enabled), updatedAt: now },
      })

    await recordAudit({
      userId:    actor.userId,
      userEmail: actor.userEmail,
      action:    "update",
      entityType: "submodule_toggle",
      entityId:   `${moduleId}:${submoduleHref}`,
      newState:   { enabled },
    })

    return { ok: true, message: enabled ? "Submódulo activado" : "Submódulo desactivado" }
  } catch (err) {
    logger.error(`[module-toggles] Error toggling submodule ${moduleId}:${submoduleHref}:`, err)
    return { ok: false, message: "Error al guardar el cambio" }
  }
}
