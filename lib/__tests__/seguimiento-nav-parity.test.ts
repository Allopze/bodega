import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { AREA_TREE } from "@/components/layout/nav-items"
import { registry } from "@/modules/registry"

/**
 * "Trazabilidad" (Bodega) pasó a ser "Seguimiento de solicitudes" en
 * Adquisiciones, en la ruta `/seguimiento`, y "Documentos" dejó de ser un ítem
 * del sidebar de Bodega (es una pestaña de `/bodega`). Estas pruebas fijan la
 * paridad ruta ↔ navegación ↔ permiso de ese movimiento.
 */
const APP_DIR = path.join(process.cwd(), "app", "(app)")
const read = (...segments: string[]) => fs.readFileSync(path.join(APP_DIR, ...segments), "utf8")

describe("Seguimiento de solicitudes: navegación y permisos", () => {
  const area = (id: string) => AREA_TREE.find((candidate) => candidate.id === id)

  it("cuelga de Adquisiciones con el mismo permiso que tenía Trazabilidad", () => {
    const item = area("adquisiciones")?.items.find((candidate) => candidate.href === "/seguimiento")
    expect(item?.label).toBe("Seguimiento de solicitudes")
    expect(item?.permissions).toEqual(["warehouse:view_traceability"])
  })

  it("la página exige ese mismo permiso en el servidor", () => {
    expect(read("seguimiento", "page.tsx")).toMatch(/requirePermission\(\s*"warehouse:view_traceability"/)
    expect(read("seguimiento", "[itemId]", "page.tsx")).toMatch(/requirePermission\(\s*"warehouse:view_traceability"/)
  })

  it("Bodega ya no lista Trazabilidad ni Documentos", () => {
    const hrefs = (area("bodega")?.items ?? []).map((item) => item.href)
    expect(hrefs).not.toContain("/bodega/trazabilidad")
    expect(hrefs).not.toContain("/bodega/documentos")
    expect(hrefs).toContain("/bodega")
    expect(hrefs).toContain("/bodega/guias")
  })

  it("el permiso sigue declarado por el módulo warehouse (no se mueve de dueño)", () => {
    const warehouse = registry.find((module) => module.id === "warehouse")
    expect(warehouse?.permissions).toContain("warehouse:view_traceability")
  })

  it("la ruta documentos de Bodega sigue existiendo y protegida", () => {
    expect(read("bodega", "documentos", "page.tsx")).toMatch(/warehouse:view_stock/)
  })

  it("las URLs viejas redirigen al seguimiento conservando la query", () => {
    expect(read("bodega", "trazabilidad", "page.tsx")).toContain('redirect(query ? `/seguimiento?${query}` : "/seguimiento")')
    expect(read("bodega", "trazabilidad", "[itemId]", "page.tsx")).toContain("/seguimiento/")
    expect(read("bodega", "trazabilidad", "documento", "page.tsx")).toContain("/seguimiento?tab=documento")
    expect(read("trazabilidad", "page.tsx")).toContain("/seguimiento")
    expect(read("trazabilidad", "[itemId]", "page.tsx")).toContain("/seguimiento/")
    expect(read("trazabilidad", "documento", "page.tsx")).toContain("/seguimiento?tab=documento")
  })
})
