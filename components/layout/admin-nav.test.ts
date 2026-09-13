/**
 * Filtrado por permiso del árbol de Administración.
 *
 * Lo que se fija acá es la paridad entre lo que el árbol muestra y lo que la
 * sesión puede abrir. El árbol se pinta con el ítem padre como enlace
 * (`nav-rows.tsx`), así que un padre conservado sólo por sus hijos no puede
 * seguir apuntando a su propia pantalla: llevaría a /forbidden a quien tiene
 * permiso sobre el hijo y no sobre el padre.
 */

import { describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import { ADMIN_AREAS, getAdminAreas } from "./admin-nav"

function sessionWith(...permissions: string[]): Session {
  return { user: { permissions }, expires: "2099-01-01" } as unknown as Session
}

function findItem(areas: ReturnType<typeof getAdminAreas>, label: string) {
  return areas.flatMap((a) => a.items).find((i) => i.label === label)
}

describe("getAdminAreas", () => {
  it("no devuelve nada para una sesión sin permisos de administración", () => {
    expect(getAdminAreas(sessionWith())).toEqual([])
  })

  it("devuelve sólo el área del permiso que la sesión sí tiene", () => {
    const areas = getAdminAreas(sessionWith("admin:roles"))
    expect(areas.map((a) => a.id)).toEqual(["personas"])
    expect(areas[0]?.items.map((i) => i.label)).toEqual(["Roles"])
  })

  it("conserva el padre cuando sólo un hijo es visible, con ese hijo únicamente", () => {
    const areas = getAdminAreas(sessionWith("combustibles:manage_suppliers"))
    const flota = findItem(areas, "Catálogos de flota")
    expect(flota).toBeDefined()
    expect(flota?.children?.map((c) => c.label)).toEqual(["Proveedores de combustible"])
  })

  /**
   * El hueco que esto cierra: el padre se conservaba con su propio `href`, de
   * modo que el enlace visible llevaba a una pantalla que la sesión no podía
   * abrir.
   */
  it("apunta el padre al primer hijo visible cuando no puede abrir su propia pantalla", () => {
    const areas = getAdminAreas(sessionWith("combustibles:manage_suppliers"))
    const flota = findItem(areas, "Catálogos de flota")
    expect(flota?.href).toBe("/admin/flota-catalogos/proveedores-combustible")
  })

  it("respeta el href propio del padre cuando la sesión sí puede abrirlo", () => {
    const areas = getAdminAreas(sessionWith("admin:fleet_catalog"))
    const flota = findItem(areas, "Catálogos de flota")
    expect(flota?.href).toBe("/admin/flota-catalogos")
  })

  /**
   * Guarda de paridad general: ningún href que el árbol entregue puede quedar
   * fuera del conjunto de destinos que esa misma sesión tiene permitidos.
   */
  it("nunca entrega un destino que la sesión no pueda abrir", () => {
    const permisosDeTodoElArbol = [...new Set(
      ADMIN_AREAS.flatMap((a) => a.items.flatMap((i) => [
        ...(i.permissions ?? []),
        ...(i.children ?? []).flatMap((c) => c.permissions ?? []),
      ])),
    )]

    for (const permiso of permisosDeTodoElArbol) {
      const areas = getAdminAreas(sessionWith(permiso))
      // Destinos que este permiso concede, según el árbol sin filtrar.
      const permitidos = new Set(
        ADMIN_AREAS.flatMap((a) => a.items.flatMap((i) => [
          ...(i.permissions?.includes(permiso) ? [i.href] : []),
          ...(i.children ?? []).filter((c) => c.permissions?.includes(permiso)).map((c) => c.href),
        ])),
      )
      const entregados = areas.flatMap((a) => a.items.flatMap((i) => [
        i.href,
        ...(i.children ?? []).map((c) => c.href),
      ]))

      for (const href of entregados) {
        expect(permitidos.has(href), `${permiso} no debería exponer ${href}`).toBe(true)
      }
    }
  })
})
