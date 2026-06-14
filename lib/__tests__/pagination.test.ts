import { describe, expect, it } from "vitest"
import { buildPaginationHref, buildPageWindow, resolvePagination } from "@/lib/pagination"

describe("pagination helpers", () => {
  it("normalizes invalid page params to the first page", () => {
    expect(resolvePagination({ pageParam: undefined, totalItems: 120, pageSize: 25 })).toMatchObject({
      page: 1,
      totalPages: 5,
      offset: 0,
      limit: 25,
    })
    expect(resolvePagination({ pageParam: "x", totalItems: 120, pageSize: 25 }).page).toBe(1)
    expect(resolvePagination({ pageParam: "-4", totalItems: 120, pageSize: 25 }).page).toBe(1)
  })

  it("clamps oversized page params to the last page", () => {
    expect(resolvePagination({ pageParam: "99", totalItems: 120, pageSize: 25 })).toMatchObject({
      page: 5,
      totalPages: 5,
      offset: 100,
      limit: 25,
      from: 101,
      to: 120,
    })
  })

  it("keeps empty result sets on page one with zero ranges", () => {
    expect(resolvePagination({ pageParam: "3", totalItems: 0, pageSize: 25 })).toEqual({
      page: 1,
      totalItems: 0,
      totalPages: 1,
      offset: 0,
      limit: 25,
      from: 0,
      to: 0,
    })
  })

  it("builds compact page windows", () => {
    expect(buildPageWindow(1, 3)).toEqual([1, 2, 3])
    expect(buildPageWindow(5, 10)).toEqual([1, "…", 4, 5, 6, "…", 10])
    expect(buildPageWindow(9, 10)).toEqual([1, "…", 8, 9, 10])
  })

  it("builds page hrefs while preserving existing query params", () => {
    const params = {
      creadas: "2",
      page: "4",
      tags: ["a", "b"],
      empty: undefined,
    }

    expect(buildPaginationHref("/compras", params, 1)).toBe("/compras?creadas=2&tags=a&tags=b")
    expect(buildPaginationHref("/compras", params, 3)).toBe("/compras?creadas=2&tags=a&tags=b&page=3")
  })
})
