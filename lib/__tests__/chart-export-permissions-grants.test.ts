import { describe, expect, it } from "vitest"
import { CHART_EXPORT_PERMISSIONS } from "@/lib/reports/chart-data-export"
import { registry } from "@/modules/registry"

/**
 * Excel de «Ver datos» por módulo (decisión 2026-11-16): los permisos de exportar de Bodega, Compras,
 * Reportes y Prevención (CPHS, CGRD, PDTP, emergencias) son nuevos y se siembran con `defaultGrants`
 * a sólo administración y jefatura, **sin copiarlos del permiso de ver** (`PERMISSION_MIRRORS`): estos módulos
 * hoy no exportan nada, y copiarlos daría la descarga a todos los que ven.
 */
const grants = registry.flatMap((module) => (module.defaultGrants ?? []) as ReadonlyArray<{ roleSlug: string; permission: string }>)
const rolesOf = (permission: string) => grants.filter((grant) => grant.permission === permission).map((grant) => grant.roleSlug).sort()

const EXPECTED: Record<string, string[]> = {
  "warehouse:export": ["administrador", "jefa_chome"],
  "purchasing:export": ["administrador", "jefa_chome"],
  "reports:export": ["administrador", "jefa_chome"],
  "prevention:cphs:export": ["administrador", "jefa_chome", "prevencionista"],
  "prevention:cgrd:export": ["administrador", "jefa_chome", "prevencionista"],
  "prevention:pdtp:export": ["administrador", "jefa_chome", "prevencionista"],
  "prevention:emergency:export": ["administrador", "jefa_chome", "prevencionista"],
}

describe("permisos de exportar de «Ver datos» por módulo", () => {
  it.each(Object.entries(EXPECTED))("%s se siembra sólo a %j", (permission, roles) => {
    expect(rolesOf(permission)).toEqual(roles)
  })

  it("todos son permisos válidos del registro y de la lista de exportación de gráficos", () => {
    const declared = new Set(registry.flatMap((module) => module.permissions as readonly string[]))
    for (const permission of Object.keys(EXPECTED)) {
      expect(declared.has(permission), `${permission} no está declarado en ningún manifiesto`).toBe(true)
      expect((CHART_EXPORT_PERMISSIONS as readonly string[]).includes(permission), `${permission} falta en CHART_EXPORT_PERMISSIONS`).toBe(true)
    }
  })

  it("el PPA no suma un `ppa:export`: su permiso de exportar es `ppa:manage`", () => {
    const declared = new Set(registry.flatMap((module) => module.permissions as readonly string[]))
    expect(declared.has("ppa:export")).toBe(false)
    expect((CHART_EXPORT_PERMISSIONS as readonly string[]).includes("ppa:manage")).toBe(true)
  })
})
