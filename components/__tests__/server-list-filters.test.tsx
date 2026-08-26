import { describe, expect, it } from "vitest"
import { hasServerListFilters, SERVER_LIST_FILTER_PARAMS } from "@/components/ui/server-list-filters"

describe("ServerListFilters", () => {
  it("recognizes every server-side filter and ignores unrelated query params", () => {
    expect(SERVER_LIST_FILTER_PARAMS).toEqual([
      "q", "estado", "urgencia", "faena", "proveedor", "factura", "desde", "hasta", "solicitud",
    ])
    expect(hasServerListFilters(new URLSearchParams("vista=oc"))).toBe(false)
    expect(hasServerListFilters(new URLSearchParams("factura=pendiente"))).toBe(true)
    expect(hasServerListFilters(new URLSearchParams("solicitud=req-1"))).toBe(true)
  })
})
