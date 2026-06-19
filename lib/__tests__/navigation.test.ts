import { describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import { flattenNavTargets, getVisibleAreas } from "@/components/layout/nav-items"
import { safeInternalPath } from "@/lib/navigation"

describe("safeInternalPath", () => {
  it("uses the fallback when the value is missing", () => {
    expect(safeInternalPath(null)).toBe("/dashboard")
    expect(safeInternalPath(undefined)).toBe("/dashboard")
    expect(safeInternalPath("")).toBe("/dashboard")
  })

  it("keeps valid internal paths", () => {
    expect(safeInternalPath("/solicitudes")).toBe("/solicitudes")
    expect(safeInternalPath("/compras/123?tab=items")).toBe("/compras/123?tab=items")
  })

  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeInternalPath("https://example.com/login")).toBe("/dashboard")
    expect(safeInternalPath("//example.com/login")).toBe("/dashboard")
  })

  it("rejects encoded unsafe values", () => {
    expect(safeInternalPath("%2F%2Fevil.test")).toBe("/dashboard")
    expect(safeInternalPath("%2Fdashboard%0D%0ASet-Cookie%3Afoo")).toBe("/dashboard")
  })
})

describe("sidebar navigation", () => {
  const adminSession = {
    user: {
      id: "user-test",
      name: "Admin",
      email: "admin@test.cl",
      roles: ["administrador"],
      permissions: [
        "repuestos:view_own",
        "repuestos:view_all",
        "servicios:view_own",
        "servicios:view_all",
      ],
      worksiteIds: [],
      primaryWorksiteId: null,
      avatarColor: null,
      isActive: true,
    },
    expires: "2030-01-01T00:00:00.000Z",
  } satisfies Session

  it("keeps repuestos and servicios out of sidebar-derived navigation", () => {
    const visibleItems = getVisibleAreas(adminSession).flatMap((area) => area.items)
    const commandTargets = flattenNavTargets(adminSession)

    expect(visibleItems.map((item) => item.href)).not.toEqual(expect.arrayContaining([
      "/repuestos",
      "/servicios",
    ]))
    expect(commandTargets.map((target) => target.href)).not.toEqual(expect.arrayContaining([
      "/repuestos",
      "/servicios",
    ]))
  })
})
