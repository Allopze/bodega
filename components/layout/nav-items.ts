/**
 * nav-items.ts — Navegación derivada del registry de módulos
 *
 * Las secciones de nav las declara cada módulo en su manifest.
 * Este archivo agrega la entrada fija "Dashboard" y concatena el resto.
 */

import { registry } from "@/modules/registry"

export interface NavItem {
  label:        string
  href:         string
  iconName:     string          // Phosphor icon name
  permissions?: string[]        // ANY of these grants access; empty = public-within-auth
  roles?:       string[]        // OR check: ANY of these roles
  badge?:       "count"
}

export interface NavSection {
  section: string
  items:   NavItem[]
}

/** Dashboard — entrada fija, visible para todos los usuarios autenticados */
const FIXED_ITEMS: NavSection[] = [
  {
    section: "Principal",
    items: [
      {
        label:    "Dashboard",
        href:     "/dashboard",
        iconName: "SquaresFour",
      },
    ],
  },
]

/**
 * Merge de las secciones nav de todos los módulos registrados.
 * Si dos módulos declaran la misma sección (ej: "Operaciones"), sus items
 * se unen en esa sección según el orden de registro.
 */
function buildNavFromRegistry(): NavSection[] {
  const sectionMap = new Map<string, NavItem[]>()

  for (const mod of registry) {
    if (!mod.nav) continue
    for (const section of mod.nav) {
      const existing = sectionMap.get(section.section)
      if (existing) {
        existing.push(...(section.items as NavItem[]))
      } else {
        sectionMap.set(section.section, [...(section.items as NavItem[])])
      }
    }
  }

  return Array.from(sectionMap.entries()).map(([section, items]) => ({
    section,
    items,
  }))
}

/** Full navigation tree — filtered per-user in the sidebar component */
export const NAV_ITEMS: NavSection[] = [
  ...FIXED_ITEMS,
  ...buildNavFromRegistry(),
]
