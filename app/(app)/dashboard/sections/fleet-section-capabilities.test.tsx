import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

const getFuelControlOverview = vi.hoisted(() => vi.fn())
const getFuelMonthlyTrend = vi.hoisted(() => vi.fn())
const getMaintenanceMonthlyTrend = vi.hoisted(() => vi.fn())
const getExpiringFleetDocuments = vi.hoisted(() => vi.fn())
const getFleetOverview = vi.hoisted(() => vi.fn())
const getUsageMaintenanceAlerts = vi.hoisted(() => vi.fn())
const countPendingFuelCreditNotes = vi.hoisted(() => vi.fn())
const readDtePortalConfig = vi.hoisted(() => vi.fn())

vi.mock("@/lib/combustibles/fuel-control-overview", () => ({ getFuelControlOverview }))
vi.mock("@/lib/services/dashboard-fleet-maintenance", () => ({ getFuelMonthlyTrend, getMaintenanceMonthlyTrend }))
vi.mock("@/lib/services/dashboard-domains-data", () => ({ getExpiringFleetDocuments }))
vi.mock("@/lib/services/fleet", () => ({ getFleetOverview, FLEET_OVERVIEW_LOOKBACK_MONTHS: 12 }))
vi.mock("@/lib/services/maintenance", () => ({ getUsageMaintenanceAlerts }))
vi.mock("@/lib/services/dte-portal/reconciliation", () => ({ countPendingFuelCreditNotes }))
vi.mock("@/lib/services/dte-portal/config", () => ({ readDtePortalConfig }))

import { ChartSlot } from "@/components/ui/dashboard-panel"
import { KpiCard } from "@/components/ui/kpi-card"
import { RankedList } from "@/components/ui/ranked-list"
import { FleetSection } from "./fleet-section"
import type { DomainSectionsProps } from "./shared"

const scope = { worksiteId: "all", worksiteName: null, period: "mes", view: "flota" } as const

// CO-037: FleetSection ahora envuelve <DomainSection> en un Fragment junto al
// banner de degradación — el segundo hijo del Fragment es el DomainSection real.
function domainSectionOf(section: unknown): { props: { links: Array<{ href: string }> } } {
  return (section as { props: { children: unknown[] } }).props.children[1] as { props: { links: Array<{ href: string }> } }
}

function bannerOf(section: unknown): { props: { degraded: string[]; total: number } } {
  return (section as { props: { children: unknown[] } }).props.children[0] as { props: { degraded: string[]; total: number } }
}

function props(...permissions: string[]): DomainSectionsProps {
  return {
    session: { user: { id: "custom-role", permissions, isGlobal: true, worksiteIds: [] } } as unknown as Session,
    scope,
    worksiteScope: { mode: "all", ids: [] },
    pdtpScope: "all",
    worksiteIds: [],
    currentYear: 2026,
    moduleWorkload: [],
    queueTotal: 0,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getFuelControlOverview.mockResolvedValue(null)
  getFuelMonthlyTrend.mockResolvedValue([])
  getMaintenanceMonthlyTrend.mockResolvedValue([])
  getExpiringFleetDocuments.mockResolvedValue({ within30: 0, expired: 0 })
  getFleetOverview.mockResolvedValue([])
  getUsageMaintenanceAlerts.mockResolvedValue([])
  countPendingFuelCreditNotes.mockResolvedValue(0)
  readDtePortalConfig.mockResolvedValue({ credentials: { codEmp: "empresa" } })
})

describe("FleetSection capability matrix", () => {
  it("a flota-only role does not query fuel, TAE, maintenance or DTE datasets", async () => {
    const section = await FleetSection(props("flota:view"))

    expect(getFleetOverview).toHaveBeenCalledOnce()
    expect(getExpiringFleetDocuments).toHaveBeenCalledOnce()
    expect(getFuelControlOverview).not.toHaveBeenCalled()
    expect(getFuelMonthlyTrend).not.toHaveBeenCalled()
    expect(getMaintenanceMonthlyTrend).not.toHaveBeenCalled()
    expect(getUsageMaintenanceAlerts).not.toHaveBeenCalled()
    expect(readDtePortalConfig).not.toHaveBeenCalled()
    // flota:view abre el Panel operacional, así que la sección también lo enlaza.
    expect(domainSectionOf(section).props.links.map((link) => link.href)).toEqual(["/control-operacional", "/flota"])
  })

  it("a fuel-only role does not query fleet or maintenance and does not include TAE implicitly", async () => {
    const section = await FleetSection(props("combustibles:view"))

    expect(getFuelControlOverview).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ includeTae: false }))
    expect(getFuelMonthlyTrend).toHaveBeenCalledOnce()
    expect(getFleetOverview).not.toHaveBeenCalled()
    expect(getExpiringFleetDocuments).not.toHaveBeenCalled()
    expect(getMaintenanceMonthlyTrend).not.toHaveBeenCalled()
    expect(getUsageMaintenanceAlerts).not.toHaveBeenCalled()
    expect(domainSectionOf(section).props.links.map((link) => link.href)).toEqual(["/combustibles"])
  })

  it("cost and purchasing permissions alone do not query fuel credit-note data", async () => {
    const section = await FleetSection(props("flota:view", "combustibles:view_costs", "purchasing:view"))

    expect(readDtePortalConfig).not.toHaveBeenCalled()
    expect(countPendingFuelCreditNotes).not.toHaveBeenCalled()
    expect(domainSectionOf(section).props.links.map((link) => link.href)).toEqual(["/control-operacional", "/flota"])
  })
})

// CO-037: antes 3 de las 7 consultas no tenían ningún catch — si cualquiera
// reventaba, el Promise.all completo rechazaba y tumbaba la sección entera.
describe("FleetSection degradation tracking", () => {
  it("no lanza cuando una consulta sin catch previo falla, y la marca como degradada", async () => {
    getExpiringFleetDocuments.mockRejectedValue(new Error("boom"))

    const section = await FleetSection(props("flota:view", "combustibles:view", "mantenciones:view"))

    expect(bannerOf(section).props.degraded).toContain("expiringDocs")
    expect(bannerOf(section).props.total).toBeGreaterThan(0)
  })

  it("no reporta degradación cuando todas las consultas resuelven normalmente", async () => {
    const section = await FleetSection(props("flota:view", "combustibles:view", "mantenciones:view"))

    expect(bannerOf(section).props.degraded).toEqual([])
  })
})

type Element = { type: unknown; props: Record<string, unknown> }

/** Recorre el árbol React sin renderizarlo, incluidas las props que llevan nodos. */
function find(node: unknown, match: (element: Element) => boolean, result: Element[] = []): Element[] {
  if (Array.isArray(node)) {
    node.forEach((child) => find(child, match, result))
    return result
  }
  if (!node || typeof node !== "object" || !("props" in node) || !("type" in node)) return result
  const element = node as Element
  if (match(element)) result.push(element)
  Object.values(element.props).forEach((value) => find(value, match, result))
  return result
}

function sectionOf(section: unknown) {
  return domainSectionOf(section).props as unknown as { kpis: unknown; charts: unknown }
}

const vehicle = (overrides: Record<string, unknown>) => ({ id: "v1", plate: "AA-11", isActive: true, costPerKm: null, costPerHour: null, ...overrides })

// Rediseño del tablero: los gráficos van en `ChartSlot` y el ranking de costo
// es una lista, no barras multicolor.
describe("FleetSection · panel del tablero", () => {
  it("el costo por unidad de uso es un ranking en un ChartSlot y no reparte un % del total", async () => {
    getFleetOverview.mockResolvedValue([
      vehicle({ id: "v1", plate: "AA-11", costPerKm: 120.4 }),
      vehicle({ id: "v2", plate: "BB-22", costPerHour: 5000 }),
      vehicle({ id: "v3", plate: "CC-33" }),
    ])
    const { charts } = sectionOf(await FleetSection(props("flota:view", "combustibles:view", "combustibles:view_costs")))

    const slots = find(charts, (element) => element.type === ChartSlot)
    expect(slots.length).toBeGreaterThanOrEqual(2)
    const list = find(charts, (element) => element.type === RankedList)[0]!
    // $/km y $/hora no se suman: un % del total no mediría nada.
    expect(list.props).toMatchObject({ format: "clp", mode: "share", showShare: false })
    // El vehículo sin tasa calculable no entra (no se inventan ceros) y cada fila lleva a su ficha.
    expect(list.props.items).toEqual([
      { key: "v1", label: "AA-11", value: 120, detail: "$ por km", href: "/flota/v1" },
      { key: "v2", label: "BB-22", value: 5000, detail: "$ por hora", href: "/flota/v2" },
    ])
  })

  it("sin permiso de costos no hay ranking de costo", async () => {
    getFleetOverview.mockResolvedValue([vehicle({ costPerKm: 120 })])
    const { charts } = sectionOf(await FleetSection(props("flota:view")))

    expect(find(charts, (element) => element.type === RankedList)).toHaveLength(0)
  })

  it("todos los tiles llevan la variante del tablero", async () => {
    const { kpis } = sectionOf(await FleetSection(props("flota:view", "combustibles:view", "mantenciones:view")))
    const tiles = find(kpis, (element) => element.type === KpiCard)

    expect(tiles).toHaveLength(4)
    for (const tile of tiles) expect(tile.props).toMatchObject({ numerals: "sans", surface: "flat" })
  })

  it("sin vehículos ni cargas los tiles dicen qué falta; si la fuente falló conservan la cifra", async () => {
    const empty = sectionOf(await FleetSection(props("flota:view", "combustibles:view")))
    const byLabel = (kpis: unknown, label: string) => find(kpis, (element) => element.type === KpiCard && element.props.label === label)[0]!

    expect(byLabel(empty.kpis, "Vehículos activos").props.empty).toMatchObject({ message: "Aún no hay vehículos activos" })
    expect(byLabel(empty.kpis, "Litros (6 meses)").props.empty).toMatchObject({ message: "Sin cargas registradas en 6 meses" })

    // Un cero por falla de la consulta no es "aún no hay": el banner de degradación lo avisa.
    getFleetOverview.mockRejectedValue(new Error("boom"))
    const degraded = sectionOf(await FleetSection(props("flota:view")))
    expect(byLabel(degraded.kpis, "Vehículos activos").props.empty).toBeUndefined()
  })
})
