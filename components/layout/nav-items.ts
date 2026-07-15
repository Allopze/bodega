/**
 * nav-items.ts — Árbol de navegación derivado del registry + catálogo de áreas
 *
 * Las entradas las declara cada módulo en su manifest (`{ areaId, items }`).
 * Aquí se agrupan por área (components/layout/areas.ts), se ordenan y se exponen
 * helpers para filtrar por permiso, detectar el área activa y alimentar ⌘K.
 */

import type { Session } from "next-auth"
import { registry } from "@/modules/registry"
import { AREAS } from "./areas"

export interface NavChild {
  label:        string
  href:         string
  permissions?: string[]
  roles?:       string[]
}

export interface NavItem {
  label:        string
  href:         string
  iconName:     string
  permissions?: string[]
  roles?:       string[]
  badge?:       "count"
  children?:    NavChild[]
  group?:       string
}

export interface AreaNode {
  id:       string
  label:    string
  iconName: string
  order:    number
  items:    NavItem[]
}

/** Dashboard — entrada fija del rail (icono home, sin panel). */
export const DASHBOARD_ITEM = {
  label:    "Dashboard",
  href:     "/dashboard",
  iconName: "SquaresFour",
} as const

/** Árbol completo de áreas (sin filtrar), derivado del registry una sola vez. */
function buildAreaTree(): AreaNode[] {
  const itemsByArea = new Map<string, NavItem[]>()
  for (const mod of registry) {
    if (!mod.nav) continue
    for (const entry of mod.nav) {
      const list = itemsByArea.get(entry.areaId) ?? []
      list.push(...(entry.items as NavItem[]))
      itemsByArea.set(entry.areaId, list)
    }
  }
  return [...AREAS]
    .sort((a, b) => a.order - b.order)
    .map((area) => ({ ...area, items: itemsByArea.get(area.id) ?? [] }))
    .filter((area) => area.items.length > 0)
}

export const AREA_TREE: AreaNode[] = buildAreaTree()

// ── Module toggle support ──────────────────────────────────────────────────

/**
 * Build a reverse map: NavItem href → module id.
 * Used to filter out nav items whose module is disabled via feature toggles.
 */
const HREF_TO_MODULE = new Map<string, string>(
  (registry as readonly { id: string; nav?: { areaId: string; items: { href: string; label: string }[] }[] }[])
    .flatMap((mod) => {
      if (!mod.nav) return []
      return mod.nav.flatMap((section) => section.items.map((item) => [item.href, mod.id] as [string, string]))
    }),
)

/** ANY-of permisos/roles concede visibilidad; sin restricción = visible. */
export function canSeeNav(entry: { permissions?: string[]; roles?: string[] }, session: Session): boolean {
  if (!entry.permissions && !entry.roles) return true
  const perms = session.user.permissions ?? []
  const roles = session.user.roles ?? []
  if (entry.roles?.some((r) => roles.includes(r))) return true
  if (entry.permissions?.some((p) => perms.includes(p))) return true
  return false
}

/**
 * Áreas visibles para la sesión, con ítems y submenús filtrados por permiso
 * y —opcionalmente— por módulos habilitados (feature toggles).
 *
 * @param enabledModuleIds Si se provee, oculta ítems de módulos deshabilitados.
 */
export function getVisibleAreas(session: Session, enabledModuleIds?: Set<string>): AreaNode[] {
  return AREA_TREE
    .map((area) => ({
      ...area,
      items: area.items
        .filter((item) => canSeeNav(item, session))
        .filter((item) => {
          if (!enabledModuleIds) return true
          const moduleId = HREF_TO_MODULE.get(item.href)
          // Si el ítem no pertenece a ningún módulo conocido, mostrarlo
          if (!moduleId) return true
          return enabledModuleIds.has(moduleId)
        })
        .map((item) => ({
          ...item,
          children: item.children?.filter((child) => canSeeNav(child, session)),
        })),
    }))
    .filter((area) => area.items.length > 0)
}

export function isHrefActive(href: string, pathname: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard"
  if (href === "/prevencion") {
    const preventionSubmodulePrefixes = [
      "/prevencion/documentacion",
      "/prevencion/pdtp",
      "/prevencion/ppa",
    ]
    if (preventionSubmodulePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      return false
    }
  }
  // Excluir rutas hijas que son ítems de navegación independientes
  if (href === "/prevencion/pdtp" && pathname.startsWith("/prevencion/pdtp/acciones")) {
    return false
  }
  return pathname === href || pathname.startsWith(href + "/")
}
const matchesHref = isHrefActive

/** id del área que contiene el route activo (o null si ninguna). */
export function findActiveArea(areas: AreaNode[], pathname: string): string | null {
  for (const area of areas) {
    for (const item of area.items) {
      if (matchesHref(item.href, pathname)) return area.id
      if (item.children?.some((child) => matchesHref(child.href, pathname))) return area.id
    }
  }
  return null
}

/** Breadcrumb {área, ítem} del route activo, para la top bar. */
export function findActiveBreadcrumb(pathname: string): { areaLabel: string; itemLabel: string } | null {
  for (const area of AREA_TREE) {
    for (const item of area.items) {
      if (matchesHref(item.href, pathname)) return { areaLabel: area.label, itemLabel: item.label }
      const child = item.children?.find((c) => matchesHref(c.href, pathname))
      if (child) return { areaLabel: area.label, itemLabel: child.label }
    }
  }
  return null
}

export interface NavTarget {
  label:     string
  href:      string
  areaLabel: string
  iconName:  string
}

/** Lista plana de destinos navegables para la paleta ⌘K (filtrada por permiso y toggles). */
export function flattenNavTargets(session: Session, enabledModuleIds?: Set<string>): NavTarget[] {
  const targets: NavTarget[] = [
    { label: DASHBOARD_ITEM.label, href: DASHBOARD_ITEM.href, areaLabel: "Principal", iconName: DASHBOARD_ITEM.iconName },
  ]
  for (const area of getVisibleAreas(session, enabledModuleIds)) {
    for (const item of area.items) {
      targets.push({ label: item.label, href: item.href, areaLabel: area.label, iconName: item.iconName })
      for (const child of item.children ?? []) {
        targets.push({ label: child.label, href: child.href, areaLabel: area.label, iconName: item.iconName })
      }
    }
  }
  return targets
}
