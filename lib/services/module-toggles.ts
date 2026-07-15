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
 *   When disabled, even admins won't see it in the nav (until re-enabled).
 */

import { db } from "@/db"
import { systemSettings } from "@/db/schema"
import { eq, like } from "drizzle-orm"
import { registry } from "@/modules/registry"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"

// ── Key helpers ──────────────────────────────────────────────────────────────

const MODULE_PREFIX = "module.enabled"
const SUBMODULE_PREFIX = "submodule.enabled"

function moduleKey(id: string): string {
  return `${MODULE_PREFIX}:${id}`
}

function submoduleKey(moduleId: string, submoduleHref: string): string {
  return `${SUBMODULE_PREFIX}:${moduleId}:${submoduleHref}`
}

// ── Module-to-area label map (evita importar de components/ en lib/) ─────────

/** ID de módulo → label legible. Se deriva del catálogo de áreas. */
const MODULE_LABELS: Record<string, string> = {
  admin:           "Administración",
  requests:        "Adquisiciones",
  approvals:       "Adquisiciones",
  purchasing:      "Adquisiciones",
  receiving:       "Adquisiciones",
  warehouse:       "Bodega",
  deliveries:      "Bodega",
  traceability:    "Bodega",
  reports:         "Reportes",
  analytics:       "Reportes",
  repuestos:       "Adquisiciones",
  servicios:       "Adquisiciones",
  sst:             "Prevención",
  ppa:             "Prevención",
  feedback:        "Soporte",
  combustibles:    "Control operacional",
  flota:           "Control operacional",
  mantenciones:    "Control operacional",
  prevention:      "Prevención",
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
    return true
  }
}

/** Get the set of module IDs that are currently enabled (batched). */
export async function getEnabledModuleIds(): Promise<Set<string>> {
  try {
    const rows = await db.query.systemSettings.findMany({
      where: like(systemSettings.key, `${MODULE_PREFIX}:%`),
    })

    const modIds = getModuleEntries().map((m) => m.id)
    const enabled = new Set<string>(modIds)
    for (const row of rows) {
      if (row.value === "false") {
        enabled.delete(row.key.replace(`${MODULE_PREFIX}:`, ""))
      }
    }
    return enabled
  } catch (err) {
    logger.error("[module-toggles] Error reading enabled module IDs:", err)
    return new Set(getModuleEntries().map((m) => m.id))
  }
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
