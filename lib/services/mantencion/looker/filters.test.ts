import { describe, expect, it } from "vitest"
import { legacyTabRedirect, monthLabel, multiValue, parseLookerFilters, parseLookerTab, parseLookerUnit, pickFilterParams, queryFilters } from "./filters"
import {
  activeDateShortcut, buildCrossFilterHref, checkAction, clearFiltersHref, closeSheetHref, crossFilterActive, dateFieldHref,
  dateShortcutHref, equipmentAction, planningStateHref, removeChipHref, sheetHref, tabHref, unitHref, workAction,
} from "./filter-hrefs"
import { filterChips } from "./filter-chips"
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
    expect(parseLookerTab({ pestana: "correctivo" })).toBe("correctivo")
    expect(parseLookerTab({ pestana: "preventivo" })).toBe("preventivo")
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
      pestana: "correctivo", unidad: "h", desde: "2026-10-01", hasta: "2026-10-31", faena: "ws-2", equipo: "v-2",
      frecuencia: "900", page: "3", x_equipo: "v-2", x_mes: "2026-10", x_conductor: "Juan Pérez", x_mecanico: "Pedro",
    }, TODAY)
    expect(filters.tab).toBe("correctivo")
    expect(filters.unit).toBe("h")
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
  it("la unidad sale de `unidad` (km por defecto) en las tres pestañas; «Hoy» no tiene", () => {
    for (const pestana of ["planificacion", "correctivo", "preventivo"]) {
      expect(queryFilters(parseLookerFilters({ pestana }, TODAY), noCross).unit).toBe("km")
      expect(queryFilters(parseLookerFilters({ pestana, unidad: "h" }, TODAY), noCross).unit).toBe("h")
    }
    expect(queryFilters(parseLookerFilters({}, TODAY), noCross).unit).toBeNull()
  })

  it("un filtro cruzado de equipo reemplaza al manual y deriva faena y unidad", () => {
    const filters = parseLookerFilters({ pestana: "correctivo", faena: "ws-2", equipo: "v-2" }, TODAY)
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

  it("borrar filtros conserva la pestaña y la unidad (km no se escribe)", () => {
    expect(clearFiltersHref("/mantencion/panel", "correctivo")).toBe("/mantencion/panel?pestana=correctivo")
    expect(clearFiltersHref("/mantencion/panel", "preventivo", "h")).toBe("/mantencion/panel?pestana=preventivo&unidad=h")
    expect(clearFiltersHref("/mantencion/panel", "hoy")).toBe("/mantencion/panel")
    expect(tabHref("/mantencion/panel", "preventivo")).toBe("/mantencion/panel?pestana=preventivo")
  })

  it("el chip del rango de fechas quita los dos extremos y `fecha`", () => {
    const filters = parseLookerFilters({ pestana: "planificacion", fecha: "ultima", fecha_desde: "2026-06-01", fecha_hasta: "2026-09-30" }, TODAY)
    const chip = filterChips(filters, options, noCross).find((item) => item.key === "fecha")!
    expect(chip).toMatchObject({ label: "Última mantención", displayValue: "01-06-2026 al 30-09-2026" })
    const href = removeChipHref("/p", new URLSearchParams("pestana=planificacion&fecha=ultima&fecha_desde=2026-06-01&fecha_hasta=2026-09-30"), chip)
    expect(href).toBe("/p?pestana=planificacion")
    const shortcut = filterChips(parseLookerFilters({ pestana: "planificacion", fecha_hasta: "2026-12-27" }, TODAY), options, noCross)
    expect(shortcut.find((item) => item.key === "fecha")).toMatchObject({ label: "Próxima mantención", displayValue: "hasta 27-12-2026" })
  })

  it("el estado de Planificación tiene su chip; en otra pestaña no", () => {
    expect(filterChips(parseLookerFilters({ pestana: "planificacion", estado: "vencida" }, TODAY), options, noCross).map((chip) => chip.displayValue)).toContain("Vencidas")
    expect(filterChips(parseLookerFilters({ pestana: "correctivo", estado: "vencida" }, TODAY), options, noCross)).toEqual([])
  })

  it("rotula el mes", () => {
    expect(monthLabel("2026-10")).toBe("octubre 2026")
  })
})

describe("enlace entre pestañas del Panel", () => {
  const PANEL = "/mantencion/panel"
  // Lo que hay en la URL de Correctivo por horas cuando alguien filtró de todo.
  const CURRENT = {
    pestana: "correctivo", unidad: "h", desde: "2026-01-01", hasta: "2026-10-31", faena: "ws-1,ws-2",
    equipo: "v-1", frecuencia: "40000", page: "3", estado: "vencida", fecha: "ultima", fecha_desde: "2026-01-01", fecha_hasta: "2026-02-01",
    ficha: "v-1", pauta: "h:1",
    x_equipo: "v-1", x_ot: "ot:1", x_check: "h:1", x_conductor: "JUAN PEREZ", x_mes: "2026-10", x_faena: "ws-1", x_mecanico: "Javier Roa",
  }
  const queryOf = (href: string) => new URLSearchParams(href.split("?")[1])

  it("sin parámetros actuales lleva sólo la pestaña, y «Hoy» es la página sin parámetro", () => {
    expect(tabHref(PANEL, "planificacion")).toBe(`${PANEL}?pestana=planificacion`)
    expect(tabHref(PANEL, "preventivo", {})).toBe(`${PANEL}?pestana=preventivo`)
    expect(tabHref(PANEL, "hoy")).toBe(PANEL)
    expect(tabHref(PANEL, "hoy", {})).toBe(PANEL)
  })

  it("conserva la unidad, el período y la faena al cambiar de pestaña, en el mismo orden para toda pestaña", () => {
    for (const tab of ["planificacion", "correctivo", "preventivo"] as const) {
      const params = queryOf(tabHref(PANEL, tab, CURRENT))
      expect([...params.keys()]).toEqual(["pestana", "unidad", "desde", "hasta", "faena"])
      expect(params.get("unidad")).toBe("h")
      expect(params.get("pestana")).toBe(tab)
      expect(params.get("desde")).toBe("2026-01-01")
      expect(params.get("hasta")).toBe("2026-10-31")
      // Varias faenas viajan igual que las deja la barra de filtros: separadas por coma.
      expect(params.get("faena")).toBe("ws-1,ws-2")
    }
  })

  it("«Hoy» conserva unidad, período y faena, sin `pestana` (la unidad vuelve al regresar)", () => {
    expect(tabHref(PANEL, "hoy", CURRENT)).toBe(`${PANEL}?unidad=h&desde=2026-01-01&hasta=2026-10-31&faena=ws-1%2Cws-2`)
  })

  it("la unidad km es la de por defecto y no se escribe", () => {
    expect(queryOf(tabHref(PANEL, "preventivo", { unidad: "km", faena: "ws-1" })).has("unidad")).toBe(false)
  })

  it("descarta los filtros cruzados, el equipo, la frecuencia, la página, el estado, las fechas y la ficha de la pestaña que se deja", () => {
    for (const tab of ["hoy", "planificacion", "correctivo", "preventivo"] as const) {
      const params = queryOf(tabHref(PANEL, tab, CURRENT))
      for (const dropped of [
        "equipo", "frecuencia", "page", "x_equipo", "x_ot", "x_check", "x_conductor", "x_mes", "x_faena", "x_mecanico",
        "estado", "fecha", "fecha_desde", "fecha_hasta", "ficha", "pauta",
      ]) {
        expect(params.has(dropped), `${tab} no debe llevar ${dropped}`).toBe(false)
      }
    }
  })

  it("una faena repetida (`?faena=a&faena=b`) sigue repetida, y los valores vacíos no viajan", () => {
    const href = tabHref(PANEL, "correctivo", { desde: "2026-10-01", hasta: " ", faena: ["ws-1", "", "ws-2"] })
    expect(queryOf(href).getAll("faena")).toEqual(["ws-1", "ws-2"])
    expect(queryOf(href).has("hasta")).toBe(false)
    expect(tabHref(PANEL, "hoy", { desde: undefined, faena: "" })).toBe(PANEL)
  })

  it("lo que viaja se lee igual en la pestaña de llegada (mismo período y misma faena)", () => {
    const raw = Object.fromEntries(queryOf(tabHref(PANEL, "preventivo", CURRENT)).entries())
    const arrived = parseLookerFilters(raw, "2026-11-26")
    expect(arrived).toMatchObject({ tab: "preventivo", unit: "h", planningState: null, dateFrom: null, sheetVehicleId: null, from: "2026-01-01", to: "2026-10-31", worksiteIds: ["ws-1", "ws-2"], equipmentIds: [], frequencies: [], page: 1 })
    expect(arrived.cross).toEqual({})
  })
})

describe("parámetros que mueven una pestaña", () => {
  it("se queda con la unidad, el período, los filtros manuales, los de Planificación y los cruzados; descarta la pestaña, la página, la ficha y lo desconocido", () => {
    expect(pickFilterParams({
      pestana: "correctivo", unidad: "h", estado: "vencida", fecha: "ultima", fecha_desde: "2026-01-01", fecha_hasta: "2026-02-01", ficha: "v-1", pauta: "h:1",
      page: "3", desde: "2026-10-01", hasta: "2026-10-31", faena: ["ws-1", "ws-2"], equipo: "v-1", frecuencia: "40000",
      x_equipo: "v-1", x_ot: "ot:1", x_check: "h:1", x_conductor: "JUAN PEREZ", x_mes: "2026-10", x_faena: "ws-1", x_mecanico: "Javier Roa", otro: "1",
    })).toEqual({
      unidad: "h", estado: "vencida", fecha: "ultima", fecha_desde: "2026-01-01", fecha_hasta: "2026-02-01",
      desde: "2026-10-01", hasta: "2026-10-31", faena: ["ws-1", "ws-2"], equipo: "v-1", frecuencia: "40000",
      x_equipo: "v-1", x_ot: "ot:1", x_check: "h:1", x_conductor: "JUAN PEREZ", x_mes: "2026-10", x_faena: "ws-1", x_mecanico: "Javier Roa",
    })
  })

  it("no lleva claves vacías ni sin valor", () => {
    expect(pickFilterParams({ desde: "", faena: undefined, equipo: [], hasta: "2026-10-31" })).toEqual({ hasta: "2026-10-31" })
  })

  it("lo que devuelve da los mismos filtros que la URL completa (es lo que viaja a la exportación)", () => {
    const raw = { pestana: "correctivo", unidad: "h", page: "2", desde: "2026-10-01", hasta: "2026-10-31", faena: "ws-1,ws-2", frecuencia: ["10000", "40000"], x_conductor: "JUAN" }
    const picked = { ...pickFilterParams(raw), pestana: "correctivo" }
    const { page: _page, ...full } = parseLookerFilters(raw, TODAY)
    const { page: _otherPage, ...fromPicked } = parseLookerFilters(picked, TODAY)
    expect(fromPicked).toEqual(full)
  })
})

describe("enlaces guardados de antes del reajuste (`pestana=camiones|maquinas`)", () => {
  it("se leen como Correctivo en su unidad, aunque la URL diga otra `unidad`", () => {
    expect(parseLookerTab({ pestana: "camiones" })).toBe("correctivo")
    expect(parseLookerTab({ pestana: "maquinas" })).toBe("correctivo")
    expect(parseLookerUnit({ pestana: "camiones" })).toBe("km")
    expect(parseLookerUnit({ pestana: "maquinas", unidad: "km" })).toBe("h")
    expect(parseLookerFilters({ pestana: "maquinas", faena: "ws-1" }, TODAY)).toMatchObject({ tab: "correctivo", unit: "h", worksiteIds: ["ws-1"] })
  })

  it("redirigen a la URL canónica conservando los demás parámetros", () => {
    const camiones = legacyTabRedirect("/p", { pestana: "camiones", desde: "2026-10-01", faena: ["ws-1", "ws-2"], x_conductor: "JUAN" })!
    const params = new URLSearchParams(camiones.split("?")[1])
    expect(params.get("pestana")).toBe("correctivo")
    expect(params.has("unidad")).toBe(false)
    expect(params.get("desde")).toBe("2026-10-01")
    expect(params.getAll("faena")).toEqual(["ws-1", "ws-2"])
    expect(params.get("x_conductor")).toBe("JUAN")
    expect(legacyTabRedirect("/p", { pestana: "maquinas", unidad: "km" })).toBe("/p?pestana=correctivo&unidad=h")
  })

  it("una URL ya canónica no redirige", () => {
    expect(legacyTabRedirect("/p", { pestana: "correctivo", unidad: "h" })).toBeNull()
    expect(legacyTabRedirect("/p", {})).toBeNull()
  })
})

describe("parámetros nuevos", () => {
  it("`unidad`: sólo `h` cambia la unidad; cualquier otro valor es km", () => {
    expect(parseLookerUnit({ unidad: "h" })).toBe("h")
    expect(parseLookerUnit({ unidad: "km" })).toBe("km")
    expect(parseLookerUnit({ unidad: "horas" })).toBe("km")
    expect(parseLookerUnit({})).toBe("km")
  })

  it("`estado` acepta los cuatro estados y descarta lo demás", () => {
    for (const estado of ["vencida", "proxima", "al_dia", "sin_dato"]) {
      expect(parseLookerFilters({ estado }, TODAY).planningState).toBe(estado)
    }
    expect(parseLookerFilters({ estado: "VENCIDA" }, TODAY).planningState).toBeNull()
    expect(parseLookerFilters({}, TODAY).planningState).toBeNull()
  })

  it("`fecha` es la próxima por defecto y `ultima` si se pide", () => {
    expect(parseLookerFilters({}, TODAY).dateField).toBe("proxima")
    expect(parseLookerFilters({ fecha: "ultima" }, TODAY).dateField).toBe("ultima")
    expect(parseLookerFilters({ fecha: "otra" }, TODAY).dateField).toBe("proxima")
  })

  it("`fecha_desde`/`fecha_hasta` válidos pasan; uno inválido se ignora y avisa; uno solo vale", () => {
    expect(parseLookerFilters({ fecha_desde: "2026-06-01", fecha_hasta: "2026-09-30" }, TODAY)).toMatchObject({ dateFrom: "2026-06-01", dateTo: "2026-09-30", invalidDateRange: false })
    expect(parseLookerFilters({ fecha_hasta: "2026-12-27" }, TODAY)).toMatchObject({ dateFrom: null, dateTo: "2026-12-27", invalidDateRange: false })
    expect(parseLookerFilters({ fecha_desde: "2026-02-30", fecha_hasta: "2026-09-30" }, TODAY)).toMatchObject({ dateFrom: null, dateTo: "2026-09-30", invalidDateRange: true })
    expect(parseLookerFilters({ fecha_hasta: "27-12-2026" }, TODAY)).toMatchObject({ dateTo: null, invalidDateRange: true })
  })

  it("un rango al revés se ignora entero y avisa", () => {
    expect(parseLookerFilters({ fecha_desde: "2026-10-01", fecha_hasta: "2026-09-01" }, TODAY)).toMatchObject({ dateFrom: null, dateTo: null, invalidDateRange: true })
  })

  it("`ficha` abre la ficha; `pauta` sólo cuenta con ficha", () => {
    expect(parseLookerFilters({ ficha: "v-1", pauta: "r:9" }, TODAY)).toMatchObject({ sheetVehicleId: "v-1", sheetCheckId: "r:9" })
    expect(parseLookerFilters({ ficha: "v-1" }, TODAY)).toMatchObject({ sheetVehicleId: "v-1", sheetCheckId: null })
    expect(parseLookerFilters({ pauta: "r:9" }, TODAY)).toMatchObject({ sheetVehicleId: null, sheetCheckId: null })
  })
})

describe("enlaces de unidad, estado, fechas y ficha", () => {
  const P = "/mantencion/panel"
  const q = (href: string) => new URLSearchParams(href.split("?")[1])

  it("cambiar la unidad suelta lo que nombra un equipo, el estado y la ficha, y conserva período, faena y fechas", () => {
    const current = new URLSearchParams("pestana=planificacion&faena=ws-1&desde=2026-01-01&equipo=v-1&frecuencia=40000&x_equipo=v-1&x_ot=ot:1&x_check=h:1&estado=vencida&ficha=v-1&pauta=h:1&page=2&fecha_hasta=2026-12-27&x_conductor=JUAN")
    const params = q(unitHref(P, current, "h"))
    expect(params.get("unidad")).toBe("h")
    for (const dropped of ["equipo", "frecuencia", "x_equipo", "x_ot", "x_check", "estado", "ficha", "pauta", "page"]) expect(params.has(dropped), dropped).toBe(false)
    expect(params.get("faena")).toBe("ws-1")
    expect(params.get("desde")).toBe("2026-01-01")
    expect(params.get("fecha_hasta")).toBe("2026-12-27")
    expect(params.get("x_conductor")).toBe("JUAN")
    expect(q(unitHref(P, new URLSearchParams("pestana=correctivo&unidad=h"), "km")).has("unidad")).toBe(false)
  })

  it("una cifra de la tira fija el estado y un segundo clic lo quita; «Equipos controlados» lo quita", () => {
    const set = planningStateHref(P, new URLSearchParams("pestana=planificacion&page=2"), "vencida")
    expect(q(set).get("estado")).toBe("vencida")
    expect(q(set).has("page")).toBe(false)
    expect(q(planningStateHref(P, q(set), "vencida")).has("estado")).toBe(false)
    expect(q(planningStateHref(P, q(set), "proxima")).get("estado")).toBe("proxima")
    expect(q(planningStateHref(P, q(set), null)).has("estado")).toBe(false)
  })

  it("los atajos fijan sólo el término (entran las vencidas) y un segundo clic lo quita", () => {
    const today = "2026-11-27"
    const href = dateShortcutHref(P, new URLSearchParams("pestana=planificacion&fecha_desde=2026-01-01&fecha=ultima"), today, 30)
    expect(q(href).get("fecha_hasta")).toBe("2026-12-27")
    expect(q(href).has("fecha_desde")).toBe(false)
    expect(q(href).has("fecha")).toBe(false)
    expect(activeDateShortcut(q(href), today)).toBe(30)
    expect(q(dateShortcutHref(P, q(href), today, 30)).has("fecha_hasta")).toBe(false)
    expect(q(dateShortcutHref(P, q(href), today, 7)).get("fecha_hasta")).toBe("2026-12-04")
  })

  it("cambiar qué fecha filtra suelta el rango", () => {
    const href = dateFieldHref(P, new URLSearchParams("pestana=planificacion&fecha_hasta=2026-12-27&estado=vencida"), "ultima")
    expect(Object.fromEntries(q(href).entries())).toEqual({ pestana: "planificacion", estado: "vencida", fecha: "ultima" })
    expect(q(dateFieldHref(P, q(href), "proxima")).has("fecha")).toBe(false)
  })

  it("la ficha se abre con o sin pauta y se cierra sin tocar los filtros", () => {
    const current = new URLSearchParams("pestana=preventivo&faena=ws-1&x_mes=2026-10")
    const open = sheetHref(P, current, "v-1", "r:9")
    expect(Object.fromEntries(q(open).entries())).toEqual({ pestana: "preventivo", faena: "ws-1", x_mes: "2026-10", ficha: "v-1", pauta: "r:9" })
    expect(q(sheetHref(P, q(open), "v-2")).has("pauta")).toBe(false)
    expect(closeSheetHref(P, q(open))).toBe(`${P}?pestana=preventivo&faena=ws-1&x_mes=2026-10`)
  })
})
