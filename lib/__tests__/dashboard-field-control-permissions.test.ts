/**
 * DASH-001 (auditoría 2026-09-14): la sección de terreno del tablero agrupa
 * seis módulos que en su propia ruta exigen seis permisos distintos, y los
 * cargaba todos con que la sesión tuviera uno cualquiera. El agrupamiento
 * visual se había convertido en la condición de lectura.
 */
import { describe, expect, it } from "vitest"
import { visibleFieldControl } from "@/lib/services/dashboard-domains-data"

describe("visibleFieldControl", () => {
  it("sin permisos no se ve ningún submódulo", () => {
    expect(visibleFieldControl([])).toEqual({
      inspections: false, permits: false, drills: false,
      committee: false, hygiene: false, change: false,
    })
  })

  it("un permiso abre su módulo y sólo el suyo", () => {
    expect(visibleFieldControl(["prevention:permits:view"])).toEqual({
      inspections: false, permits: true, drills: false,
      committee: false, hygiene: false, change: false,
    })
  })

  it("cada módulo responde a su propio permiso", () => {
    const pares = [
      ["prevention:inspections:view", "inspections"],
      ["prevention:permits:view", "permits"],
      ["prevention:emergency:view", "drills"],
      ["prevention:cphs:view", "committee"],
      ["prevention:hygiene:view", "hygiene"],
      ["prevention:change:view", "change"],
    ] as const

    for (const [permission, module] of pares) {
      const visible = visibleFieldControl([permission])
      expect(visible[module]).toBe(true)
      const otros = Object.entries(visible).filter(([key]) => key !== module)
      expect(otros.every(([, value]) => value === false)).toBe(true)
    }
  })

  it("un permiso de otro dominio no abre nada de terreno", () => {
    // El caso del hallazgo: quien sólo ve CPHS entraba a la sección y leía
    // inspecciones, permisos, simulacros, higiene y gestión del cambio.
    const visible = visibleFieldControl(["prevention:cphs:view", "requests:view_own"])
    expect(visible.inspections).toBe(false)
    expect(visible.permits).toBe(false)
    expect(visible.hygiene).toBe(false)
    expect(visible.committee).toBe(true)
  })

  it("quien los tiene todos los ve todos", () => {
    const todos = [
      "prevention:inspections:view", "prevention:permits:view", "prevention:emergency:view",
      "prevention:cphs:view", "prevention:hygiene:view", "prevention:change:view",
    ]
    expect(Object.values(visibleFieldControl(todos)).every(Boolean)).toBe(true)
  })
})
