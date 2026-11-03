import { describe, expect, it } from "vitest"
import { hasServerListFilters, SERVER_LIST_FILTER_PARAMS } from "@/components/ui/server-list-filters"

describe("ServerListFilters", () => {
  it("recognizes every server-side filter and ignores unrelated query params", () => {
    expect(SERVER_LIST_FILTER_PARAMS).toEqual([
      "q", "estado", "urgencia", "faena", "proveedor", "factura", "desde", "hasta", "solicitud", "antiguedad",
    ])
    expect(hasServerListFilters(new URLSearchParams("vista=oc"))).toBe(false)
    expect(hasServerListFilters(new URLSearchParams("factura=pendiente"))).toBe(true)
    expect(hasServerListFilters(new URLSearchParams("solicitud=req-1"))).toBe(true)
    // El tramo de antigüedad de Aprobaciones también acota la lista: sin contarlo,
    // «Limpiar filtros» no lo quitaba y una cola vacía por ese filtro decía «Todo al día».
    expect(hasServerListFilters(new URLSearchParams("antiguedad=2-3"))).toBe(true)
  })
})
