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

/** Inicio — entrada fija del rail (icono home, sin panel). */
export const DASHBOARD_ITEM = {
  label:    "Inicio",
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
  const areas: AreaNode[] = []
  for (const area of [...AREAS].sort((left, right) => left.order - right.order)) {
    const items = itemsByArea.get(area.id) ?? []
    if (items.length > 0) areas.push({ ...area, items })
  }
  return areas
}

export const AREA_TREE: AreaNode[] = buildAreaTree()

/**
 * Destinos que el sidebar puede seleccionar, incluidos los enlaces de ramas.
 * Cuando dos destinos comparten prefijo, la ruta pertenece al más específico.
 * Así `/combustibles/importar` no deja activo también `/combustibles`.
 */
const REGISTERED_NAV_HREFS = new Set(
  AREA_TREE.flatMap((area) => area.items.flatMap((item) => [
    item.href,
    ...(item.children?.map((child) => child.href) ?? []),
  ])),
)

function pathBelongsToHref(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

function withoutSearchOrHash(pathname: string): string {
  return pathname.split(/[?#]/, 1)[0] || "/"
}

function findMostSpecificRegisteredNavHref(pathname: string): string | null {
  let match: string | null = null
  for (const href of REGISTERED_NAV_HREFS) {
    if (pathBelongsToHref(pathname, href) && (match === null || href.length > match.length)) {
      match = href
    }
  }
  return match
}

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
  const permissions = new Set(session.user.permissions ?? [])
  const roles = new Set(session.user.roles ?? [])
  if (entry.roles?.some((role) => roles.has(role))) return true
  if (entry.permissions?.some((permission) => permissions.has(permission))) return true
  return false
}

/**
 * Áreas visibles para la sesión, con ítems y submenús filtrados por permiso
 * y —opcionalmente— por módulos habilitados (feature toggles).
 *
 * @param enabledModuleIds Si se provee, oculta ítems de módulos deshabilitados.
 */
export function getVisibleAreas(session: Session, enabledModuleIds?: Set<string>): AreaNode[] {
  const areas: AreaNode[] = []
  for (const area of AREA_TREE) {
    const items: NavItem[] = []
    for (const item of area.items) {
      if (!canSeeNav(item, session)) continue
      const moduleId = HREF_TO_MODULE.get(item.href)
      if (enabledModuleIds && moduleId && !enabledModuleIds.has(moduleId)) continue

      items.push({
        ...item,
        children: item.children?.filter((child) => canSeeNav(child, session)),
      })
    }

    if (items.length === 0) continue
    areas.push({
      ...area,
      items,
    })
  }
  return areas
}

export function isHrefActive(href: string, pathname: string): boolean {
  const currentPathname = withoutSearchOrHash(pathname)
  if (href === "/dashboard") return currentPathname === "/dashboard"
  const mostSpecificNavHref = findMostSpecificRegisteredNavHref(currentPathname)

  if (href === "/prevencion/evaluaciones") {
    if (currentPathname === href) return true
    if (currentPathname === "/prevencion/nueva" || currentPathname.startsWith("/prevencion/trabajador/")) return true
    if (currentPathname.startsWith("/prevencion/")) {
      return mostSpecificNavHref === null || mostSpecificNavHref === href
    }
  }

  if (!pathBelongsToHref(currentPathname, href)) return false
  return mostSpecificNavHref === null || mostSpecificNavHref === href
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
