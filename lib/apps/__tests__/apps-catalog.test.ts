import { describe, expect, it } from "vitest"
import { registry } from "@/modules/registry"
import { AREA_TREE } from "@/components/layout/nav-items"
import { NAV_ICONS } from "@/components/layout/nav-icons"
import { APPS, NON_APP_MODULES, modulesWithoutApp } from "../catalog"

const appIds = new Set(APPS.map((app) => app.id))

describe("catálogo de apps", () => {
  it("cada módulo del registry es una app o está declarado como no-app", () => {
    // Un módulo nuevo sin entrada en APP_META desaparecería del lanzador de apps en silencio.
    expect(modulesWithoutApp()).toEqual([])
    for (const mod of registry) {
      expect(appIds.has(mod.id) || NON_APP_MODULES.has(mod.id)).toBe(true)
    }
  })

  it("la entrada de cada app es una pantalla del menú (o la portada de su área)", () => {
    const navHrefs = new Set(AREA_TREE.flatMap((area) => area.items.flatMap((item) => [item.href, ...(item.children ?? []).map((child) => child.href)])))
    // Portadas de área que no son un ítem del menú pero sí una página.
    const areaIndexes = new Set(["/admin", "/prevencion"])
    for (const app of APPS) {
      expect(navHrefs.has(app.href) || areaIndexes.has(app.href), `${app.id} → ${app.href}`).toBe(true)
    }
  })

  it("cada ícono existe en el mapa de íconos de navegación", () => {
    for (const app of APPS) expect(NAV_ICONS[app.iconName], app.id).toBeDefined()
  })
})
