/**
 * lib/apps/launcher.ts — Qué apps ve cada persona en el lanzador ⊞ de la barra superior.
 *
 * Puro y apto para el cliente (lo usa la TopBar). Una app aparece cuando la
 * persona puede ver al menos una pantalla suya en el menú, con las mismas reglas
 * que el sidebar: permisos/roles (`canSeeNav`), módulo encendido y submódulo
 * encendido. La entrada es la primera de esas pantallas, no la portada fija del
 * catálogo: quien sólo registra cargas de combustible entra a «Cargas», no al
 * Panel que no puede abrir. Esto es navegación, no autorización: cada página
 * sigue validando su permiso en el servidor.
 */
import type { Session } from "next-auth"
import { registry } from "@/modules/registry"
import { canSeeNav } from "@/components/layout/nav-items"
import { getAdminAreas } from "@/components/layout/admin-nav"
import { APPS, type AppDef } from "./catalog"

export interface LauncherApp {
  id:        string
  label:     string
  href:      string
  iconName:  string
  areaId:    string
  areaLabel: string
}

export interface LauncherGroup {
  areaId:    string
  areaLabel: string
  apps:      LauncherApp[]
}

interface ManifestNavItem {
  href: string
  permissions?: readonly string[]
  roles?: readonly string[]
  children?: ManifestNavItem[]
}

const MODULE_NAV = new Map(
  (registry as readonly { id: string; nav?: readonly { items: readonly ManifestNavItem[] }[] }[])
    .map((mod) => [mod.id, (mod.nav ?? []).flatMap((section) => section.items)] as const),
)

/** Un contenedor sin permisos propios (p. ej. «Configuración») vale por sus hijos. */
function visibleEntries(items: readonly ManifestNavItem[], session: Session, disabled?: Set<string>): string[] {
  return items.flatMap((item) => {
    if (disabled?.has(item.href)) return []
    const children = item.children ?? []
    if (children.length > 0 && (item.permissions?.length ?? 0) === 0 && (item.roles?.length ?? 0) === 0) {
      return visibleEntries(children, session, disabled)
    }
    const entry = { permissions: item.permissions ? [...item.permissions] : undefined, roles: item.roles ? [...item.roles] : undefined }
    return canSeeNav(entry, session) ? [item.href] : []
  })
}

function entryFor(app: AppDef, session: Session, disabled?: Set<string>): string | null {
  if (app.id === "admin") return getAdminAreas(session).length > 0 ? app.href : null
  const hrefs = visibleEntries(MODULE_NAV.get(app.id) ?? [], session, disabled)
  if (hrefs.length === 0) return null
  // La portada del catálogo si la persona la ve; si no, su primera pantalla visible.
  return hrefs.includes(app.href) ? app.href : hrefs[0]!
}

export function getLauncherApps(
  session: Session,
  enabledModuleIds?: Set<string>,
  disabledSubmoduleHrefs?: Set<string>,
): LauncherApp[] {
  return APPS.flatMap((app) => {
    if (enabledModuleIds && !enabledModuleIds.has(app.id)) return []
    const href = entryFor(app, session, disabledSubmoduleHrefs)
    return href ? [{ id: app.id, label: app.label, href, iconName: app.iconName, areaId: app.areaId, areaLabel: app.areaLabel }] : []
  })
}

export const OTHER_APPS_GROUP = { areaId: "otras", areaLabel: "Otras apps" } as const

/**
 * Las apps agrupadas por área, en el orden del menú. Un área cuya única app se
 * llama igual que ella (TI, Soporte, Administración) no gana un rótulo propio:
 * «TI» sobre un ícono «TI» se lee dos veces. Esas van juntas al final.
 */
export function groupLauncherApps(apps: LauncherApp[]): LauncherGroup[] {
  const groups: LauncherGroup[] = []
  for (const app of apps) {
    const last = groups.at(-1)
    if (last && last.areaId === app.areaId) last.apps.push(app)
    else groups.push({ areaId: app.areaId, areaLabel: app.areaLabel, apps: [app] })
  }
  const named = groups.filter((group) => !(group.apps.length === 1 && group.apps[0]!.label === group.areaLabel))
  const others = groups.filter((group) => !named.includes(group)).flatMap((group) => group.apps)
  return others.length > 0 ? [...named, { ...OTHER_APPS_GROUP, apps: others }] : named
}
