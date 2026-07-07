/**
 * Unit tests for the /prevencion/ppa filter-state → server-filters builder
 * (Task 2 of the 2026-07-06 search-consistency plan).
 */

import { describe, it, expect } from "vitest"
import { buildPpaListFilters } from "@/app/(app)/prevencion/ppa/list-filters"

const EMPTY = { estado: "", worksiteId: "", search: "", dateFrom: "", dateTo: "" }

describe("buildPpaListFilters()", () => {
  it("returns all-undefined filters for empty state", () => {
    expect(buildPpaListFilters(EMPTY)).toEqual({
      estado: undefined,
      worksiteId: undefined,
      search: undefined,
      dateFrom: undefined,
      dateTo: undefined,
    })
  })

  it("drops a blank/whitespace-only search", () => {
    expect(buildPpaListFilters({ ...EMPTY, search: "   " }).search).toBeUndefined()
  })

  it("trims a non-empty search", () => {
    expect(buildPpaListFilters({ ...EMPTY, search: "  Juan Pérez  " }).search).toBe("Juan Pérez")
  })

  it("passes estado and worksiteId through unchanged", () => {
    const result = buildPpaListFilters({ ...EMPTY, estado: "pendientes", worksiteId: "ws-1" })
    expect(result.estado).toBe("pendientes")
    expect(result.worksiteId).toBe("ws-1")
  })

  it("converts dateFrom to a start-of-day ISO string", () => {
    const result = buildPpaListFilters({ ...EMPTY, dateFrom: "2026-07-01" })
    expect(result.dateFrom).toBe(new Date("2026-07-01T00:00:00").toISOString())
  })

  it("converts dateTo to an end-of-day ISO string", () => {
    const result = buildPpaListFilters({ ...EMPTY, dateTo: "2026-07-01" })
    expect(result.dateTo).toBe(new Date("2026-07-01T23:59:59.999").toISOString())
  })
})
