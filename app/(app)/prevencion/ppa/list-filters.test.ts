import { describe, expect, it } from "vitest"
import { buildPpaDetailHref, buildPpaListHref, readPpaListFilterState, readPpaListPage, readPpaReturnHref } from "./list-filters"

describe("PPA list URL context", () => {
  it("serializes an active filtered page into a shareable return URL", () => {
    expect(buildPpaListHref({
      estado: "detenido",
      worksiteId: "north",
      search: "  Andrea  ",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-15",
    }, 3)).toBe("/prevencion/ppa?estado=detenido&worksiteId=north&search=Andrea&dateFrom=2026-07-01&dateTo=2026-07-15&page=3")
  })

  it("restores safe state from URL values and rejects malformed pagination or dates", () => {
    const query = {
      estado: "pendientes",
      worksiteId: "north",
      search: "riesgo",
      dateFrom: "2026-07-01",
      dateTo: "not-a-date",
      page: "0",
    }

    expect(readPpaListFilterState(query)).toEqual({
      estado: "pendientes",
      worksiteId: "north",
      search: "riesgo",
      dateFrom: "2026-07-01",
      dateTo: "",
    })
    expect(readPpaListPage(query)).toBe(1)
  })

  it("carries the list context into a detail and only accepts a PPA return URL", () => {
    const state = { estado: "pendientes", worksiteId: "north", search: "", dateFrom: "", dateTo: "" }
    expect(buildPpaDetailHref("ppa-1", state)).toBe("/prevencion/ppa/ppa-1?returnTo=%2Fprevencion%2Fppa%3Festado%3Dpendientes%26worksiteId%3Dnorth")
    expect(readPpaReturnHref("/prevencion/ppa?estado=pendientes")).toBe("/prevencion/ppa?estado=pendientes")
    expect(readPpaReturnHref("https://untrusted.example")).toBe("/prevencion/ppa")
  })
})
