import { describe, expect, it } from "vitest"
import { parsePanelFilters, periodStart, stoppedDaysWithin, weekLabel, weekRangeLabel, weekStart, lastWeeks } from "./panel-filters"
import {
  RECORD_FILTER_PARAMS, advancedFilterCount, hasRecordFilters, parseRecordFilters, parseRecordListContext, parseRecordQuery, recordDetailHref,
  recordFiltersToParams, recordListHref, recordQueryToParams,
} from "./records-filters"

describe("filtros de Registros en la URL", () => {
  it("los parámetros fuera de las listas cerradas se descartan en vez de filtrar por algo que no existe", () => {
    expect(parseRecordFilters({ tipo: "X", estado: "borrado", alerta: "otra", hecho: "x:1", desde: "ayer", orden: "evil" })).toEqual({})
  })

  it("lee cada filtro, con el primer valor si llega repetido", () => {
    const filters = parseRecordFilters({
      faena: "ws-1", tipo: "C", equipo: " KA-135 ", hecho: "u:user-1", registro: "user-2", desde: "2026-10-01", hasta: ["2026-10-31", "2026-11-30"],
      estado: "anulado", revision: "observado", alerta: "salto", situacion: "en_taller",
    })
    expect(filters).toEqual({
      worksiteId: "ws-1", kind: "C", equipment: "KA-135", executor: "u:user-1", registeredBy: "user-2", from: "2026-10-01", to: "2026-10-31",
      status: "anulado", review: "observado", alert: "salto", situation: "en_taller",
    })
    // Ida y vuelta: lo que se escribe en la URL se lee igual.
    expect(parseRecordFilters(Object.fromEntries(recordFiltersToParams(filters)))).toEqual(filters)
  })

  it("orden, sentido y página: la fecha parte de lo más reciente y el resto de la A a la Z", () => {
    expect(parseRecordQuery({ orden: "folio", dir: "desc", page: "3" })).toMatchObject({ sort: "folio", dir: "desc", page: 3 })
    expect(parseRecordQuery({})).toMatchObject({ sort: "fecha", dir: "desc", page: 1 })
    expect(parseRecordQuery({ orden: "equipo" })).toMatchObject({ sort: "equipo", dir: "asc" })
    expect(parseRecordQuery({ orden: "evil", page: "-4" })).toMatchObject({ sort: "fecha", dir: "desc", page: 1 })
  })

  it("el contador de «Más filtros» sólo cuenta los secundarios, y la revisión no: tiene sus pestañas", () => {
    expect(advancedFilterCount({ kind: "P", equipment: "KA", from: "2026-10-01" })).toBe(0)
    expect(advancedFilterCount({ registeredBy: "u", status: "vigente", review: "pendiente", alert: "salto", situation: "en_taller" })).toBe(4)
    expect(advancedFilterCount({ review: "pendiente" })).toBe(0)
    expect(hasRecordFilters({})).toBe(false)
    expect(hasRecordFilters({ kind: "P" })).toBe(true)
  })

  it("«Limpiar filtros» suelta los filtros de la barra pero no la revisión ni el orden", () => {
    expect(RECORD_FILTER_PARAMS).not.toContain("revision")
    expect(RECORD_FILTER_PARAMS).not.toContain("orden")
    expect(RECORD_FILTER_PARAMS).toEqual(expect.arrayContaining(["faena", "tipo", "equipo", "hecho", "registro", "desde", "hasta", "estado", "alerta", "situacion"]))
  })
})

describe("la lista que viaja al detalle (?lista=)", () => {
  it("la misma lista produce el mismo texto: lo que ya es el valor por omisión no se escribe", () => {
    expect(recordQueryToParams(parseRecordQuery({})).toString()).toBe("")
    expect(recordQueryToParams(parseRecordQuery({ orden: "fecha", dir: "desc" })).toString()).toBe("")
    expect(recordQueryToParams(parseRecordQuery({ orden: "folio" })).toString()).toBe("orden=folio")
    expect(recordQueryToParams(parseRecordQuery({ orden: "folio", dir: "desc", revision: "pendiente", tipo: "P", page: "4" })).toString())
      .toBe("tipo=P&revision=pendiente&orden=folio&dir=desc")
  })

  it("el enlace al detalle lleva la lista; la lista vacía también viaja", () => {
    expect(recordDetailHref("rec 1", null)).toBe("/mantencion/registros/rec%201")
    expect(recordDetailHref("rec-1", "")).toBe("/mantencion/registros/rec-1?lista=")
    expect(recordDetailHref("rec-1", "revision=pendiente&tipo=P")).toBe("/mantencion/registros/rec-1?lista=revision%3Dpendiente%26tipo%3DP")
  })

  it("lee la lista de la URL con las mismas reglas de la lista: lo que no se entiende no se reenvía", () => {
    expect(parseRecordListContext({})).toBeNull()
    expect(parseRecordListContext({ lista: "" })).toEqual({ query: parseRecordQuery({}), listQuery: "" })
    const context = parseRecordListContext({ lista: "revision=pendiente&tipo=X&orden=evil&page=7&otro=1" })
    expect(context?.query.filters).toEqual({ review: "pendiente" })
    expect(context?.listQuery).toBe("revision=pendiente")
    expect(parseRecordListContext({ lista: ["tipo=C", "tipo=P"] })?.listQuery).toBe("tipo=C")
  })

  it("«Volver a la lista» cae en la página donde estaba el registro", () => {
    expect(recordListHref("", null)).toBe("/mantencion/registros")
    expect(recordListHref("revision=pendiente", 3)).toBe("/mantencion/registros?revision=pendiente")
    expect(recordListHref("revision=pendiente", 25)).toBe("/mantencion/registros?revision=pendiente")
    expect(recordListHref("revision=pendiente", 26)).toBe("/mantencion/registros?revision=pendiente&page=2")
    expect(recordListHref("", 80)).toBe("/mantencion/registros?page=4")
  })
})

describe("período y faena del panel", () => {
  it("el período por omisión es 30 días y un valor desconocido vuelve a él", () => {
    expect(parsePanelFilters({})).toEqual({ period: "30" })
    expect(parsePanelFilters({ periodo: "todo", faena: "ws-1" })).toEqual({ period: "todo", worksiteId: "ws-1" })
    expect(parsePanelFilters({ periodo: "siempre" })).toEqual({ period: "30" })
  })

  it("calcula el inicio de cada período", () => {
    expect(periodStart("7", "2026-10-28")).toBe("2026-10-22")
    expect(periodStart("30", "2026-10-28")).toBe("2026-09-29")
    expect(periodStart("mes", "2026-10-28")).toBe("2026-10-01")
    expect(periodStart("todo", "2026-10-28")).toBeNull()
  })

  it("las semanas empiezan el lunes y se rotulan completas", () => {
    // 28-10-2026 es miércoles: su semana empieza el lunes 26.
    expect(weekStart("2026-10-28")).toBe("2026-10-26")
    expect(weekStart("2026-11-01")).toBe("2026-10-26")
    expect(lastWeeks("2026-10-28", 3)).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"])
    expect(weekLabel("2026-10-26")).toBe("26-10")
    expect(weekRangeLabel("2026-10-26")).toBe("26-10 al 01-11")
  })

  it("los días fuera de servicio se recortan al período", () => {
    expect(stoppedDaysWithin("2026-10-01", null, "2026-10-28", null)).toBe(27)
    expect(stoppedDaysWithin("2026-10-01", null, "2026-10-28", "2026-10-22")).toBe(6)
    expect(stoppedDaysWithin("2026-10-01", "2026-10-10", "2026-10-28", "2026-10-22")).toBe(0)
    expect(stoppedDaysWithin("2026-10-20", "2026-10-25", "2026-10-28", "2026-10-22")).toBe(3)
  })
})
