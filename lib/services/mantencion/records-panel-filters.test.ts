import { describe, expect, it } from "vitest"
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

describe("fechas de los filtros de Registros", () => {
  it("descarta una fecha que el calendario no tiene en vez de pasarla cruda a SQL", () => {
    expect(parseRecordFilters({ desde: "2026-02-31", hasta: "2026-13-01" })).toEqual({})
    expect(parseRecordFilters({ desde: "2026-02-28", hasta: "2028-02-29" })).toEqual({ from: "2026-02-28", to: "2028-02-29" })
    expect(parseRecordFilters({ desde: "2027-02-29" })).toEqual({})
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
