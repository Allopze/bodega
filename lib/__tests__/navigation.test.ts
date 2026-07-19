import { describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import { AREA_TREE, flattenNavTargets, getVisibleAreas, isHrefActive } from "@/components/layout/nav-items"
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

  it("uses the fallback when decodeURIComponent throws an error on malformed paths", () => {
    expect(safeInternalPath("%")).toBe("/dashboard")
    expect(safeInternalPath("%E0%A4")).toBe("/dashboard")
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
      isGlobal: true,
    },
    expires: "2030-01-01T00:00:00.000Z",
  } satisfies Session

  it("no longer exposes standalone repuestos/servicios nav entries (folded into Solicitudes)", () => {
    const visibleItems = getVisibleAreas(adminSession).flatMap((area) => area.items)
    const commandTargets = flattenNavTargets(adminSession)

    expect(visibleItems.map((item) => item.href)).not.toContain("/repuestos")
    expect(visibleItems.map((item) => item.href)).not.toContain("/servicios")
    expect(commandTargets.map((target) => target.href)).not.toContain("/repuestos")
    expect(commandTargets.map((target) => target.href)).not.toContain("/servicios")
  })

  it("shows analytics under reportes when the user has analytics permission", () => {
    const session = {
      ...adminSession,
      user: {
        ...adminSession.user,
        permissions: ["analytics:view"],
      },
    } satisfies Session

    const reportArea = getVisibleAreas(session).find((area) => area.id === "reportes")
    const commandTargets = flattenNavTargets(session)

    expect(reportArea?.items.map((item) => item.href)).toContain("/analitica")
    expect(commandTargets.map((target) => target.href)).toContain("/analitica")
  })

  it("renders Prevención as a flat list of module destinations", () => {
    const session = {
      ...adminSession,
      user: {
        ...adminSession.user,
        permissions: [
          "sst:view",
          "ppa:view",
          "prevention:pdtp:view",
          "prevention:pdtp:approve",
          "prevention:docs:view",
          "prevention:indicadores:view",
        ],
      },
    } satisfies Session

    const prevention = getVisibleAreas(session).find((area) => area.id === "prevencion")
    expect(prevention?.items.map((item) => item.label)).toEqual([
      "Evaluaciones SST",
      "Para, Piensa y Actúa",
      "Programa preventivo SG-SST",
      "Documentación",
      "Indicadores de accidentabilidad",
    ])
    expect(prevention?.items.map((item) => item.href)).not.toContain("/prevencion")
    expect(prevention?.items.find((item) => item.href === "/prevencion/pdtp")?.children?.map((item) => item.label)).toEqual([
      "Aprobaciones",
      "Acciones correctivas",
      "Cobertura MIPER y legal",
    ])
  })

  it("hides the Prevención area when no prevention module is visible", () => {
    const prevention = getVisibleAreas(adminSession).find((area) => area.id === "prevencion")
    expect(prevention).toBeUndefined()
  })

  it("hides the Prevención area when its visible module is disabled by feature toggle", () => {
    const session = {
      ...adminSession,
      user: { ...adminSession.user, permissions: ["sst:view"] },
    } satisfies Session

    const prevention = getVisibleAreas(session, new Set(["ppa", "prevention"]))
      .find((area) => area.id === "prevencion")

    expect(prevention).toBeUndefined()
  })

  it("keeps Evaluaciones SST active for its list, creation and worker detail routes only", () => {
    expect(isHrefActive("/prevencion/evaluaciones", "/prevencion/evaluaciones")).toBe(true)
    expect(isHrefActive("/prevencion/evaluaciones", "/prevencion/nueva")).toBe(true)
    expect(isHrefActive("/prevencion/evaluaciones", "/prevencion/trabajador/worker-123")).toBe(true)
    expect(isHrefActive("/prevencion/evaluaciones", "/prevencion/evaluation-123")).toBe(true)
    expect(isHrefActive("/prevencion/evaluaciones", "/prevencion/pdtp")).toBe(false)
    expect(isHrefActive("/prevencion/evaluaciones", "/prevencion/pdtp/cronograma")).toBe(false)
    expect(isHrefActive("/prevencion/evaluaciones", "/prevencion/documentacion")).toBe(false)
    expect(isHrefActive("/prevencion/evaluaciones", "/prevencion/indicadores")).toBe(false)
    expect(isHrefActive("/prevencion/evaluaciones", "/prevencion/ppa")).toBe(false)
  })

  it("keeps Programa and its internal destinations mutually active", () => {
    // Exact match should be active
    expect(isHrefActive("/prevencion/pdtp", "/prevencion/pdtp")).toBe(true)
    // Sub-rutas propias del programa permanecen activas en el padre.
    expect(isHrefActive("/prevencion/pdtp", "/prevencion/pdtp/nuevo")).toBe(true)
    expect(isHrefActive("/prevencion/pdtp", "/prevencion/pdtp/prog-123")).toBe(true)
    expect(isHrefActive("/prevencion/pdtp", "/prevencion/pdtp/prog-123/editar")).toBe(true)
    // Destinos internos: el padre no se marca activo, el hijo correspondiente sí.
    expect(isHrefActive("/prevencion/pdtp", "/prevencion/pdtp/acciones")).toBe(false)
    expect(isHrefActive("/prevencion/pdtp", "/prevencion/pdtp/acciones?page=1")).toBe(false)
    expect(isHrefActive("/prevencion/pdtp", "/prevencion/pdtp/aprobaciones")).toBe(false)
    expect(isHrefActive("/prevencion/pdtp/aprobaciones", "/prevencion/pdtp/aprobaciones")).toBe(true)
    expect(isHrefActive("/prevencion/pdtp/acciones", "/prevencion/pdtp/acciones")).toBe(true)
  })

  it("never marks a registered parent destination active when a more-specific destination owns the route", () => {
    const navHrefs = AREA_TREE.flatMap((area) => area.items.flatMap((item) => [
      item.href,
      ...(item.children?.map((child) => child.href) ?? []),
    ]))
    const parentChildPairs = navHrefs.flatMap((parentHref) =>
      navHrefs
        .filter((childHref) => childHref.startsWith(`${parentHref}/`))
        .map((childHref) => [parentHref, childHref] as const),
    )

    // This is registry-driven: a future manifest that adds a nested sidebar
    // destination is included automatically in this regression check.
    expect(new Set(navHrefs).size).toBe(navHrefs.length)
    expect(parentChildPairs).not.toHaveLength(0)
    for (const [parentHref, childHref] of parentChildPairs) {
      expect(isHrefActive(parentHref, childHref)).toBe(false)
      expect(isHrefActive(childHref, childHref)).toBe(true)
      expect(isHrefActive(parentHref, `${childHref}/detail`)).toBe(false)
      expect(isHrefActive(childHref, `${childHref}/detail`)).toBe(true)
    }
  })
})
