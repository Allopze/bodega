/**
 * lib/apps/catalog.ts — Catálogo de módulos con pantalla propia, para el lanzador
 * de apps (⊞) de la barra superior.
 *
 * Una app es un módulo del registry con pantalla propia. Este archivo es puro
 * (sin base de datos) y responde lo que el registry no contesta: por dónde se
 * entra a la app, con qué ícono se la reconoce y en qué área del menú está.
 */
import { registry } from "@/modules/registry"
import { AREAS } from "@/components/layout/areas"
import { getModuleLabel } from "@/lib/module-labels"

export interface AppDef {
  /** id del módulo en el registry. */
  id:        string
  label:     string
  /** Ruta de entrada: la primera pantalla de la app. */
  href:      string
  iconName:  string
  areaId:    string
  areaLabel: string
  /** Orden del área en el menú, para que las listas salgan en el mismo orden. */
  areaOrder: number
}

interface AppMeta {
  href:     string
  iconName: string
  /** Área de la app cuando el manifest no declara menú (Administración). */
  areaId?:  string
}

/**
 * Entrada e ícono de cada app. Servicios no está: no tiene pantalla, se crea y
 * se gestiona dentro de Solicitudes, y su actividad se cuenta ahí.
 */
const APP_META: Record<string, AppMeta> = {
  operations:         { href: "/pendientes",            iconName: "CheckSquare" },
  requests:           { href: "/solicitudes",           iconName: "ClipboardText" },
  approvals:          { href: "/aprobaciones",          iconName: "ListChecks" },
  purchasing:         { href: "/compras",               iconName: "ShoppingCart" },
  receiving:          { href: "/recepcion",             iconName: "Package" },
  flota:              { href: "/flota",                 iconName: "Car" },
  mantencion_equipos: { href: "/mantencion/panel",      iconName: "Wrench" },
  repuestos:          { href: "/mantencion/repuestos",  iconName: "Toolbox" },
  combustibles:       { href: "/combustibles",          iconName: "GasPump" },
  warehouse:          { href: "/bodega",                iconName: "Warehouse" },
  deliveries:         { href: "/entregas",              iconName: "HardHat" },
  billing:            { href: "/facturacion",           iconName: "Receipt" },
  reports:            { href: "/reportes",              iconName: "ChartBar" },
  analytics:          { href: "/analitica",             iconName: "ChartLineUp" },
  prevention:         { href: "/prevencion",            iconName: "ShieldCheck" },
  sst:                { href: "/prevencion/evaluaciones", iconName: "ClipboardText" },
  ppa:                { href: "/prevencion/ppa",        iconName: "FileText" },
  ti:                 { href: "/ti",                    iconName: "Desktop" },
  feedback:           { href: "/soporte",               iconName: "Lifebuoy" },
  admin:              { href: "/admin",                 iconName: "GearSix", areaId: "admin" },
}

/** Módulos del registry que no son una app propia. */
export const NON_APP_MODULES = new Set(["servicios"])

const ADMIN_AREA = { id: "admin", label: "Administración", order: 90 }

function areaOf(moduleId: string): { id: string; label: string; order: number } {
  const mod = (registry as readonly { id: string; nav?: readonly { areaId: string }[] }[])
    .find((entry) => entry.id === moduleId)
  const areaId = APP_META[moduleId]?.areaId ?? mod?.nav?.[0]?.areaId
  const area = AREAS.find((entry) => entry.id === areaId)
  return area ? { id: area.id, label: area.label, order: area.order } : ADMIN_AREA
}

/** Las apps, en el orden del menú (área, luego registro). */
export const APPS: AppDef[] = (registry as readonly { id: string }[])
  .filter((mod) => !NON_APP_MODULES.has(mod.id) && APP_META[mod.id])
  .map((mod, index) => {
    const meta = APP_META[mod.id]!
    const area = areaOf(mod.id)
    return {
      id: mod.id,
      label: getModuleLabel(mod.id),
      href: meta.href,
      iconName: meta.iconName,
      areaId: area.id,
      areaLabel: area.label,
      areaOrder: area.order * 100 + index,
    }
  })
  .sort((left, right) => left.areaOrder - right.areaOrder)

export function findApp(id: string): AppDef | undefined {
  return APPS.find((app) => app.id === id)
}

/** Ids de módulo que no tienen entrada en `APP_META` (lo vigila un test). */
export function modulesWithoutApp(): string[] {
  return (registry as readonly { id: string }[])
    .map((mod) => mod.id)
    .filter((id) => !NON_APP_MODULES.has(id) && !APP_META[id])
}
