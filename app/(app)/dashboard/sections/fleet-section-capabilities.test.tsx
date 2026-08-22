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
    expect(domainSectionOf(section).props.links.map((link) => link.href)).toEqual(["/flota"])
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
    expect(domainSectionOf(section).props.links.map((link) => link.href)).toEqual(["/flota"])
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
