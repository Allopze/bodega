/**
 * El Panel de mantención es los Indicadores con la franja «Hoy» arriba (decisión del usuario
 * 2026-11-14). Se prueba el cableado de la página: qué se consulta según los permisos, el
 * estado vacío único y el Excel sólo con `mant:export`.
 */
import type { ReactNode } from "react"
import { isValidElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const session = vi.hoisted(() => ({ permissions: ["mant:records:view_all"] as string[] }))
const scope = vi.hoisted(() => ({ equipment: 3, records: 5, inWorkshop: 1 }))
const unassigned = vi.hoisted(() => vi.fn(async () => 2))
const partsNotes = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ rows: [], total: 0, counts: { pendientes: 5, en_gestion: 1, cerradas: 9 } })))
// Los cargadores de series quedan como espías: la página debe pasarles la ventana de los gráficos (`chart`).
// El equipo que `resolvePanelEquipment` reconoce dentro del alcance (como el servicio real: uno ajeno devuelve null).
const equipmentInScope = vi.hoisted(() => ({ id: "v-1", code: "KA-1", plate: "AAAA-01", worksiteId: "ws-1", label: "KA-1 · AAAA-01" }))
const work = vi.hoisted(() => ({
  load: vi.fn(async (..._args: unknown[]) => ({ rows: [], includesOrders: true })),
  compliance: vi.fn(async (..._args: unknown[]) => ({ checks: 0, withCompliance: 0, averagePercent: null })),
  findings: vi.fn(async (..._args: unknown[]) => ({ days: 7, total: 0, withWork: 0, withoutWork: 0, inWindow: 0, unlinked: 0, byEquipment: [] })),
}))
const reporteEquipos = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ hasRuns: true })))
const loaders = vi.hoisted(() => ({
  series: vi.fn(async (..._args: unknown[]) => [{ key: "2026-10", created: 1, closed: 0, backlog: 1 }]),
  records: vi.fn(async (..._args: unknown[]) => ({ points: [{ key: "2026-10", preventive: scope.records, corrective: 0, partial: false }], preventive: scope.records, preventivePrevious: 0 })),
  outOfService: vi.fn(async (..._args: unknown[]) => ({ points: [], total: 0, totalPrevious: 0 })),
}))

vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("@/lib/auth/can", () => ({
  requireAnyPermission: async () => ({ user: { id: "u-1", permissions: session.permissions } }),
  can: (current: { user?: { permissions?: string[] } } | null, permission: string) => Boolean(current?.user?.permissions?.includes(permission)),
}))
// El alcance de equipos sale de los permisos, como en el servicio real: `view_all` abre todas las faenas.
vi.mock("@/lib/services/mantencion/access", () => ({
  viewerFromSession: () => ({ userId: "u-1" }),
  equipmentScope: () => (session.permissions.includes("mant:records:view_all") ? "all" : ["ws-1"]),
}))
vi.mock("@/lib/services/mantencion/panel", () => ({
  loadPanelWorksites: async () => [{ id: "ws-1", name: "Biodiversa" }, { id: "ws-2", name: "Cholguán" }],
  countPendingReview: async () => 4,
}))
vi.mock("@/lib/services/mantencion/work-orders/query", () => ({ countUnassignedWorkOrders: unassigned }))
vi.mock("@/lib/services/mantencion/parts-notes/query", () => ({ listPartsNotes: partsNotes }))
vi.mock("@/lib/services/mantencion/indicators", () => ({
  loadWorkOrderSeries: loaders.series,
  loadWorkOrderPeriodStats: async () => ({}),
  loadOpenWorkOrdersByStatus: async () => [],
  loadTopRepairEquipment: async () => [],
  loadPautaState: async () => ({ counts: {}, total: scope.equipment, inWorkshop: scope.inWorkshop, inWorkshopByOrder: scope.inWorkshop }),
  loadRecordIndicators: loaders.records,
  loadOutOfService: loaders.outOfService,
}))
vi.mock("@/lib/services/mantencion/maintenance-work", () => ({
  loadMaintenanceWork: work.load,
  loadScheduleCompliance: work.compliance,
  loadFindingsWithoutWork: work.findings,
  loadPanelEquipment: async () => [{ id: "v-1", label: "KA-1 · AAAA-01" }],
  resolvePanelEquipment: async (_viewer: unknown, _worksite: unknown, id: string | undefined) => (id === equipmentInScope.id ? equipmentInScope : null),
  summarizeMaintenanceWork: (rows: unknown[]) => ({ total: rows.length, series: [] as Array<Record<string, number>> }),
}))
vi.mock("@/lib/services/mantencion/reporte-equipos", () => ({ loadReporteEquipos: reporteEquipos }))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null, Breadcrumbs: () => null }))
vi.mock("./indicators-sections", () => ({ WorkOrdersSection: () => null, PautasSection: () => null }))
vi.mock("./reporte-equipos-section", () => ({ ReporteEquiposSection: () => null }))
vi.mock("./trinorma-sections", () => ({ MaintenanceWorkSection: () => null, FormsIndicatorsSection: () => null }))
vi.mock("@/components/mantencion/jefatura/panel/panel-export", () => ({ PanelExcelButton: () => null, PanelPdfLink: () => null }))
// Las tres pestañas nuevas leen su contexto (filtros, opciones y filtros cruzados) con `loadLookerContext`.
vi.mock("@/lib/services/mantencion/looker/resolve", () => ({
  loadLookerContext: async (_viewer: unknown, raw: Record<string, string>) => ({
    filters: {
      tab: raw.pestana, unit: raw.unidad === "h" ? "h" : "km", from: "2026-11-01", to: "2026-11-10", requestedFrom: "2026-11-01", requestedTo: "2026-11-10", invalidPeriod: false,
      worksiteIds: [], equipmentIds: [], frequencies: [], page: 1, cross: {},
      planningState: null, dateField: "proxima", dateFrom: null, dateTo: null, invalidDateRange: raw.fecha_hasta === "malo",
      sheetVehicleId: null, sheetCheckId: null,
    },
    options: { worksites: [], equipment: [], frequencies: [] },
    cross: {},
  }),
}))
vi.mock("@/components/mantencion/panel/looker/looker-export-button", () => ({ LookerExcelButton: () => null }))
// Las pestañas consultan la base al renderizarse; aquí se prueba sólo el despacho.
vi.mock("./planificacion-tab", () => ({ PlanificacionTab: () => null }))
vi.mock("./correctivo-tab", () => ({ CorrectivoTab: () => null }))
vi.mock("./preventivo-tab", () => ({ PreventivoTab: () => null }))
vi.mock("@/components/mantencion/panel/looker/planning-date-filter", () => ({ PlanningDateFilter: () => null }))
vi.mock("@/components/mantencion/jefatura/panel/panel-equipment-filter", () => ({ PanelEquipmentFilter: () => null }))

import MantencionPanelPage from "./page"
import { BoardHeaderActions } from "@/components/dashboard/board-scope"
import { PageHeader } from "@/components/ui/page-header"
import { PanelTabs } from "@/components/mantencion/panel/looker/panel-tabs"
import { LookerExcelButton } from "@/components/mantencion/panel/looker/looker-export-button"
import { PanelEmptyState } from "@/components/mantencion/jefatura/panel/panel-empty"
import { PanelExcelButton, PanelPdfLink } from "@/components/mantencion/jefatura/panel/panel-export"
import { PanelToday } from "@/components/mantencion/jefatura/panel/panel-today"
import { PautasSection, WorkOrdersSection } from "./indicators-sections"
import { CorrectivoTab } from "./correctivo-tab"
import { PlanificacionTab } from "./planificacion-tab"
import { PreventivoTab } from "./preventivo-tab"
import { PlanningDateFilter } from "@/components/mantencion/panel/looker/planning-date-filter"
import { Callout } from "@/components/ui/callout"
import { FormsIndicatorsSection, MaintenanceWorkSection } from "./trinorma-sections"
import { ReporteEquiposSection } from "./reporte-equipos-section"

afterEach(() => {
  vi.useRealTimers()
  session.permissions = ["mant:records:view_all"]
  Object.assign(scope, { equipment: 3, records: 5, inWorkshop: 1 })
  unassigned.mockClear()
  partsNotes.mockClear()
})

type Found = { props: Record<string, unknown> }
function findElement(node: ReactNode, type: unknown): Found | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child as ReactNode, type)
      if (found) return found
    }
    return null
  }
  if (!isValidElement(node)) return null
  if (node.type === type) return node as unknown as Found
  return findElement((node.props as { children?: ReactNode }).children, type)
}

const page = (searchParams: Record<string, string> = {}) => MantencionPanelPage({ searchParams: Promise.resolve(searchParams) })

describe("/mantencion/panel · menú de pestañas", () => {
  // Sin este menú, desde el Panel por defecto no se llega a Planificación, Correctivo ni Preventivo
  // si no es escribiendo la URL (verificado en navegador el 2026-11-24).
  it("la pestaña Hoy, por defecto y con ?pestana=hoy, ofrece el menú para llegar a las otras tres", async () => {
    const cases: Array<Record<string, string>> = [{}, { pestana: "hoy" }]
    for (const params of cases) {
      const tabs = findElement(await page(params), PanelTabs)
      expect(tabs, JSON.stringify(params)).not.toBeNull()
      expect(tabs!.props).toMatchObject({ active: "hoy" })
    }
  })

  // PAN4-9 (2026-11-26): los enlaces llevaban sólo `pestana` y cambiar de pestaña borraba el período y la faena.
  it("el menú recibe los parámetros de la URL en las cuatro pestañas, para conservar la unidad, el período y la faena", async () => {
    const params = { unidad: "h", desde: "2026-01-01", hasta: "2026-10-31", faena: "ws-1", x_equipo: "v-1" }
    for (const pestana of [undefined, "hoy", "planificacion", "correctivo", "preventivo"]) {
      const tabs = findElement(await page({ ...params, ...(pestana ? { pestana } : {}) }), PanelTabs)
      expect(tabs, String(pestana)).not.toBeNull()
      expect(tabs!.props.params, String(pestana)).toMatchObject(params)
    }
  })

  it("la miga nombra la pestaña y la pregunta va bajo las pestañas (no en la descripción de la cabecera)", async () => {
    for (const [pestana, label] of [["planificacion", "Planificación"], ["correctivo", "Correctivo"], ["preventivo", "Preventivo"]] as const) {
      const header = findElement(await page({ pestana }), PageHeader)!
      const items = (header.props.breadcrumb as { props: { items: Array<{ label: string }> } }).props.items
      expect(items.at(-1)!.label).toBe(label)
      expect(header.props.description).toBeUndefined()
    }
  })

  it("despacha cada pestaña a su componente con el contexto y la URL", async () => {
    const cases = [["planificacion", PlanificacionTab], ["correctivo", CorrectivoTab], ["preventivo", PreventivoTab]] as const
    for (const [pestana, component] of cases) {
      const tree = await page({ pestana, unidad: "h" })
      const found = findElement(tree, component)
      expect(found, pestana).not.toBeNull()
      expect(found!.props).toMatchObject({ rawParams: { pestana, unidad: "h" } })
      for (const [other, otherComponent] of cases) if (other !== pestana) expect(findElement(tree, otherComponent), `${pestana}→${other}`).toBeNull()
    }
  })

  it("el filtro por fechas va en la barra sólo en Planificación, y un rango malo se avisa", async () => {
    expect(findElement(await page({ pestana: "planificacion" }), PlanningDateFilter)).not.toBeNull()
    expect(findElement(await page({ pestana: "correctivo" }), PlanningDateFilter)).toBeNull()
    expect(findElement(await page({ pestana: "planificacion", fecha_hasta: "malo" }), Callout)).not.toBeNull()
    expect(findElement(await page({ pestana: "planificacion" }), Callout)).toBeNull()
  })

  it("un enlace guardado con `pestana=camiones|maquinas` redirige a Correctivo con su unidad y el resto de los parámetros", async () => {
    await expect(page({ pestana: "camiones", desde: "2026-10-01", faena: "ws-1" })).rejects.toThrow("redirect:/mantencion/panel?desde=2026-10-01&faena=ws-1&pestana=correctivo")
    await expect(page({ pestana: "maquinas", x_conductor: "JUAN" })).rejects.toThrow("redirect:/mantencion/panel?x_conductor=JUAN&pestana=correctivo&unidad=h")
  })

  it("el menú también se ofrece cuando no hay equipos en el alcance", async () => {
    Object.assign(scope, { equipment: 0, records: 0, inWorkshop: 0 })
    reporteEquipos.mockResolvedValueOnce({ hasRuns: false })
    const tree = await page()
    expect(findElement(tree, PanelEmptyState)).not.toBeNull()
    expect(findElement(tree, PanelTabs)!.props).toMatchObject({ active: "hoy" })
  })
})

describe("/mantencion/panel · franja «Hoy» y gráficos", () => {
  it("con permiso de órdenes la franja trae las órdenes por asignar y se pintan los gráficos de OT", async () => {
    session.permissions = ["mant:records:view_all", "mant:ot:view_all"]
    const tree = await page()
    expect(findElement(tree, PanelToday)!.props).toMatchObject({ unassignedOrders: 2, inWorkshop: 1, pendingReview: 4, worksiteId: null })
    expect(findElement(tree, WorkOrdersSection)).not.toBeNull()
  })

  it("sin permiso de órdenes no se consultan ni se ofrecen", async () => {
    const tree = await page()
    expect(unassigned).not.toHaveBeenCalled()
    expect(findElement(tree, PanelToday)!.props.unassignedOrders).toBeNull()
    expect(findElement(tree, WorkOrdersSection)).toBeNull()
  })

  it("con permiso de notas de pedido la franja trae las pendientes (la cifra de la pestaña, sin traer filas)", async () => {
    session.permissions = ["mant:records:view_all", "mant:np:view_worksite"]
    const tree = await page({ faena: "ws-2" })
    expect(findElement(tree, PanelToday)!.props.pendingPartsNotes).toBe(5)
    expect(partsNotes).toHaveBeenCalledWith(expect.anything(), { tab: "pendientes", worksiteId: "ws-2", page: 1, pageSize: 1 })
  })

  it("sin permiso de notas de pedido no se consultan ni se ofrecen; quien administra también las ve", async () => {
    const tree = await page()
    expect(partsNotes).not.toHaveBeenCalled()
    expect(findElement(tree, PanelToday)!.props.pendingPartsNotes).toBeNull()
    session.permissions = ["mant:records:view_all", "mant:np:manage"]
    expect(findElement(await page(), PanelToday)!.props.pendingPartsNotes).toBe(5)
  })

  it("con un equipo elegido la franja no se pinta y las notas de pedido tampoco se consultan", async () => {
    session.permissions = ["mant:records:view_all", "mant:np:view_worksite"]
    await page({ equipo: "v-1" })
    expect(partsNotes).not.toHaveBeenCalled()
  })

  it("la faena elegida acota la franja; una faena fuera del alcance se ignora", async () => {
    session.permissions = ["mant:records:view_all", "mant:ot:view_all"]
    expect(findElement(await page({ faena: "ws-2" }), PanelToday)!.props.worksiteId).toBe("ws-2")
    expect(unassigned).toHaveBeenLastCalledWith(expect.anything(), "ws-2")
    expect(findElement(await page({ faena: "otra" }), PanelToday)!.props.worksiteId).toBeNull()
  })
})

describe("/mantencion/panel · ventana de los gráficos", () => {
  it("el mes en curso pide las series sobre los seis meses que terminan en él y las secciones reciben el pie de la ventana", async () => {
    session.permissions = ["mant:records:view_all", "mant:ot:view_all"]
    // Fecha fija: el mes «en curso» se corta en hoy y la ventana se cuenta hacia atrás desde ahí.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-15T15:00:00Z"))
    const tree = await page({ desde: "2026-11-01", hasta: "2026-11-30" })
    const query = loaders.series.mock.calls.at(-1)![1] as { from: string; to: string; chart: { from: string; to: string; granularity: string; isHistory: boolean } }
    // El período sigue siendo el mes (cortado en hoy); la serie mira seis meses, por mes.
    expect(query.from).toBe("2026-11-01")
    expect(query.to).toBe("2026-11-15")
    expect(query.chart).toMatchObject({ granularity: "month", isHistory: true })
    expect(query.chart.from).toBe("2026-06-01")
    expect(query.chart.to).toBe(query.to)
    expect(loaders.records.mock.calls.at(-1)![1]).toMatchObject({ chart: query.chart })
    expect(loaders.outOfService.mock.calls.at(-1)![1]).toMatchObject({ chart: query.chart })
    const props = findElement(tree, WorkOrdersSection)!.props
    expect(props.chart).toMatchObject({ isHistory: true })
    expect(props.chartNote).toMatch(/^Últimos 6 meses, hasta noviembre de 2026 · /)
    expect(String(props.scopeNote)).not.toMatch(/Últimos/)
  })
})

describe("/mantencion/panel · reportes de equipos", () => {
  it("se consulta con el período y la faena de la pantalla y la sección recibe los datos", async () => {
    const tree = await page({ desde: "2026-11-01", hasta: "2026-11-10", faena: "ws-2" })
    expect(reporteEquipos).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ from: "2026-11-01", to: "2026-11-10", worksiteId: "ws-2" }))
    const section = findElement(tree, ReporteEquiposSection)!
    expect(section.props).toMatchObject({ data: { hasRuns: true }, worksiteId: "ws-2", canViewInspections: false })
  })

  it("el enlace a Inspecciones sólo se ofrece con `prevention:inspections:view`", async () => {
    session.permissions = ["mant:records:view_all", "prevention:inspections:view"]
    expect(findElement(await page(), ReporteEquiposSection)!.props.canViewInspections).toBe(true)
  })

  it("si la consulta falla, la sección recibe null (la página avisa por el banner) y el resto del Panel sigue", async () => {
    reporteEquipos.mockRejectedValueOnce(new Error("sin base"))
    const tree = await page()
    expect(findElement(tree, ReporteEquiposSection)!.props.data).toBeNull()
    expect(findElement(tree, PanelToday)).not.toBeNull()
  })
})

describe("/mantencion/panel · Excel", () => {
  it("la cabecera lleva el control de faena y período; «Exportar Excel» sólo con `mant:export`", async () => {
    const without = findElement(await page(), PageHeader)!.props.actions as ReactNode
    expect(findElement(without, BoardHeaderActions)).not.toBeNull()
    expect(findElement(without, PanelExcelButton)).toBeNull()
    expect(findElement(without, PanelPdfLink)).toBeNull()
    session.permissions = ["mant:records:view_all", "mant:export"]
    const actions = findElement(await page({ faena: "ws-1", desde: "2026-11-01", hasta: "2026-11-10" }), PageHeader)!.props.actions as ReactNode
    expect(findElement(actions, BoardHeaderActions)!.props).toMatchObject({ worksiteId: "ws-1" })
    // Excel (con la hoja «Trabajos») y PDF reciben la misma faena y el mismo período que la pantalla.
    expect(findElement(actions, PanelExcelButton)!.props).toMatchObject({ title: "Panel de mantención", scope: { faena: "Biodiversa" }, range: { from: "2026-11-01", to: "2026-11-10" }, faena: "ws-1", equipo: null })
    expect(findElement(actions, PanelPdfLink)!.props).toMatchObject({ from: "2026-11-01", to: "2026-11-10", faena: "ws-1", equipo: null })
  })
})

describe("/mantencion/panel · rótulo de «todas las faenas»", () => {
  it("quien ve todas las faenas lee «Todas las faenas»; con alcance limitado, «Todas tus faenas»", async () => {
    session.permissions = ["mant:records:view_all", "mant:export"]
    const global = findElement(await page(), PageHeader)!.props.actions as ReactNode
    expect(findElement(global, BoardHeaderActions)!.props.allLabel).toBe("Todas las faenas")
    session.permissions = ["mant:records:view_worksite", "mant:export"]
    const limited = findElement(await page(), PageHeader)!.props.actions as ReactNode
    expect(findElement(limited, BoardHeaderActions)!.props.allLabel).toBe("Todas tus faenas")
  })
})

describe("/mantencion/panel · sin equipos en el alcance", () => {
  it("sin equipos ni registros muestra un solo estado vacío y no la franja ni los gráficos", async () => {
    Object.assign(scope, { equipment: 0, records: 0, inWorkshop: 0 })
    reporteEquipos.mockResolvedValueOnce({ hasRuns: false })
    const tree = await page()
    expect(findElement(tree, PanelEmptyState)).not.toBeNull()
    expect(findElement(tree, PanelToday)).toBeNull()
  })

  it("PANN-1: sin equipos pero con trabajos del historial, hallazgos o reportes de turno el Panel se dibuja", async () => {
    Object.assign(scope, { equipment: 0, records: 0, inWorkshop: 0 })
    // Trabajos del historial / OT.
    reporteEquipos.mockResolvedValueOnce({ hasRuns: false })
    work.load.mockResolvedValueOnce({ rows: [{}] as never[], includesOrders: true })
    expect(findElement(await page(), PanelEmptyState)).toBeNull()
    // Hallazgos de inspecciones (aunque su equipo no esté vinculado).
    reporteEquipos.mockResolvedValueOnce({ hasRuns: false })
    work.findings.mockResolvedValueOnce({ days: 7, total: 0, withWork: 0, withoutWork: 0, inWindow: 0, unlinked: 2, byEquipment: [] })
    expect(findElement(await page(), PanelEmptyState)).toBeNull()
    // Reportes de turno de equipos.
    expect(findElement(await page(), PanelEmptyState)).toBeNull()
  })

  it("con registros el panel se dibuja aunque la flota activa sea cero", async () => {
    Object.assign(scope, { equipment: 0, records: 2, inWorkshop: 0 })
    expect(findElement(await page(), PanelEmptyState)).toBeNull()
  })
})

describe("/mantencion/panel · trabajos de mantención y equipo elegido", () => {
  it("la sección de trabajos y la de pautas de formularios se pintan con el período y la faena de la pantalla", async () => {
    const tree = await page({ desde: "2026-11-01", hasta: "2026-11-10", faena: "ws-2" })
    expect(work.load).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ worksiteId: "ws-2", to: "2026-11-10" }))
    expect(findElement(tree, MaintenanceWorkSection)!.props).toMatchObject({ includesOrders: true, summary: { total: 0 } })
    expect(findElement(tree, FormsIndicatorsSection)).not.toBeNull()
    expect(findElement(tree, PautasSection)).not.toBeNull()
  })

  it("un equipo del alcance acota las consultas por equipo y deja fuera lo que se mide por faena", async () => {
    session.permissions = ["mant:records:view_all", "mant:ot:view_all"]
    const tree = await page({ equipo: "v-1" })
    expect(work.load).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ vehicleId: "v-1" }))
    expect(work.findings).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ vehicleId: "v-1" }))
    expect(loaders.series.mock.calls.at(-1)![1]).toMatchObject({ vehicleId: "v-1" })
    expect(findElement(tree, MaintenanceWorkSection)!.props).toMatchObject({ equipment: { id: "v-1" } })
    expect(findElement(tree, PanelToday)).toBeNull()
    expect(findElement(tree, PautasSection)).toBeNull()
    expect(findElement(tree, ReporteEquiposSection)).toBeNull()
    expect(findElement(tree, WorkOrdersSection)).not.toBeNull()
  })

  it("PANN-5: las secciones reciben el equipo elegido para llevarlo a sus enlaces; sin equipo, null", async () => {
    session.permissions = ["mant:records:view_all", "mant:ot:view_all"]
    expect(findElement(await page({ equipo: "v-1" }), WorkOrdersSection)!.props).toMatchObject({ equipmentId: "v-1" })
    expect(findElement(await page(), WorkOrdersSection)!.props).toMatchObject({ equipmentId: null })
    expect(findElement(await page({ equipo: "otro-equipo" }), WorkOrdersSection)!.props).toMatchObject({ equipmentId: null })
  })

  it("un equipo fuera del alcance o inventado se ignora, como una faena ajena", async () => {
    const tree = await page({ equipo: "otro-equipo" })
    expect(findElement(tree, MaintenanceWorkSection)!.props.equipment).toBeNull()
    expect(findElement(tree, PanelToday)).not.toBeNull()
    expect(work.load.mock.calls.at(-1)![1]).not.toHaveProperty("vehicleId")
  })

  it("el Excel y el PDF llevan el equipo elegido", async () => {
    session.permissions = ["mant:records:view_all", "mant:export"]
    const actions = findElement(await page({ equipo: "v-1" }), PageHeader)!.props.actions as ReactNode
    expect(findElement(actions, PanelExcelButton)!.props).toMatchObject({ equipo: "v-1", scope: { equipo: "KA-1 · AAAA-01" } })
    expect(findElement(actions, PanelPdfLink)!.props).toMatchObject({ equipo: "v-1" })
  })

  it("si una consulta de trabajos falla, su sección recibe null y el resto del Panel sigue", async () => {
    work.findings.mockRejectedValueOnce(new Error("sin base"))
    const tree = await page()
    expect(findElement(tree, FormsIndicatorsSection)!.props.findings).toBeNull()
    expect(findElement(tree, MaintenanceWorkSection)).not.toBeNull()
  })
})

describe("/mantencion/panel · Exportar Excel de Planificación, Correctivo y Preventivo", () => {
  const tabs = ["planificacion", "correctivo", "preventivo"] as const

  it("«Exportar Excel» sólo aparece con `mant:export`: sin él, la cabecera de las tres pestañas no lo trae", async () => {
    for (const pestana of tabs) {
      const header = findElement(await page({ pestana }), PageHeader)!
      expect(findElement(header.props.actions as ReactNode, LookerExcelButton), pestana).toBeNull()
    }
  })

  it("con `mant:export` el botón está en la cabecera de las tres pestañas y lleva la pestaña y los filtros de la URL", async () => {
    session.permissions = ["mant:records:view_all", "mant:export"]
    for (const pestana of tabs) {
      const header = findElement(await page({ pestana }), PageHeader)!
      const button = findElement(header.props.actions as ReactNode, LookerExcelButton)
      expect(button, pestana).not.toBeNull()
      expect(button!.props).toMatchObject({ tab: pestana, params: {} })
    }
  })

  it("el botón recibe sólo los parámetros que mueven la pantalla (no `pestana` ni `page`), tal como están en la URL", async () => {
    session.permissions = ["mant:records:view_worksite", "mant:export"]
    const tree = await page({ pestana: "correctivo", unidad: "h", desde: "2026-11-01", hasta: "2026-11-10", faena: "ws-1", x_conductor: "JUAN PEREZ", page: "3", ficha: "v-1" })
    const button = findElement(findElement(tree, PageHeader)!.props.actions as ReactNode, LookerExcelButton)!
    expect(button.props.params).not.toHaveProperty("ficha")
    expect(button.props).toMatchObject({ tab: "correctivo", params: { unidad: "h", desde: "2026-11-01", hasta: "2026-11-10", faena: "ws-1", x_conductor: "JUAN PEREZ" } })
    expect(button.props.params).not.toHaveProperty("page")
    expect(button.props.params).not.toHaveProperty("pestana")
  })

  it("la pestaña Hoy no lo trae: tiene su propio «Exportar Excel»", async () => {
    session.permissions = ["mant:records:view_all", "mant:export"]
    const header = findElement(await page({ pestana: "hoy" }), PageHeader)!
    expect(findElement(header.props.actions as ReactNode, LookerExcelButton)).toBeNull()
  })
})
