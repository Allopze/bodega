import { describe, expect, it } from "vitest"
import { filterChips, parseLookerFilters } from "./filters"
import { scopeLookerToTab } from "./tab-scope"
import type { LookerEquipmentOption, LookerOptions } from "./types"

const TODAY = "2026-11-23"

function equipment(id: string, code: string, unit: "km" | "h" | null, worksiteId = "ws-1"): LookerEquipmentOption {
  return {
    id, code, plate: code, label: code, worksiteId, worksiteName: worksiteId === "ws-1" ? "Teno" : "Arauco",
    typeName: unit === "km" ? "Camión" : "Bulldozer", unit, scheduleId: null, scheduleName: null, intervals: [], frequency: null,
  }
}

const options: LookerOptions = {
  worksites: [{ id: "ws-1", name: "Teno" }, { id: "ws-2", name: "Arauco" }],
  equipment: [
    equipment("v-km-1", "KA-143", "km"),
    equipment("v-km-2", "KA-144", "km", "ws-2"),
    equipment("v-h-1", "TO-37", "h", "ws-2"),
    equipment("v-none", "XX-1", null),
  ],
  frequencies: [
    { value: 10_000, unit: "km", label: "10.000 km" },
    { value: 40_000, unit: "km", label: "40.000 km" },
    { value: 300, unit: "h", label: "300 h" },
    { value: 900, unit: "h", label: "900 h" },
  ],
}

const filtersOf = (raw: Record<string, string>) => parseLookerFilters(raw, TODAY)
const ids = (list: LookerEquipmentOption[]) => list.map((item) => item.id)
const values = (list: LookerOptions["frequencies"]) => list.map((item) => item.value)

describe("opciones del filtro acotadas a la unidad de la pestaña", () => {
  it("Camiones ofrece sólo equipos y frecuencias por km", () => {
    const scoped = scopeLookerToTab(filtersOf({ pestana: "camiones" }), options)
    expect(ids(scoped.options.equipment)).toEqual(["v-km-1", "v-km-2"])
    expect(values(scoped.options.frequencies)).toEqual([10_000, 40_000])
  })

  it("Máquinas ofrece sólo equipos y frecuencias por horas", () => {
    const scoped = scopeLookerToTab(filtersOf({ pestana: "maquinas" }), options)
    expect(ids(scoped.options.equipment)).toEqual(["v-h-1"])
    expect(values(scoped.options.frequencies)).toEqual([300, 900])
  })

  it("las faenas no se acotan: el filtro de faena sirve en todas las pestañas", () => {
    expect(scopeLookerToTab(filtersOf({ pestana: "camiones" }), options).options.worksites).toEqual(options.worksites)
    expect(scopeLookerToTab(filtersOf({ pestana: "maquinas" }), options).options.worksites).toEqual(options.worksites)
  })

  it("Planificación muestra las dos unidades: ofrece todo, tal cual", () => {
    const filters = filtersOf({ pestana: "planificacion", equipo: "v-h-1", frecuencia: "300" })
    const scoped = scopeLookerToTab(filters, options)
    expect(scoped.options).toBe(options)
    expect(scoped.filters).toBe(filters)
  })

  it("Hoy no usa estas listas: no se toca", () => {
    const filters = filtersOf({ equipo: "v-h-1" })
    const scoped = scopeLookerToTab(filters, options)
    expect(scoped.options).toBe(options)
    expect(scoped.filters).toBe(filters)
  })
})

describe("un valor de la URL de otra unidad se ignora, sin chip ni error", () => {
  it("Camiones descarta el equipo y la frecuencia por horas, y conserva los de km", () => {
    const filters = filtersOf({ pestana: "camiones", equipo: "v-km-1,v-h-1", frecuencia: "40000,300" })
    const scoped = scopeLookerToTab(filters, options)
    expect(scoped.filters.equipmentIds).toEqual(["v-km-1"])
    expect(scoped.filters.frequencies).toEqual([40_000])
  })

  it("Máquinas descarta el equipo y la frecuencia por km, y el equipo sin unidad", () => {
    const filters = filtersOf({ pestana: "maquinas", equipo: "v-km-2,v-none,v-h-1", frecuencia: "10000,900" })
    const scoped = scopeLookerToTab(filters, options)
    expect(scoped.filters.equipmentIds).toEqual(["v-h-1"])
    expect(scoped.filters.frequencies).toEqual([900])
  })

  it("lo descartado tampoco aparece como chip: no hay chips fantasma", () => {
    const filters = filtersOf({ pestana: "camiones", equipo: "v-h-1", frecuencia: "300" })
    const scoped = scopeLookerToTab(filters, options)
    expect(filterChips(scoped.filters, scoped.options, {})).toEqual([])
  })

  it("el resto de los filtros y la identidad de la consulta no cambian", () => {
    const filters = filtersOf({ pestana: "camiones", faena: "ws-1", equipo: "v-h-1", x_mes: "2026-10", desde: "2026-10-01", hasta: "2026-10-31", page: "2" })
    const scoped = scopeLookerToTab(filters, options)
    expect(scoped.filters).toMatchObject({
      tab: "camiones", from: "2026-10-01", to: "2026-10-31", worksiteIds: ["ws-1"], page: 2, cross: { month: "2026-10" },
    })
  })

  it("un valor que ninguna lista conoce se deja como estaba (sigue siendo un filtro visible y removible)", () => {
    const filters = filtersOf({ pestana: "camiones", equipo: "v-desconocido", frecuencia: "7" })
    const scoped = scopeLookerToTab(filters, options)
    expect(scoped.filters.equipmentIds).toEqual(["v-desconocido"])
    expect(scoped.filters.frequencies).toEqual([7])
  })

  it("una frecuencia que existe en las dos unidades se conserva en cada pestaña", () => {
    const shared: LookerOptions = {
      ...options,
      frequencies: [...options.frequencies, { value: 1_000, unit: "km", label: "1.000 km" }, { value: 1_000, unit: "h", label: "1.000 h" }],
    }
    expect(scopeLookerToTab(filtersOf({ pestana: "camiones", frecuencia: "1000" }), shared).filters.frequencies).toEqual([1_000])
    expect(scopeLookerToTab(filtersOf({ pestana: "maquinas", frecuencia: "1000" }), shared).filters.frequencies).toEqual([1_000])
  })

  it("el equipo del filtro cruzado de otra unidad no se resuelve con las opciones acotadas", () => {
    const scoped = scopeLookerToTab(filtersOf({ pestana: "camiones", x_equipo: "v-h-1" }), options)
    expect(scoped.options.equipment.find((item) => item.id === "v-h-1")).toBeUndefined()
  })
})
