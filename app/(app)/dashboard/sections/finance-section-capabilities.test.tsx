import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import type { Session } from "next-auth"

const getBillingSummary = vi.hoisted(() => vi.fn())
const getPurchasingFinancialSummary = vi.hoisted(() => vi.fn())
const getDashboardData = vi.hoisted(() => vi.fn())
const getFuelMonthlyTrend = vi.hoisted(() => vi.fn())
const getOverdueFuelDebt = vi.hoisted(() => vi.fn())

vi.mock("@/lib/services/billing/queries", () => ({ getBillingSummary }))
vi.mock("@/lib/services/analytics-module/dashboard", () => ({ getPurchasingFinancialSummary }))
vi.mock("@/lib/services/dashboard", () => ({ getDashboardData }))
vi.mock("@/lib/services/dashboard-fleet-maintenance", () => ({ getFuelMonthlyTrend }))
vi.mock("@/lib/services/dashboard-domains-data", () => ({ getOverdueFuelDebt }))

import { FinanceSection } from "./finance-section"
import type { DomainSectionsProps } from "./shared"

const scope = { worksiteId: "all", worksiteName: null, period: "mes", view: "finanzas" } as const

function props(permissions: string[], isGlobal = true): DomainSectionsProps {
  return {
    session: { user: { id: "custom-role", permissions, isGlobal, worksiteIds: isGlobal ? [] : ["ws-1"] } } as unknown as Session,
    scope,
    worksiteScope: { mode: "all", ids: [] },
    pdtpScope: "all",
    worksiteIds: [],
    currentYear: 2026,
    moduleWorkload: [],
    queueTotal: 0,
  }
}

function hrefs(node: ReactNode, result: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((child) => hrefs(child, result))
    return result
  }
  if (!node || typeof node !== "object" || !("props" in node)) return result
  const element = node as { props: { href?: unknown; children?: ReactNode } }
  if (typeof element.props.href === "string") result.push(element.props.href)
  hrefs(element.props.children, result)
  return result
}

beforeEach(() => {
  vi.clearAllMocks()
  getBillingSummary.mockResolvedValue(null)
  getPurchasingFinancialSummary.mockResolvedValue({
    kpis: { totalSpend: 0, previousTotalSpend: 0, spendVariationPct: null, purchaseOrderCount: 0, averageOrderAmount: 0 },
    spendByModule: [],
    topSuppliers: [],
  })
  getDashboardData.mockResolvedValue({ metrics: {}, worksitesBreakdown: [] })
  getFuelMonthlyTrend.mockResolvedValue([])
  getOverdueFuelDebt.mockResolvedValue({ amount: 100_000, statements: 1 })
})

describe("FinanceSection capability matrix", () => {
  it("un rol acotado con costos no consulta ni enlaza la cuenta corriente global", async () => {
    const section = await FinanceSection(props(["combustibles:view", "combustibles:view_costs"], false))
    const groups = (section.props as { kpiGroups: Array<{ content: ReactNode }> }).kpiGroups

    expect(getFuelMonthlyTrend).toHaveBeenCalledOnce()
    expect(getOverdueFuelDebt).not.toHaveBeenCalled()
    expect(groups.flatMap((group) => hrefs(group.content))).not.toContain("/combustibles/cuenta-corriente")
  })

  it("compras usa el read model financiero acotado y no expone enlaces sin permiso", async () => {
    const section = await FinanceSection(props(["purchasing:view"]))
    const links = (section.props as { links: Array<{ href: string }> }).links.map((link) => link.href)

    expect(getPurchasingFinancialSummary).toHaveBeenCalledOnce()
    expect(getDashboardData).toHaveBeenCalledOnce()
    expect(links).toEqual(["/compras"])
  })

  it("billing:view sin manage_sync no ofrece la sincronización como salida vacía", async () => {
    const section = await FinanceSection(props(["billing:view"]))
    const groups = (section.props as { kpiGroups: Array<{ content: ReactNode }> }).kpiGroups
    const links = groups.flatMap((group) => hrefs(group.content))

    expect(links).toContain("/facturacion")
    expect(links).not.toContain("/facturacion/sincronizacion")
  })
})
