import { describe, expect, it } from "vitest"
import {
  buildCrossFilterHref, checkAction, clearFiltersHref, crossFilterActive, equipmentAction, filterChips,
  monthLabel, multiValue, parseLookerFilters, parseLookerTab, queryFilters, removeChipHref, tabHref, workAction,
} from "./filters"
import type { LookerOptions, ResolvedCrossFilters } from "./types"

const TODAY = "2026-11-23"

const options: LookerOptions = {
  worksites: [{ id: "ws-1", name: "Teno" }, { id: "ws-2", name: "Arauco" }],
  equipment: [
    {
      id: "v-1", code: "KA-143", plate: "SJFC-66", label: "KA-143 · SJFC-66", worksiteId: "ws-1", worksiteName: "Teno",
      typeName: "Camión", unit: "km", scheduleId: "s-1", scheduleName: "Camiones", intervals: [10_000, 40_000], frequency: 40_000,
    },
    {
      id: "v-2", code: "TO-37", plate: "TO-37", label: "TO-37", worksiteId: "ws-2", worksiteName: "Arauco",
      typeName: "Bulldozer", unit: "h", scheduleId: "s-2", scheduleName: "Máquinas", intervals: [300, 900], frequency: 900,
    },
  ],
  frequencies: [
    { value: 10_000, unit: "km", label: "10.000 km" },
    { value: 40_000, unit: "km", label: "40.000 km" },
    { value: 300, unit: "h", label: "300 h" },
    { value: 900, unit: "h", label: "900 h" },
  ],
}

const noCross: ResolvedCrossFilters = {}

describe("parseo de filtros", () => {
  it("lee la pestaña y cae a hoy con un valor inventado", () => {
    expect(parseLookerTab({ pestana: "camiones" })).toBe("camiones")
    expect(parseLookerTab({ pestana: "otra" })).toBe("hoy")
    expect(parseLookerTab({})).toBe("hoy")
  })

  it("acepta valores repetidos y separados por coma, sin duplicar", () => {
    expect(multiValue({ faena: ["ws-1", "ws-2"] }, "faena")).toEqual(["ws-1", "ws-2"])
    expect(multiValue({ faena: "ws-1,ws-2,ws-1" }, "faena")).toEqual(["ws-1", "ws-2"])
    expect(multiValue({}, "faena")).toEqual([])
  })

  it("parsea período, página y filtros cruzados", () => {
    const filters = parseLookerFilters({
      pestana: "maquinas", desde: "2026-10-01", hasta: "2026-10-31", faena: "ws-2", equipo: "v-2",
      frecuencia: "900", page: "3", x_equipo: "v-2", x_mes: "2026-10", x_conductor: "Juan Pérez", x_mecanico: "Pedro",
    }, TODAY)
    expect(filters.tab).toBe("maquinas")
    expect(filters.from).toBe("2026-10-01")
    expect(filters.to).toBe("2026-10-31")
    expect(filters.worksiteIds).toEqual(["ws-2"])
    expect(filters.equipmentIds).toEqual(["v-2"])
    expect(filters.frequencies).toEqual([900])
    expect(filters.page).toBe(3)
    expect(filters.cross).toMatchObject({ equipment: "v-2", month: "2026-10", conductor: "Juan Pérez", mechanic: "Pedro" })
  })

  it("descarta un mes con formato inválido", () => {
    const filters = parseLookerFilters({ x_mes: "2026-13" }, TODAY)
    expect(filters.cross.month).toBeUndefined()
  })
})

describe("filtros efectivos", () => {
  it("la pestaña fija la unidad", () => {
    expect(queryFilters(parseLookerFilters({ pestana: "camiones" }, TODAY), noCross).unit).toBe("km")
    expect(queryFilters(parseLookerFilters({ pestana: "maquinas" }, TODAY), noCross).unit).toBe("h")
    expect(queryFilters(parseLookerFilters({}, TODAY), noCross).unit).toBeNull()
  })

  it("un filtro cruzado de equipo reemplaza al manual y deriva faena y unidad", () => {
    const filters = parseLookerFilters({ pestana: "camiones", faena: "ws-2", equipo: "v-2" }, TODAY)
    const cross: ResolvedCrossFilters = {
      equipment: { id: "v-1", code: "KA-143", plate: "SJFC-66", label: "KA-143 · SJFC-66", worksiteId: "ws-1", worksiteName: "Teno", unit: "km", intervals: [10_000, 40_000], frequency: 40_000 },
    }
    const query = queryFilters(filters, cross)
    expect(query.equipmentIds).toEqual(["v-1"])
    expect(query.worksiteIds).toEqual(["ws-1"])
    expect(query.frequencies).toEqual([])
    expect(query.unit).toBe("km")
  })

  it("el bloque que emitió la dimensión la ignora y conserva el filtro manual", () => {
    const filters = parseLookerFilters({ pestana: "camiones", equipo: "v-2" }, TODAY)
    const cross: ResolvedCrossFilters = {
      equipment: { id: "v-1", code: "KA-143", plate: "SJFC-66", label: "KA-143 · SJFC-66", worksiteId: "ws-1", worksiteName: "Teno", unit: "km", intervals: [10_000], frequency: 10_000 },
    }
    const query = queryFilters(filters, cross, ["equipment"])
    expect(query.equipmentIds).toEqual(["v-2"])
    expect(query.worksiteIds).toEqual([])
  })

  it("una OT deriva equipo y faena; su propio bloque la ignora", () => {
    const filters = parseLookerFilters({ pestana: "camiones", x_ot: "ot:1" }, TODAY)
    const cross: ResolvedCrossFilters = { work: { id: "ot:1", label: "OT-1", equipmentId: "v-1", worksiteId: "ws-1" } }
    expect(queryFilters(filters, cross).equipmentIds).toEqual(["v-1"])
    expect(queryFilters(filters, cross).workId).toBe("ot:1")
    expect(queryFilters(filters, cross, ["work"]).equipmentIds).toEqual([])
    expect(queryFilters(filters, cross, ["work"]).workId).toBeNull()
  })

  it("la mantención deriva mes y nivel; mes ignorado deja de aplicar", () => {
    const filters = parseLookerFilters({ pestana: "maquinas", x_check: "h:abc" }, TODAY)
    const cross: ResolvedCrossFilters = {
      check: { id: "h:abc", label: "TO-37 · 3 oct 2026", equipmentId: "v-2", worksiteId: "ws-2", month: "2026-10", level: "900 HRS" },
    }
    expect(queryFilters(filters, cross).month).toBe("2026-10")
    expect(queryFilters(filters, cross, ["month"]).month).toBeNull()
  })

  it("el equipo derivado de la mantención no se aplica a la matriz que ignora la mantención", () => {
    const filters = parseLookerFilters({ pestana: "maquinas", x_check: "h:abc" }, TODAY)
    const cross: ResolvedCrossFilters = {
      check: { id: "h:abc", label: "TO-37 · 3 oct 2026", equipmentId: "v-2", worksiteId: "ws-2", month: "2026-10", level: "900 HRS" },
      equipment: {
        id: "v-2", code: "TO-37", plate: "TO-37", label: "TO-37", worksiteId: "ws-2", worksiteName: "Arauco",
        unit: "h", intervals: [300, 900], frequency: 900, derivedFrom: "check",
      },
    }
    const matrix = queryFilters(filters, cross, ["check"])
    expect(matrix.checkId).toBeNull()
    expect(matrix.equipmentIds).toEqual([])
    expect(matrix.worksiteIds).toEqual([])
  })

  it("el equipo derivado de la OT no se aplica a la tabla de OT que ignora la OT", () => {
    const filters = parseLookerFilters({ pestana: "camiones", x_ot: "ot:1" }, TODAY)
    const cross: ResolvedCrossFilters = {
      work: { id: "ot:1", label: "OT-1", equipmentId: "v-1", worksiteId: "ws-1" },
      equipment: {
        id: "v-1", code: "KA-143", plate: "SJFC-66", label: "KA-143 · SJFC-66", worksiteId: "ws-1", worksiteName: "Teno",
        unit: "km", intervals: [10_000], frequency: 10_000, derivedFrom: "work",
      },
    }
    const ownTable = queryFilters(filters, cross, ["work"])
    expect(ownTable.workId).toBeNull()
    expect(ownTable.equipmentIds).toEqual([])
    expect(ownTable.worksiteIds).toEqual([])
  })
})

describe("URL del filtro cruzado", () => {
  it("activa, alterna y limpia las alternativas de nivel equipo", () => {
    const current = new URLSearchParams("pestana=camiones&x_ot=ot:1&page=2")
    const href = buildCrossFilterHref("/mantencion/panel", current, equipmentAction("v-1", false))
    const params = new URLSearchParams(href.split("?")[1])
    expect(params.get("x_equipo")).toBe("v-1")
    expect(params.get("x_ot")).toBeNull()
    expect(params.get("page")).toBeNull()
    expect(params.get("pestana")).toBe("camiones")

    const active = crossFilterActive(new URLSearchParams("x_equipo=v-1"), { x_equipo: "v-1" })
    expect(active).toBe(true)
    const removed = buildCrossFilterHref("/mantencion/panel", new URLSearchParams("x_equipo=v-1"), equipmentAction("v-1", true))
    expect(removed).toBe("/mantencion/panel")
  })

  it("un segundo clic en la OT quita su filtro", () => {
    const href = buildCrossFilterHref("/mantencion/panel", new URLSearchParams("x_ot=ot:1&x_conductor=Juan"), workAction("ot:1", true))
    const params = new URLSearchParams(href.split("?")[1])
    expect(params.get("x_ot")).toBeNull()
    expect(params.get("x_conductor")).toBe("Juan")
  })

  it("la mantención limpia equipo y OT", () => {
    const href = buildCrossFilterHref("/mantencion/panel", new URLSearchParams("x_equipo=v-1&x_ot=ot:1"), checkAction("h:abc", false))
    const params = new URLSearchParams(href.split("?")[1])
    expect(params.get("x_check")).toBe("h:abc")
    expect(params.get("x_equipo")).toBeNull()
    expect(params.get("x_ot")).toBeNull()
  })
})

describe("chips y limpieza", () => {
  it("muestra los valores manuales y cruzados, sin duplicar el mismo equipo", () => {
    const filters = parseLookerFilters({ faena: "ws-1", equipo: "v-1", frecuencia: "40000" }, TODAY)
    const cross: ResolvedCrossFilters = {
      equipment: { id: "v-1", code: "KA-143", plate: "SJFC-66", label: "KA-143 · SJFC-66", worksiteId: "ws-1", worksiteName: "Teno", unit: "km", intervals: [40_000], frequency: 40_000 },
    }
    const chips = filterChips(filters, options, cross)
    expect(chips.filter((chip) => chip.param === "x_equipo" || chip.param === "equipo")).toHaveLength(1)
    expect(chips.some((chip) => chip.param === "faena" && chip.displayValue === "Teno")).toBe(true)
    expect(chips.some((chip) => chip.param === "frecuencia")).toBe(true)
  })

  it("un chip de filtro múltiple quita sólo su valor", () => {
    const chip = { key: "faena:ws-1", label: "Faena", value: "ws-1", displayValue: "Teno", param: "faena" }
    const href = removeChipHref("/mantencion/panel", new URLSearchParams("faena=ws-1,ws-2&page=2"), chip)
    const params = new URLSearchParams(href.split("?")[1])
    expect(params.get("faena")).toBe("ws-2")
    expect(params.get("page")).toBeNull()
  })

  it("borrar filtros conserva la pestaña", () => {
    expect(clearFiltersHref("/mantencion/panel", "camiones")).toBe("/mantencion/panel?pestana=camiones")
    expect(clearFiltersHref("/mantencion/panel", "hoy")).toBe("/mantencion/panel")
    expect(tabHref("/mantencion/panel", "maquinas")).toBe("/mantencion/panel?pestana=maquinas")
  })

  it("rotula el mes", () => {
    expect(monthLabel("2026-10")).toBe("octubre 2026")
  })
})
