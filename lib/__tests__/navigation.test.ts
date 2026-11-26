import { describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import { AREA_TREE, findActiveArea, flattenNavTargets, getVisibleAreas, isHrefActive, visibleHrefsOf } from "@/components/layout/nav-items"
import { NAV_GROUP_ORDER } from "@/components/layout/areas"
import { NAV_ICONS } from "@/components/layout/nav-icons"
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

  it("nests the emergency plan under GRD and keeps it reachable without cgrd:view", () => {
    const grd = (permissions: string[]) => getVisibleAreas({
      ...adminSession,
      user: { ...adminSession.user, roles: ["jefe_mantencion"], permissions },
    }).flatMap((area) => area.items).find((item) => item.label === "Gestión de riesgos de desastres")

    // Con el permiso del comité, el padre abre su propia pantalla y el plan es un hijo.
    const full = grd(["prevention:cgrd:view", "prevention:emergency:view"])
    expect(full?.href).toBe("/prevencion/cgrd")
    expect(full?.children?.map((child) => child.href)).toContain("/prevencion/emergencias")

    // jefe_mantencion: responsable del plan (n=83) y sin cgrd:view. El padre se
    // conserva por su hijo y apunta a él en vez de mandar a /forbidden.
    const onlyEmergency = grd(["prevention:emergency:view"])
    expect(onlyEmergency?.href).toBe("/prevencion/emergencias")
    expect(onlyEmergency?.children?.map((child) => child.href)).toEqual(["/prevencion/emergencias"])

    expect(grd([])).toBeUndefined()
    const flat = getVisibleAreas({ ...adminSession, user: { ...adminSession.user, permissions: ["prevention:emergency:view"] } })
      .flatMap((area) => area.items)
    expect(flat.filter((item) => item.href === "/prevencion/emergencias" && item.label !== "Gestión de riesgos de desastres")).toEqual([])
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
    const disabled = new Set(["/combustibles/cuadratura"])
    const hrefs = getVisibleAreas(session, enabled, disabled)
      .flatMap((area) => area.items.map((item) => item.href))
    const targets = flattenNavTargets(session, enabled, disabled).map((target) => target.href)

    expect(hrefs).toContain("/combustibles")
    expect(hrefs).toContain("/combustibles/cargas")
    expect(hrefs).toContain("/combustibles/fuentes")
    expect(hrefs).not.toContain("/combustibles/cuadratura")
    expect(targets).not.toContain("/combustibles/cuadratura")
  })

  it("marks the fuel section that owns each subroute", () => {
    // El Panel es `/combustibles`, padre de todo el módulo: sólo se marca en su
    // propia URL, no en las secciones que cuelgan de él.
    expect(isHrefActive("/combustibles", "/combustibles")).toBe(true)
    expect(isHrefActive("/combustibles", "/combustibles/cargas")).toBe(false)
    expect(isHrefActive("/combustibles", "/combustibles/revisar")).toBe(false)
    // Las fichas y los asistentes quedan dentro de su sección.
    expect(isHrefActive("/combustibles/cargas", "/combustibles/cargas/registrar")).toBe(true)
    expect(isHrefActive("/combustibles/cargas", "/combustibles/cargas/terreno/s1/historial")).toBe(true)
    expect(isHrefActive("/combustibles/consumo", "/combustibles/consumo/equipos/v1")).toBe(true)
    expect(isHrefActive("/combustibles/pagos", "/combustibles/pagos/estados/st1")).toBe(true)
    expect(isHrefActive("/combustibles/fuentes", "/combustibles/fuentes/archivos/planilla/b1")).toBe(true)
    expect(isHrefActive("/combustibles/ajustes", "/combustibles/ajustes/puntos-de-carga")).toBe(true)
    expect(isHrefActive("/combustibles/cuadratura", "/combustibles/cuadratura/sellos")).toBe(true)
  })

  it("groups Control operacional as Seguimiento, then Flota, then Mantención, then Combustible", () => {
    const area = AREA_TREE.find((candidate) => candidate.id === "control-operacional")
    expect(area?.items.map((item) => [item.group ?? null, item.label])).toEqual([
      ["Seguimiento", "Panel operacional"],
      ["Flota", "Vehículos"],
      ["Flota", "Traslados"],
      ["Flota", "Turnos y ralentí"],
      ["Flota", "Conductores"],
      ["Flota", "Monitoreo GPS"],
      // GPS tiene su pantalla de Indicadores; en Mantención y Combustible los gráficos son el Panel.
      ["Flota", "Indicadores GPS"],
      ["Mantención", "Panel de mantención"],
      ["Mantención", "Órdenes de trabajo"],
      ["Mantención", "Notas de pedido"],
      ["Mantención", "Registros firmados"],
      // El Historial vive bajo `/mantencion/registros/historicos`: con ítem propio no se confunde con Registros firmados.
      ["Mantención", "Historial de mantenciones"],
      ["Mantención", "Equipos"],
      // Lo que se toca poco se pliega bajo un solo padre, sin permisos propios.
      ["Mantención", "Configuración"],
      // El catálogo es del módulo `repuestos` (apagable por separado de Mantención de
      // equipos), así que no puede colgar de un padre declarado por otro módulo:
      // queda como ítem propio al final del grupo.
      ["Mantención", "Catálogo de repuestos"],
      ["Combustible", "Panel de combustible"],
      ["Combustible", "Cargas"],
      ["Combustible", "Por revisar"],
      ["Combustible", "Cuadratura"],
      ["Combustible", "Consumo"],
      ["Combustible", "Facturas y pagos"],
      ["Combustible", "Configuración"],
    ])
  })

  describe("«Configuración» de Mantención y de Combustible", () => {
    const withPermissions = (permissions: string[]) => ({
      ...adminSession,
      user: { ...adminSession.user, roles: [], permissions },
    }) satisfies Session
    const configuracion = (session: Session, grupo: string) =>
      getVisibleAreas(session)
        .find((area) => area.id === "control-operacional")
        ?.items.find((item) => item.group === grupo && item.label === "Configuración")

    it("conserva en cada hijo exactamente los permisos que tenía como ítem suelto", () => {
      const area = AREA_TREE.find((candidate) => candidate.id === "control-operacional")
      const mantencion = area?.items.find((item) => item.group === "Mantención" && item.label === "Configuración")
      const combustible = area?.items.find((item) => item.group === "Combustible" && item.label === "Configuración")

      expect(mantencion?.children?.map((child) => [child.label, child.href, child.permissions])).toEqual([
        ["Pautas", "/mantencion/pautas", ["mant:schedules:manage"]],
        ["Marcas y talleres", "/mantencion/catalogos", ["mant:equipment:manage"]],
        // Antes «Dispositivos»: la pantalla lista los teléfonos con la app del mecánico y tiene «Instalar app del mecánico».
        ["App del mecánico", "/mantencion/dispositivos", ["mant:devices:manage"]],
      ])
      expect(combustible?.children?.map((child) => [child.label, child.href, child.permissions])).toEqual([
        ["Fuentes de datos", "/combustibles/fuentes", ["combustibles:import", "combustibles:tae_import", "combustibles:sync_integrations"]],
        ["Ajustes", "/combustibles/ajustes", ["combustibles:manage_control", "combustibles:manage_anomaly_rules", "combustibles:tae_manage_config", "combustibles:manage_integrations"]],
      ])
    })

    it("el padre existe sólo si la persona ve al menos un hijo y lleva al primero que ve", () => {
      expect(configuracion(withPermissions([]), "Mantención")).toBeUndefined()
      expect(configuracion(withPermissions(["mant:records:view_all"]), "Mantención")).toBeUndefined()

      const soloDispositivos = configuracion(withPermissions(["mant:devices:manage"]), "Mantención")
      expect(soloDispositivos?.href).toBe("/mantencion/dispositivos")
      expect(soloDispositivos?.children?.map((child) => child.href)).toEqual(["/mantencion/dispositivos"])

      const varios = configuracion(withPermissions(["mant:equipment:manage", "mant:devices:manage"]), "Mantención")
      expect(varios?.href).toBe("/mantencion/catalogos")
      expect(varios?.children?.map((child) => child.href)).toEqual(["/mantencion/catalogos", "/mantencion/dispositivos"])

      expect(configuracion(withPermissions(["combustibles:view"]), "Combustible")).toBeUndefined()
      expect(configuracion(withPermissions(["combustibles:manage_control"]), "Combustible")?.href).toBe("/combustibles/ajustes")
      expect(configuracion(withPermissions(["combustibles:tae_import", "combustibles:manage_control"]), "Combustible")?.href)
        .toBe("/combustibles/fuentes")
    })

    it("en ⌘K aparecen los hijos y no el contenedor, sin repetir destinos", () => {
      const session = withPermissions(["mant:schedules:manage", "mant:devices:manage", "combustibles:import", "combustibles:manage_control"])
      const targets = flattenNavTargets(session)
      expect(targets.filter((target) => target.label === "Configuración")).toEqual([])
      expect(targets.map((target) => target.href)).toEqual(expect.arrayContaining([
        "/mantencion/pautas",
        "/mantencion/dispositivos",
        "/combustibles/fuentes",
        "/combustibles/ajustes",
      ]))
      const hrefs = targets.map((target) => target.href)
      expect(new Set(hrefs).size).toBe(hrefs.length)
    })

    it("la ruta hija deja activa a su fila y no al contenedor", () => {
      expect(isHrefActive("/mantencion/catalogos", "/mantencion/catalogos")).toBe(true)
      expect(isHrefActive("/mantencion/configuracion", "/mantencion/catalogos")).toBe(false)
      expect(isHrefActive("/combustibles/ajustes", "/combustibles/ajustes/medios")).toBe(true)
      expect(isHrefActive("/combustibles/configuracion", "/combustibles/ajustes/medios")).toBe(false)
    })
  })

  describe("Mantención en el menú (auditoría de encontrabilidad 2026-11-26)", () => {
    const withPermissions = (permissions: string[]) => ({
      ...adminSession,
      user: { ...adminSession.user, roles: [], permissions },
    }) satisfies Session
    const mantencionItems = () =>
      AREA_TREE.find((area) => area.id === "control-operacional")!.items.filter((item) => item.group === "Mantención")
    const labelsOf = (session: Session) =>
      getVisibleAreas(session).flatMap((area) => area.items).filter((item) => item.group === "Mantención").map((item) => item.label)

    it("el Historial de mantenciones va justo después de Registros firmados y pide los permisos de su página", () => {
      const items = mantencionItems()
      const labels = items.map((item) => item.label)
      expect(labels.indexOf("Historial de mantenciones")).toBe(labels.indexOf("Registros firmados") + 1)
      const historial = items.find((item) => item.label === "Historial de mantenciones")
      expect(historial?.href).toBe("/mantencion/registros/historicos")
      expect(historial?.permissions).toEqual(["mant:records:view_worksite", "mant:records:view_all"])
      expect(NAV_ICONS[historial!.iconName]).toBeDefined()
    })

    it("lo ve quien puede abrir su página; quien sólo ve lo propio conserva Registros firmados y no el Historial", () => {
      expect(labelsOf(withPermissions(["mant:records:view_worksite"]))).toContain("Historial de mantenciones")
      expect(labelsOf(withPermissions(["mant:records:view_all"]))).toContain("Historial de mantenciones")
      const soloLoPropio = labelsOf(withPermissions(["mant:records:view_own"]))
      expect(soloLoPropio).toContain("Registros firmados")
      expect(soloLoPropio).not.toContain("Historial de mantenciones")
      expect(flattenNavTargets(withPermissions(["mant:records:view_own"])).map((target) => target.href)).not.toContain("/mantencion/registros/historicos")
    })

    it("sus rutas (importar y cada trabajo incluidos) marcan al Historial y no a Registros firmados; las de los registros, al revés", () => {
      for (const ruta of ["/mantencion/registros/historicos", "/mantencion/registros/historicos/importar", "/mantencion/registros/historicos/h-1", "/mantencion/registros/historicos?equipo=v-1"]) {
        expect(isHrefActive("/mantencion/registros/historicos", ruta), ruta).toBe(true)
        expect(isHrefActive("/mantencion/registros", ruta), ruta).toBe(false)
      }
      for (const ruta of ["/mantencion/registros", "/mantencion/registros/r-1", "/mantencion/registros?revision=todos"]) {
        expect(isHrefActive("/mantencion/registros", ruta), ruta).toBe(true)
        expect(isHrefActive("/mantencion/registros/historicos", ruta), ruta).toBe(false)
      }
    })

    it("en ⌘K el Historial aparece con su grupo, para distinguirlo de Registros firmados", () => {
      const target = flattenNavTargets(withPermissions(["mant:records:view_worksite"])).find((candidate) => candidate.href === "/mantencion/registros/historicos")
      expect(target).toMatchObject({ label: "Historial de mantenciones", areaLabel: "Control operacional", groupLabel: "Mantención" })
    })

    it("sólo «Configuración» de Mantención se pinta desplegada; los demás padres abren cuando la pantalla es suya", () => {
      const conDefaultOpen = AREA_TREE.flatMap((area) => area.items.filter((item) => item.defaultOpen).map((item) => `${area.id} · ${item.group} · ${item.label}`))
      expect(conDefaultOpen).toEqual(["control-operacional · Mantención · Configuración"])
      // El filtro por permiso conserva la marca, con uno o con varios hijos visibles.
      const configuracion = (session: Session) => getVisibleAreas(session).flatMap((area) => area.items).find((item) => item.group === "Mantención" && item.label === "Configuración")
      expect(configuracion(withPermissions(["mant:devices:manage"]))?.defaultOpen).toBe(true)
      expect(configuracion(withPermissions(["mant:schedules:manage", "mant:equipment:manage", "mant:devices:manage"]))?.defaultOpen).toBe(true)
    })

    it("«Equipos» ya no repite el ícono de «Vehículos» ni el de ningún otro ítem del área", () => {
      const area = AREA_TREE.find((candidate) => candidate.id === "control-operacional")!
      const equipos = area.items.find((item) => item.href === "/mantencion/equipos")!
      const vehiculos = area.items.find((item) => item.href === "/flota")!
      expect(equipos.iconName).not.toBe(vehiculos.iconName)
      expect(NAV_ICONS[equipos.iconName]).toBeDefined()
      expect(area.items.filter((item) => item !== equipos && item.iconName === equipos.iconName)).toEqual([])
    })

    describe("la ficha del equipo", () => {
      const ficha = "/flota/veh-1/mantencion"

      it("marca «Equipos» y no «Vehículos»; sus subrutas y parámetros siguen siendo de «Equipos»", () => {
        for (const ruta of [ficha, `${ficha}/historial`, `${ficha}?periodo=todo`]) {
          expect(isHrefActive("/mantencion/equipos", ruta), ruta).toBe(true)
          expect(isHrefActive("/flota", ruta), ruta).toBe(false)
        }
      })

      it("la ficha y sus otras pestañas siguen marcando «Vehículos»", () => {
        for (const ruta of ["/flota", "/flota/veh-1", "/flota/veh-1/flota", "/flota/veh-1/combustible", "/flota/mantencion"]) {
          expect(isHrefActive("/flota", ruta), ruta).toBe(true)
          expect(isHrefActive("/mantencion/equipos", ruta), ruta).toBe(false)
        }
      })

      it("el comodín vale por un solo segmento y no se escapa a otras rutas de Flota", () => {
        // `/flota/mantencion` es la ficha de un vehículo con ese id, no la ficha de mantención de uno cualquiera.
        expect(isHrefActive("/mantencion/equipos", "/flota/mantencion")).toBe(false)
        expect(isHrefActive("/mantencion/equipos", "/flota/veh-1/mantencionX")).toBe(false)
        expect(isHrefActive("/mantencion/equipos", "/flota//mantencion")).toBe(false)
        // Y la lista de equipos de Mantención sigue siendo suya.
        expect(isHrefActive("/mantencion/equipos", "/mantencion/equipos/e-1")).toBe(true)
      })

      it("quien no ve «Equipos» en su menú conserva «Vehículos» marcado, y el área activa sigue siendo Control operacional", () => {
        const sinEquipos = getVisibleAreas(withPermissions(["flota:view"]))
        const visibles = visibleHrefsOf(sinEquipos)
        expect(visibles).toContain("/flota")
        expect(visibles).not.toContain("/mantencion/equipos")
        expect(isHrefActive("/flota", ficha, visibles)).toBe(true)
        expect(isHrefActive("/mantencion/equipos", ficha, visibles)).toBe(false)
        expect(findActiveArea(sinEquipos, ficha)).toBe("control-operacional")
      })

      it("quien ve los dos tiene marcado sólo «Equipos»", () => {
        const conEquipos = getVisibleAreas(withPermissions(["flota:view", "mant:records:view_worksite"]))
        const visibles = visibleHrefsOf(conEquipos)
        expect(visibles).toContain("/mantencion/equipos")
        expect(isHrefActive("/mantencion/equipos", ficha, visibles)).toBe(true)
        expect(isHrefActive("/flota", ficha, visibles)).toBe(false)
        // Un prefijo SIN comodín no depende de lo visible: la ruta de un ítem oculto sigue siendo suya.
        expect(isHrefActive("/flota", "/flota/veh-1/combustible", new Set(["/flota"]))).toBe(true)
        expect(isHrefActive("/mantencion/registros", "/mantencion/registros/historicos", new Set(["/mantencion/registros"]))).toBe(false)
      })
    })
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

  /* FX-B (B8): la bandeja de incidentes exige `incidents:view`, pero el menú la
   * mostraba también con sólo `incidents:report`, y ese usuario terminaba en
   * /forbidden. Quien sólo reporta conserva su camino: la página de reporte. */
  it("shows the incidents inbox only with incidents:view and keeps the report page for report-only users", () => {
    const withPermissions = (permissions: string[]) => ({
      ...adminSession,
      user: { ...adminSession.user, roles: [], permissions },
    }) satisfies Session
    const hrefs = (session: Session) => flattenNavTargets(session).map((target) => target.href)

    const reportOnly = hrefs(withPermissions(["prevention:incidents:report"]))
    expect(reportOnly).not.toContain("/prevencion/incidentes")
    expect(reportOnly).toContain("/prevencion/incidentes/reportar")

    const viewer = hrefs(withPermissions(["prevention:incidents:view"]))
    expect(viewer).toContain("/prevencion/incidentes")
    expect(viewer).not.toContain("/prevencion/incidentes/reportar")

    const both = hrefs(withPermissions(["prevention:incidents:view", "prevention:incidents:report"]))
    expect(both.filter((href) => href === "/prevencion/incidentes")).toHaveLength(1)
    expect(both.filter((href) => href === "/prevencion/incidentes/reportar")).toHaveLength(1)
  })
})

