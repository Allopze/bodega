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
import { PERMISSION_TARGET_OVERRIDES, ROUTE_OWNER_ALIASES, type RouteOwnerRule } from "./module-toggles-routes"

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

interface ToggleableNavItem {
  label?: string
  href: string
  permissions?: readonly string[]
  children?: ToggleableNavItem[]
  aliases?: readonly string[]
}

/**
 * Entradas del menú que son submódulo con interruptor propio: cada ítem de
 * primer nivel y, además, cada hijo que vive en otro árbol de rutas que su
 * padre. "Plan de emergencia" (`/prevencion/emergencias`) cuelga de GRD en el
 * menú desde el 2026-09-28 pero sigue siendo su propio submódulo; "Mapa de
 * riesgos" (`/prevencion/cgrd/mapa`) está bajo el prefijo del padre y lo
 * gobierna el interruptor de GRD, como antes.
 */
export function toggleableNavItems<T extends ToggleableNavItem>(items: readonly T[]): T[] {
  return items.flatMap((item) => [
    item,
    ...((item.children ?? []) as T[]).filter((child) =>
      child.href !== item.href && !child.href.startsWith(`${item.href}/`)),
  ])
}

const NAV_ROUTE_TARGETS = (registry as readonly {
  id: string
  nav?: Array<{ items: ToggleableNavItem[] }>
}[]).flatMap((module) => (module.nav ?? []).flatMap((section) =>
  toggleableNavItems(section.items).flatMap((item) => [item.href, ...(item.aliases ?? [])].map((prefix) => ({
    moduleId: module.id,
    // Un alias (`/combustibles/control/revision` de «Revisión») lo gobierna el
    // interruptor del ítem al que pertenece en el menú, no el de su árbol de rutas.
    submoduleHref: item.href,
    prefix,
    permissions: item.permissions ?? [],
  }))),
))


const ROUTE_TARGETS: RouteOwnerRule[] = [
  ...ROUTE_OWNER_ALIASES,
  ...NAV_ROUTE_TARGETS,
].sort((left, right) => (right.prefix?.length ?? 0) - (left.prefix?.length ?? 0))

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
  mantencion_equipos: "Mantención de equipos",
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
    const navItems = mod.nav?.flatMap((section) => toggleableNavItems(section.items)) ?? []

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
