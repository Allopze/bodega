import { describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import { AREA_TREE, flattenNavTargets, getVisibleAreas, isHrefActive } from "@/components/layout/nav-items"
import { NAV_GROUP_ORDER } from "@/components/layout/areas"
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
    // El orden lo fija NAV_GROUP_ORDER, no el orden de registro de los módulos:
    // "Programa de trabajo" (módulo prevention) va antes que Evaluaciones SST y
    // PPA aunque sst/ppa se registren primero en modules/registry.ts.
    expect(prevention?.items.map((item) => item.label)).toEqual([
      "Programa de trabajo",
      "Evaluaciones SST",
      "Para, Piensa y Actúa",
      "Indicadores SST",
      "Daño material y ambiental",
      "Registro documental",
    ])
    expect(prevention?.items.map((item) => item.href)).not.toContain("/prevencion")

    const pdtp = prevention?.items.find((item) => item.href === "/prevencion/pdtp")
    expect(pdtp?.children?.map((item) => item.label)).toEqual([
      "Actividades",
      "Programas anuales",
      "A demanda y por evento",
      "Medidas",
      "Cobertura MIPER y legal",
      "Aplicabilidad",
      "Cierres mensuales",
      "Aprobaciones",
    ])
    // El item padre ya lleva al dashboard: ningún hijo debe repetir su href, o el
    // sidebar pinta la fila dos veces y resalta padre e hijo a la vez.
    expect(pdtp?.children?.map((item) => item.href)).not.toContain("/prevencion/pdtp")
    // Estas dos vistas quedaron sin entrada de navegación al consolidar el
    // sidebar y no había ningún otro enlace hacia ellas en la aplicación.
    expect(pdtp?.children?.map((item) => item.href)).toEqual(expect.arrayContaining([
      "/prevencion/pdtp/actividades",
      "/prevencion/pdtp/obligaciones",
      "/prevencion/pdtp/cobertura",
    ]))
  })

  it("keeps the legacy campaign route out of navigation without hijacking Evaluaciones", () => {
    const session = {
      ...adminSession,
      user: {
        ...adminSession.user,
        permissions: ["prevention:campaign:view", "prevention:privacy:manage_requests"],
      },
    } satisfies Session

    const prevention = getVisibleAreas(session).find((area) => area.id === "prevencion")
    const privacy = prevention?.items.find((item) => item.href === "/prevencion/privacidad")

    expect(prevention?.items.map((item) => item.href)).toContain("/prevencion/privacidad")
    expect(prevention?.items.map((item) => item.href)).not.toContain("/prevencion/campanas")
    expect(privacy?.children?.map((item) => item.href)).toEqual(["/prevencion/privacidad/solicitudes"])
    expect(isHrefActive("/prevencion/evaluaciones", "/prevencion/privacidad/solicitudes")).toBe(false)
    expect(isHrefActive("/prevencion/privacidad", "/prevencion/privacidad/solicitudes")).toBe(false)
    expect(isHrefActive("/prevencion/privacidad/solicitudes", "/prevencion/privacidad/solicitudes")).toBe(true)
  })

  // nav-rows.tsx pinta el encabezado de grupo cuando el grupo cambia respecto
  // al ítem anterior: un grupo partido en dos bloques se dibuja dos veces. Pasó
  // con "Gestión en terreno" al agregar ítems al final del manifest sin mirar
  // dónde caían. Este check falla apenas se reintroduce.
  it("keeps every nav group contiguous and in NAV_GROUP_ORDER", () => {
    for (const area of AREA_TREE) {
      const groups = area.items.map((item) => item.group ?? "")
      // Un área agrupa o no agrupa; a medias, los ítems sin grupo se van todos
      // al tope y el área queda con un bloque mudo antes del primer encabezado.
      if (groups.every((group) => group === "")) continue
      expect(groups.filter((group) => !NAV_GROUP_ORDER.includes(group)), `${area.id} usa grupos ausentes de NAV_GROUP_ORDER`).toEqual([])

      const blocks = groups.filter((group, index) => group !== groups[index - 1])
      expect(new Set(blocks).size, `${area.id} repite un encabezado de grupo`).toBe(blocks.length)

      const ranks = blocks.map((group) => NAV_GROUP_ORDER.indexOf(group))
      expect(ranks, `${area.id} tiene sus grupos fuera de NAV_GROUP_ORDER`)
        .toEqual([...ranks].sort((left, right) => left - right))
    }
  })

  // El mapa de riesgos (DS 44 art. 62) se trasladó a CGRD el 2026-09-22, pero
  // sigue siendo un destino propio: sin el desempate por prefijo más largo,
  // entrar al mapa dejaría las dos filas resaltadas.
  it("keeps CGRD and Mapa de riesgos as distinct destinations", () => {
    expect(isHrefActive("/prevencion/cgrd", "/prevencion/cgrd")).toBe(true)
    expect(isHrefActive("/prevencion/cgrd", "/prevencion/cgrd/mapa")).toBe(false)
    expect(isHrefActive("/prevencion/cgrd/mapa", "/prevencion/cgrd/mapa")).toBe(true)
    expect(isHrefActive("/prevencion/cgrd/mapa", "/prevencion/cgrd")).toBe(false)
    // Las subrutas de la MIPER siguen perteneciendo a la MIPER.
    expect(isHrefActive("/prevencion/miper", "/prevencion/miper/controles/ctl-1")).toBe(true)
  })

  // El mapa exige `prevention:risk:view`, no el permiso del CGRD que lo aloja:
  // sus marcadores son entradas de la matriz IPER. admin_contrato tiene
  // cgrd:view y no risk:view, así que no debe ver la fila — y el CGRD sí.
  it("hides the risk map from a role with cgrd:view but no risk:view", () => {
    const session = {
      ...adminSession,
      user: { ...adminSession.user, permissions: ["prevention:cgrd:view"] },
    } satisfies Session

    const prevention = getVisibleAreas(session).find((area) => area.id === "prevencion")
    const cgrd = prevention?.items.find((item) => item.href === "/prevencion/cgrd")

    expect(cgrd, "el CGRD debe seguir visible").toBeDefined()
    expect(cgrd?.children?.some((child) => child.href === "/prevencion/cgrd/mapa") ?? false).toBe(false)
  })

  // El contrapunto del test anterior: sin esto, aquél pasaría igual si la
  // navegación del CGRD se rompiera entera y el mapa desapareciera para todos.
  it("shows the risk map to a role holding both cgrd:view and risk:view", () => {
    const session = {
      ...adminSession,
      user: { ...adminSession.user, permissions: ["prevention:cgrd:view", "prevention:risk:view"] },
    } satisfies Session

    const prevention = getVisibleAreas(session).find((area) => area.id === "prevencion")
    const cgrd = prevention?.items.find((item) => item.href === "/prevencion/cgrd")

    expect(cgrd?.children?.some((child) => child.href === "/prevencion/cgrd/mapa")).toBe(true)
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

  it("hides only the disabled submodule from sidebar and command palette", () => {
    const session = {
      ...adminSession,
      user: {
        ...adminSession.user,
        permissions: ["combustibles:view", "combustibles:import", "combustibles:tae_view"],
      },
    } satisfies Session
    const enabled = new Set(["combustibles"])
    const disabled = new Set(["/combustibles/tae"])
    const hrefs = getVisibleAreas(session, enabled, disabled)
      .flatMap((area) => area.items.map((item) => item.href))
    const targets = flattenNavTargets(session, enabled, disabled).map((target) => target.href)

    expect(hrefs).toContain("/combustibles")
    expect(hrefs).toContain("/combustibles/importar")
    expect(hrefs).not.toContain("/combustibles/tae")
    expect(targets).not.toContain("/combustibles/tae")
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
