import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

const getOperationalPeriodMetrics = vi.hoisted(() => vi.fn())
const getReceptionQuality = vi.hoisted(() => vi.fn())
const getOperationalTrendHistory = vi.hoisted(() => vi.fn())
const getDashboardData = vi.hoisted(() => vi.fn())

// `getOperationalCalendarBounds` es puro y la sección lo usa: se conserva el real.
vi.mock("@/lib/services/operational-period-metrics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/operational-period-metrics")>()),
  getOperationalPeriodMetrics,
}))
vi.mock("@/lib/services/dashboard-domains-data", () => ({ getReceptionQuality }))
vi.mock("@/lib/services/operational-trend-history", () => ({ getOperationalTrendHistory }))
vi.mock("@/lib/services/dashboard", () => ({ getDashboardData }))

import { ChartSlot } from "@/components/ui/dashboard-panel"
import { KpiCard } from "@/components/ui/kpi-card"
import { RankedList } from "@/components/ui/ranked-list"
import { AcquisitionsSection } from "./acquisitions-section"
import type { DomainSectionsProps } from "./shared"

const scope = { worksiteId: "all", worksiteName: null, period: "mes", view: "adquisiciones" } as const

function props(overrides: Partial<DomainSectionsProps> = {}): DomainSectionsProps {
  return {
    session: { user: { id: "u1", permissions: ["purchasing:view"], isGlobal: true, worksiteIds: [] } } as unknown as Session,
    scope,
    worksiteScope: { mode: "all", ids: [] },
    pdtpScope: "all",
    worksiteIds: [],
    currentYear: 2026,
    moduleWorkload: [],
    queueTotal: 0,
    ...overrides,
  }
}

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

const sectionProps = (section: unknown) => (section as { props: { kpis: unknown; charts: unknown } }).props
const ocTile = (kpis: unknown) => find(kpis, (element) => element.type === KpiCard && element.props.label === "OC emitidas")[0]!

const metrics = (previous: number | null) => ({
  requests: { current: 0, previous: null },
  ordersIssued: { current: 5, previous },
  receipts: { current: 0, previous: null },
  deliveries: { current: 0, previous: null },
  spend: { current: 0, previous: null },
})

beforeEach(() => {
  vi.clearAllMocks()
  getOperationalPeriodMetrics.mockResolvedValue(metrics(3))
  getReceptionQuality.mockResolvedValue({ rejectionRate: 0, rejected: 0, damaged: 0 })
  getOperationalTrendHistory.mockResolvedValue([])
  getDashboardData.mockResolvedValue({ metrics: { pending_approvals: 0, orders_pending_receipt: 0 } })
})

describe("AcquisitionsSection · rediseño del tablero", () => {
  it("'OC emitidas' compara contra el período anterior con la misma cifra que ya se consultó, en gris", async () => {
    const { kpis } = sectionProps(await AcquisitionsSection(props()))
    const tile = ocTile(kpis)

    // 5 emitidas contra 3 el período anterior: +2 en unidades, no un porcentaje.
    expect(tile.props).toMatchObject({ value: "5", trend: 2, trendFormat: "number", trendPolarity: "neutral" })
    expect(tile.props.trendLabel).toMatch(/^vs\. /)
    // No se agregó ninguna consulta: sale del mismo `getOperationalPeriodMetrics`.
    expect(getOperationalPeriodMetrics).toHaveBeenCalledOnce()
  })

  it("sin período anterior no inventa una variación", async () => {
    getOperationalPeriodMetrics.mockResolvedValue(metrics(null))
    const { kpis } = sectionProps(await AcquisitionsSection(props()))

    expect(ocTile(kpis).props.trend).toBeUndefined()
  })

  it("todos los tiles llevan la variante del tablero", async () => {
    const { kpis } = sectionProps(await AcquisitionsSection(props()))
    const tiles = find(kpis, (element) => element.type === KpiCard)

    expect(tiles).toHaveLength(4)
    for (const tile of tiles) expect(tile.props).toMatchObject({ numerals: "sans", surface: "flat" })
  })

  it("la distribución por módulo es un ranking con enlace por módulo, dentro de un ChartSlot", async () => {
    const { charts } = sectionProps(await AcquisitionsSection(props({
      moduleWorkload: [{ module: "Recepciones", count: 5 }, { module: "PDTP", count: 2 }],
      queueTotal: 7,
    })))

    // Cada gráfico —la tendencia y el reparto— va en su celda, que se oculta si no hay datos.
    expect(find(charts, (element) => element.type === ChartSlot)).toHaveLength(2)
    const list = find(charts, (element) => element.type === RankedList)[0]!
    expect(list.props).toMatchObject({ format: "count", mode: "share", moreHref: "/pendientes" })
    expect(list.props.items).toEqual([
      { key: "Recepciones", label: "Recepciones", value: 5, href: "/pendientes?module=recepciones" },
      { key: "PDTP", label: "PDTP", value: 2, href: "/pendientes?module=pdtp" },
    ])
  })

  it("sin pendientes no monta la celda del reparto", async () => {
    const { charts } = sectionProps(await AcquisitionsSection(props()))

    expect(find(charts, (element) => element.type === RankedList)).toHaveLength(0)
    expect(find(charts, (element) => element.type === ChartSlot)).toHaveLength(1)
  })
})
