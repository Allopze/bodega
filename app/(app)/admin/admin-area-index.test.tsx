// @vitest-environment jsdom

/**
 * El índice de áreas es lo que reemplaza a la pantalla que sólo decía "usa el
 * panel lateral". Se comprueban dos cosas que se rompen solas:
 *
 * 1. Que el filtro sea el del TopBar y no uno propio (AGENTS.md, regla de
 *    layout 1: la shell ya renderiza "Filtrar en esta página…" en esta ruta, y
 *    un segundo input daría dos búsquedas con comportamientos distintos).
 * 2. Que filtrar no esconda destinos por acentos o mayúsculas — "Catalogos"
 *    tiene que encontrar "Catálogos", que es como se escribe al teclear rápido.
 */

import * as React from "react"
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { AreaNode } from "@/components/layout/nav-items"
import { ShellHeaderProvider, useSafeShellHeader } from "@/components/layout/header-context"
import { AdminAreaIndex, filterAdminAreas } from "./admin-area-index"

const AREAS: AreaNode[] = [
  {
    id: "catalogos", label: "Catálogos", iconName: "Stack", order: 10,
    items: [
      { label: "Productos", href: "/admin/productos", iconName: "Cube" },
      {
        label: "Catálogos de flota", href: "/admin/flota-catalogos", iconName: "GearSix",
        children: [
          { label: "Vehículos", href: "/admin/flota-catalogos/vehiculos" },
          { label: "Tipos de equipo", href: "/admin/flota-catalogos/tipos-equipo" },
        ],
      },
    ],
  },
  {
    id: "personas", label: "Personas y acceso", iconName: "Users", order: 30,
    items: [
      { label: "Usuarios", href: "/admin/usuarios", iconName: "Users" },
      { label: "Roles", href: "/admin/roles", iconName: "ShieldCheck" },
    ],
  },
]

/** Escribe en la búsqueda del TopBar sin montar la shell completa. */
function SearchSeed({ query }: { query: string }) {
  const { setSearchQuery } = useSafeShellHeader()
  React.useEffect(() => { setSearchQuery(query) }, [query, setSearchQuery])
  return null
}

function renderIndex(query = "") {
  return render(
    <ShellHeaderProvider>
      <SearchSeed query={query} />
      <AdminAreaIndex areas={AREAS} />
    </ShellHeaderProvider>,
  )
}

describe("filterAdminAreas", () => {
  it("devuelve el árbol intacto sin consulta", () => {
    expect(filterAdminAreas(AREAS, "")).toEqual(AREAS)
    expect(filterAdminAreas(AREAS, "   ")).toEqual(AREAS)
  })

  it("conserva sólo las áreas con algún ítem que coincide", () => {
    const result = filterAdminAreas(AREAS, "roles")
    expect(result.map((a) => a.id)).toEqual(["personas"])
    expect(result[0]?.items.map((i) => i.label)).toEqual(["Roles"])
  })

  it("ignora acentos y mayúsculas", () => {
    expect(filterAdminAreas(AREAS, "CATALOGOS DE FLOTA")[0]?.items[0]?.label).toBe("Catálogos de flota")
    expect(filterAdminAreas(AREAS, "vehiculos")[0]?.items[0]?.children).toHaveLength(1)
  })

  it("conserva un área completa cuando lo que coincide es su nombre", () => {
    const result = filterAdminAreas(AREAS, "personas")
    expect(result).toHaveLength(1)
    expect(result[0]?.items).toHaveLength(2)
  })

  it("conserva el ítem padre con todos sus hijos cuando el padre coincide", () => {
    const result = filterAdminAreas(AREAS, "flota")
    expect(result[0]?.items[0]?.children).toHaveLength(2)
  })

  it("conserva sólo los hijos que coinciden cuando el padre no coincide", () => {
    const result = filterAdminAreas(AREAS, "tipos de equipo")
    expect(result[0]?.items[0]?.label).toBe("Catálogos de flota")
    expect(result[0]?.items[0]?.children?.map((c) => c.label)).toEqual(["Tipos de equipo"])
  })

  it("devuelve vacío cuando nada coincide", () => {
    expect(filterAdminAreas(AREAS, "zzz")).toEqual([])
  })
})

describe("AdminAreaIndex", () => {
  it("lista todas las áreas y sus destinos al entrar", () => {
    renderIndex()
    expect(screen.getByRole("link", { name: /Usuarios/ })).toHaveAttribute("href", "/admin/usuarios")
    expect(screen.getByRole("link", { name: /Vehículos/ })).toHaveAttribute("href", "/admin/flota-catalogos/vehiculos")
    expect(screen.getByRole("heading", { name: "Catálogos" })).toBeInTheDocument()
  })

  it("no renderiza un input de búsqueda propio: usa el del TopBar", () => {
    const { container } = renderIndex()
    expect(container.querySelector("input")).toBeNull()
    expect(screen.queryByRole("searchbox")).toBeNull()
  })

  it("reduce la lista con la consulta del TopBar", () => {
    renderIndex("roles")
    expect(screen.getByRole("link", { name: /Roles/ })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Usuarios/ })).toBeNull()
    expect(screen.queryByRole("heading", { name: "Catálogos" })).toBeNull()
  })

  it("ofrece limpiar la búsqueda cuando nada coincide", () => {
    renderIndex("zzz")
    const empty = screen.getByRole("heading", { name: /Sin resultados/i })
    expect(empty).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Limpiar búsqueda/i })).toBeInTheDocument()
  })

  it("agrupa cada destino bajo el encabezado de su área", () => {
    renderIndex()
    const group = screen.getByRole("region", { name: "Personas y acceso" })
    expect(within(group).getAllByRole("link")).toHaveLength(2)
  })

  /**
   * Un `<nav>` por área sumaba ocho landmarks a los que ya pone la shell, y una
   * lista de regiones de ese largo deja de servir para orientarse.
   */
  it("expone un solo landmark de navegación, no uno por área", () => {
    renderIndex()
    const navs = screen.getAllByRole("navigation")
    expect(navs).toHaveLength(1)
    expect(navs[0]).toHaveAccessibleName("Índice de administración")
  })
})
