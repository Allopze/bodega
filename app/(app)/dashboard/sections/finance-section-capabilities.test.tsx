// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import type { Session } from "next-auth"

const getBillingSummary = vi.hoisted(() => vi.fn())
const getPurchasingFinancialSummary = vi.hoisted(() => vi.fn())
const getDashboardData = vi.hoisted(() => vi.fn())
const getFuelMonthlyTrend = vi.hoisted(() => vi.fn())
const getOverdueFuelDebt = vi.hoisted(() => vi.fn())
const getOperationalPeriodMetrics = vi.hoisted(() => vi.fn())

vi.mock("@/lib/services/billing/queries", () => ({ getBillingSummary }))
vi.mock("@/lib/services/analytics-module/dashboard", () => ({ getPurchasingFinancialSummary }))
vi.mock("@/lib/services/dashboard", () => ({ getDashboardData }))
vi.mock("@/lib/services/dashboard-fleet-maintenance", () => ({ getFuelMonthlyTrend }))
vi.mock("@/lib/services/dashboard-domains-data", () => ({ getOverdueFuelDebt }))
// `getOperationalCalendarBounds` es puro y la sección lo usa: se conserva el real.
vi.mock("@/lib/services/operational-period-metrics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/operational-period-metrics")>()),
  getOperationalPeriodMetrics,
}))

import { KpiCard } from "@/components/ui/kpi-card"
import { ChartSlot } from "@/components/ui/dashboard-panel"
import { RankedList } from "@/components/ui/ranked-list"
import { MoneyStat } from "@/app/(app)/facturacion/money-stat"
import { DebtAgingChart } from "../charts/debt-aging-chart"
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

function cards(node: ReactNode, result: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(node)) {
    node.forEach((child) => cards(child, result))
    return result
  }
  if (!node || typeof node !== "object" || !("props" in node)) return result
  const element = node as { props: Record<string, unknown> }
  if (typeof element.props.label === "string" && "trendPolarity" in element.props) result.push(element.props)
  cards(element.props.children as ReactNode, result)
  return result
}

/** Todos los elementos del árbol (sin renderizar) que cumplen el predicado. */
function findAll(node: ReactNode, matches: (element: { type: unknown; props: Record<string, unknown> }) => boolean, result: Array<{ type: unknown; props: Record<string, unknown> }> = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => findAll(child, matches, result))
    return result
  }
  if (!node || typeof node !== "object" || !("props" in node)) return result
  const element = node as { type: unknown; props: Record<string, unknown> }
  if (matches(element)) result.push(element)
  findAll(element.props.children as ReactNode, matches, result)
  return result
}

const ofType = (type: unknown) => (element: { type: unknown }) => element.type === type
const isTile = (element: { type: unknown }) => element.type === KpiCard || element.type === MoneyStat

type SectionProps = {
  kpiGroups: Array<{ key: string; label: string | null; content: ReactNode }>
  charts: ReactNode
  chartsFirst?: boolean
}

const sectionProps = async (permissions: string[], isGlobal = true) =>
  (await FinanceSection(props(permissions, isGlobal))).props as unknown as SectionProps

const tilesOf = (section: SectionProps) => section.kpiGroups.flatMap((group) => findAll(group.content, isTile))

const AGING = [
  { bucket: "not_due", label: "No vencida", count: 1, byCurrency: [{ currency: "CLP", amount: 100_000 }] },
  { bucket: "d1_30", label: "1–30 días", count: 2, byCurrency: [{ currency: "CLP", amount: 200_000 }] },
  // El mayor monto está en un tramo del medio: el orden NO puede salir del monto.
  { bucket: "d31_60", label: "31–60 días", count: 4, byCurrency: [{ currency: "CLP", amount: 1_500_000 }] },
  { bucket: "d61_90", label: "61–90 días", count: 0, byCurrency: [] },
  { bucket: "d90_plus", label: "Más de 90 días", count: 1, byCurrency: [{ currency: "CLP", amount: 300_000 }] },
] as const

function billingSummary(overrides: Record<string, unknown> = {}) {
  return {
    period: "2026-10",
    generatedAt: "2026-10-26T12:00:00.000Z",
    invoicedByCurrency: [{ currency: "CLP", amount: 5_000_000 }],
    collectedByCurrency: [{ currency: "CLP", amount: 1_000_000 }],
    outstandingByCurrency: [{ currency: "CLP", amount: 2_100_000 }],
    overdueByCurrency: [{ currency: "CLP", amount: 2_000_000 }],
    invoiceCount: 3,
    overdueCount: 7,
    averageDaysToPay: null,
    aging: AGING,
    topClients: [
      { clientName: "Arauco", currency: "CLP", amount: 3_000_000 },
      { clientName: "Masisa", currency: "CLP", amount: 2_000_000 },
    ],
    byWorksite: [],
    monthly: [{ period: "2026-10", currency: "CLP", invoiced: 5_000_000, collected: 1_000_000 }],
    providerStatus: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getBillingSummary.mockResolvedValue(null)
  getPurchasingFinancialSummary.mockResolvedValue({
    kpis: { totalSpend: 0, previousTotalSpend: 0, spendVariationPct: null, purchaseOrderCount: 0, averageOrderAmount: 0 },
    spendByModule: [],
    topSuppliers: [],
  })
  // INI-01: conteo y monto de OC salen de la misma función que el Resumen.
  getOperationalPeriodMetrics.mockResolvedValue({
    requests: { current: 0, previous: null },
    ordersIssued: { current: 3, previous: 2 },
    receipts: { current: 0, previous: null },
    deliveries: { current: 0, previous: null },
    spend: { current: 900_000, previous: 1_000_000 },
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

  it("INI-01: el gasto en OC sale de la función compartida y una baja no se pinta como mala noticia", async () => {
    const section = await FinanceSection(props(["purchasing:view"]))
    const groups = (section.props as { kpiGroups: Array<{ content: ReactNode }> }).kpiGroups
    const tiles = groups.flatMap((group) => cards(group.content))
    const spend = tiles.find((tile) => tile.label === "Gasto en OC")

    expect(getOperationalPeriodMetrics).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ period: "mes" }))
    expect(spend?.value).toBe("$900.000")
    expect(spend?.detail).toContain("3 OC emitidas")
    // -10 % en gasto: `up-bad` hace que la baja sea la polaridad buena.
    expect(spend?.trend).toBe(-10)
    expect(spend?.trendPolarity).toBe("up-bad")
  })
})

describe("FinanceSection: rediseño (gráficos primero, seis tiles, sin duplicar el saldo)", () => {
  const ALL = ["billing:view", "purchasing:view", "purchasing:create_order", "combustibles:view", "combustibles:view_costs"]

  it("abre con los gráficos y deja los dos grupos rotulados debajo", async () => {
    getBillingSummary.mockResolvedValue(billingSummary())
    const section = await sectionProps(ALL)

    expect(section.chartsFirst).toBe(true)
    // `e2e/densidad-kpi.spec.ts`: con más de 4 tiles hacen falta ≥2 rótulos de grupo.
    expect(section.kpiGroups.map((group) => group.label)).toEqual([
      "Ingresos (facturación de venta)",
      "Egresos (compra y consumo)",
    ])
  })

  it("A5: «Pendiente de cobro» y «Vencido» ya no son tiles; quedan seis", async () => {
    getBillingSummary.mockResolvedValue(billingSummary())
    const tiles = tilesOf(await sectionProps(ALL))
    const labels = tiles.map((tile) => tile.props.label)

    expect(labels).toEqual([
      "Facturado en el período",
      "Cobrado del período",
      "Gasto en OC",
      "Ticket medio por OC",
      "Costo de combustible",
      "Deuda vencida",
    ])
    expect(labels).not.toContain("Pendiente de cobro")
    expect(labels).not.toContain("Vencido")
  })

  it("todos los tiles usan la variante plana del tablero", async () => {
    getBillingSummary.mockResolvedValue(billingSummary())
    const tiles = tilesOf(await sectionProps(ALL))

    for (const tile of tiles) {
      expect(tile.props.surface, String(tile.props.label)).toBe("flat")
      if (tile.type === KpiCard) expect(tile.props.numerals, String(tile.props.label)).toBe("sans")
    }
  })

  it("«Antigüedad de la deuda» sale del orden de AGING_BUCKETS y trae el total y lo vencido en la moneda dominante", async () => {
    getBillingSummary.mockResolvedValue(billingSummary())
    const section = await sectionProps(["billing:view"])
    const aging = findAll(section.charts, ofType(DebtAgingChart))[0]!
    const buckets = aging.props.buckets as Array<{ key: string; amount: number; count: number | null }>

    expect(buckets.map((bucket) => bucket.key)).toEqual(["not_due", "d1_30", "d31_60", "d61_90", "d90_plus"])
    expect(buckets.map((bucket) => bucket.amount)).toEqual([100_000, 200_000, 1_500_000, 0, 300_000])
    expect(aging.props.totalAmount).toBe(2_100_000)
    expect(aging.props.overdueAmount).toBe(2_000_000)
    expect(aging.props.currency).toBe("CLP")
    expect(buckets.map((bucket) => bucket.count)).toEqual([1, 2, 4, 0, 1])
    // Sólo datos serializables cruzan hacia el componente de cliente.
    expect(Object.values(aging.props).some((value) => typeof value === "function")).toBe(false)
  })

  it("con deuda en varias monedas declara el recorte y no inventa conteos", async () => {
    getBillingSummary.mockResolvedValue(billingSummary({
      outstandingByCurrency: [{ currency: "CLP", amount: 2_100_000 }, { currency: "USD", amount: 500 }],
    }))
    const aging = findAll((await sectionProps(["billing:view"])).charts, ofType(DebtAgingChart))[0]!

    expect(String(aging.props.description)).toContain("sólo CLP")
    expect((aging.props.buckets as Array<{ count: number | null }>).every((bucket) => bucket.count === null)).toBe(true)
  })

  it("sin deuda el gráfico se pinta igual (para decir «Sin saldo pendiente»); sin facturación no existe", async () => {
    getBillingSummary.mockResolvedValue(billingSummary({
      outstandingByCurrency: [], overdueByCurrency: [], overdueCount: 0,
      aging: AGING.map((bucket) => ({ ...bucket, count: 0, byCurrency: [] })),
    }))
    const aging = findAll((await sectionProps(["billing:view"])).charts, ofType(DebtAgingChart))[0]!
    expect(aging.props.totalAmount).toBe(0)
    expect((aging.props.buckets as Array<{ amount: number }>).every((bucket) => bucket.amount === 0)).toBe(true)

    getBillingSummary.mockResolvedValue(null)
    expect(findAll((await sectionProps(["purchasing:view"])).charts, ofType(DebtAgingChart))).toHaveLength(0)
  })

  it("cada gráfico va en un ChartSlot (el slot se oculta solo si el gráfico no tiene datos)", async () => {
    getBillingSummary.mockResolvedValue(billingSummary())
    getPurchasingFinancialSummary.mockResolvedValue({
      kpis: { totalSpend: 900_000, previousTotalSpend: 0, spendVariationPct: null, purchaseOrderCount: 3, averageOrderAmount: 300_000 },
      spendByModule: [{ module: "Compras", totalAmount: 900_000 }],
      topSuppliers: [{ id: "s1", name: "Ferretería Sur", module: "Compras", totalAmount: 900_000, count: 3 }],
    })
    getDashboardData.mockResolvedValue({ metrics: {}, worksitesBreakdown: [{ id: "w1", name: "Teno", requestsCount: 2, totalCost: 700_000 }] })
    const section = await sectionProps(ALL)

    const children = (section.charts as { props: { children: ReactNode[] } }).props.children
    const drawn = children.filter(Boolean) as Array<{ type: unknown }>
    // Flujo, antigüedad, composición, proveedores, clientes y faenas.
    expect(drawn).toHaveLength(6)
    expect(drawn.every((child) => child.type === ChartSlot)).toBe(true)
    expect(drawn.map((child) => (child as unknown as { props: { span?: string } }).props.span)).toEqual(["wide", undefined, undefined, undefined, undefined, "full"])
  })

  it("los rankings son listas en un solo tono con enlaces donde hay detalle", async () => {
    getBillingSummary.mockResolvedValue(billingSummary())
    getPurchasingFinancialSummary.mockResolvedValue({
      // $1.000.000 en total, pero el servicio sólo trajo $900.000 en proveedores.
      kpis: { totalSpend: 1_000_000, previousTotalSpend: 0, spendVariationPct: null, purchaseOrderCount: 3, averageOrderAmount: 333_333 },
      spendByModule: [],
      topSuppliers: [{ id: "s1", name: "Ferretería Sur", module: "Compras", totalAmount: 900_000, count: 3 }],
    })
    getDashboardData.mockResolvedValue({ metrics: {}, worksitesBreakdown: [
      { id: "w1", name: "Teno", requestsCount: 2, totalCost: 700_000 },
      { id: "w2", name: "Sin inversión", requestsCount: 1, totalCost: 0 },
    ] })
    const lists = findAll((await sectionProps(ALL)).charts, ofType(RankedList))
    const byLabel = (label: string) => lists.find((list) => list.props.ariaLabel === label)!
    const items = (label: string) => byLabel(label).props.items as Array<{ key: string; label: string; value: number; href?: string }>

    expect(lists.map((list) => list.props.ariaLabel)).toEqual(["Proveedores por gasto", "Principales clientes", "Inversión por faena"])
    expect(lists.every((list) => list.props.mode === "share" && list.props.format === "clp")).toBe(true)

    // Proveedores: el resto del gasto va en «Otros», para que el 100 % sea el gasto real.
    expect(items("Proveedores por gasto").map((item) => [item.label, item.value])).toEqual([["Ferretería Sur", 900_000], ["Otros proveedores", 100_000]])
    const supplierHref = new URL(items("Proveedores por gasto")[0]!.href!, "http://x")
    expect(supplierHref.pathname).toBe("/compras")
    expect(supplierHref.searchParams.get("proveedor")).toBe("s1")
    // `hasta` es inclusivo en /compras: el último día del período, no el primero del siguiente.
    expect(supplierHref.searchParams.get("hasta")).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(items("Proveedores por gasto")[1]!.href).toBeUndefined()

    // Clientes: el resumen no trae `clientId`, así que no hay a qué enlazar.
    expect(items("Principales clientes").map((item) => item.label)).toEqual(["Arauco", "Masisa"])
    expect(items("Principales clientes").every((item) => item.href === undefined)).toBe(true)

    // Faenas: sin las que no tienen inversión; cada fila lleva a las OC de la faena.
    expect(items("Inversión por faena")).toEqual([{ key: "w1", label: "Teno", value: 700_000, href: "/compras?faena=w1" }])
  })

  it("un ranking sin datos no se dibuja (no deja un slot vacío con título)", async () => {
    getBillingSummary.mockResolvedValue(billingSummary({ topClients: [] }))
    const lists = findAll((await sectionProps(ALL)).charts, ofType(RankedList))
    expect(lists).toHaveLength(0)
  })

  describe("A1: un tile sin cifra dice qué hacer", () => {
    it("sin facturas ni pagos, los tiles de ingresos ofrecen la acción hacia donde se resuelve", async () => {
      getBillingSummary.mockResolvedValue(billingSummary({ invoicedByCurrency: [], collectedByCurrency: [], invoiceCount: 0 }))
      const tiles = tilesOf(await sectionProps(["billing:view"]))
      const facturado = tiles.find((tile) => tile.props.label === "Facturado en el período")!
      const cobrado = tiles.find((tile) => tile.props.label === "Cobrado del período")!

      expect(facturado.props.amounts).toEqual([])
      expect(facturado.props.href).toBe("/facturacion/pendientes")
      expect(facturado.props.emptyAction).toEqual({ message: "Sin facturas emitidas en el mes en curso", label: "Ver pendientes de facturar" })
      expect(cobrado.props.href).toBe("/facturacion/cobranza")
      expect(cobrado.props.emptyAction).toEqual({ message: "Sin pagos confirmados", label: "Ver cobranza" })
    })

    it("quien puede actuar ve el verbo de la acción, no uno que no podría cumplir", async () => {
      getBillingSummary.mockResolvedValue(billingSummary({ invoicedByCurrency: [], collectedByCurrency: [] }))
      const tiles = tilesOf(await sectionProps(["billing:view", "billing:create_proposal", "billing:confirm_payments"]))

      expect((tiles[0]!.props.emptyAction as { label: string }).label).toBe("Emitir factura")
      expect((tiles[1]!.props.emptyAction as { label: string }).label).toBe("Registrar un pago")
    })

    it("con facturas pero ningún pago, «Cobrado» es un tile vacío; «Facturado» conserva su cifra y su lista", async () => {
      getBillingSummary.mockResolvedValue(billingSummary({ collectedByCurrency: [{ currency: "CLP", amount: 0 }] }))
      const tiles = tilesOf(await sectionProps(["billing:view"]))

      expect(tiles[0]!.props.amounts).toEqual([{ currency: "CLP", amount: 5_000_000 }])
      expect(String(tiles[0]!.props.href)).toContain("/facturacion/facturas")
      expect(tiles[1]!.props.amounts).toEqual([])
    })

    it("sin OC ni cargas, los tiles de egresos dicen qué falta; Deuda vencida en $0 conserva su cifra", async () => {
      getOperationalPeriodMetrics.mockResolvedValue({
        requests: { current: 0, previous: null },
        ordersIssued: { current: 0, previous: 3 },
        receipts: { current: 0, previous: null },
        deliveries: { current: 0, previous: null },
        spend: { current: 0, previous: 900_000 },
      })
      getOverdueFuelDebt.mockResolvedValue({ amount: 0, statements: 0 })
      const tiles = tilesOf(await sectionProps(ALL))
      const tile = (label: string) => tiles.find((entry) => entry.props.label === label)!

      expect(tile("Gasto en OC").props.empty).toEqual({ message: "Sin OC emitidas en el mes en curso", actionLabel: "Emitir una OC" })
      expect(tile("Gasto en OC").props.href).toBe("/compras/nueva")
      expect(tile("Gasto en OC").props.trend).toBeNull()
      expect(tile("Ticket medio por OC").props.empty).toEqual({ message: "Sin OC para promediar" })
      expect(tile("Costo de combustible").props.empty).toEqual({ message: "Sin cargas facturadas en 6 meses", actionLabel: "Ver cargas" })
      expect(tile("Costo de combustible").props.href).toBe("/combustibles")
      // Cero deuda es buena noticia, no ausencia de datos.
      expect(tile("Deuda vencida").props.empty).toBeUndefined()
      expect(tile("Deuda vencida").props.value).toBe("$0")
    })

    it("sin permiso para crear OC el tile no ofrece emitirla ni apunta a la pantalla de creación", async () => {
      getOperationalPeriodMetrics.mockResolvedValue({
        requests: { current: 0, previous: null }, ordersIssued: { current: 0, previous: null },
        receipts: { current: 0, previous: null }, deliveries: { current: 0, previous: null },
        spend: { current: 0, previous: null },
      })
      const gasto = tilesOf(await sectionProps(["purchasing:view"])).find((tile) => tile.props.label === "Gasto en OC")!

      expect(gasto.props.empty).toEqual({ message: "Sin OC emitidas en el mes en curso" })
      expect(gasto.props.href).toBe("/compras")
    })

    it("renderizados, los tiles vacíos muestran el mensaje y una acción que es un enlace real", async () => {
      getBillingSummary.mockResolvedValue(billingSummary({ invoicedByCurrency: [], collectedByCurrency: [], invoiceCount: 0 }))
      getOperationalPeriodMetrics.mockResolvedValue({
        requests: { current: 0, previous: null }, ordersIssued: { current: 0, previous: null },
        receipts: { current: 0, previous: null }, deliveries: { current: 0, previous: null },
        spend: { current: 0, previous: null },
      })
      const section = await sectionProps(ALL)
      render(<>{section.kpiGroups.map((group) => <div key={group.key}>{group.content}</div>)}</>)

      for (const [mensaje, accion, href] of [
        ["Sin facturas emitidas en el mes en curso", "Ver pendientes de facturar", "/facturacion/pendientes"],
        ["Sin pagos confirmados", "Ver cobranza", "/facturacion/cobranza"],
        ["Sin OC emitidas en el mes en curso", "Emitir una OC", "/compras/nueva"],
        ["Sin cargas facturadas en 6 meses", "Ver cargas", "/combustibles"],
      ] as const) {
        expect(screen.getByText(mensaje)).toBeDefined()
        expect(screen.getByText(accion).closest("a")?.getAttribute("href"), accion).toBe(href)
      }
    })

    it("con OC emitidas no hay tiles vacíos", async () => {
      getPurchasingFinancialSummary.mockResolvedValue({
        kpis: { totalSpend: 900_000, previousTotalSpend: 0, spendVariationPct: null, purchaseOrderCount: 3, averageOrderAmount: 300_000 },
        spendByModule: [], topSuppliers: [],
      })
      getFuelMonthlyTrend.mockResolvedValue([{ amount: 50_000 }])
      const tiles = tilesOf(await sectionProps(ALL)).filter((tile) => tile.type === KpiCard)

      expect(tiles.map((tile) => tile.props.empty)).toEqual([undefined, undefined, undefined, undefined])
    })
  })
})

