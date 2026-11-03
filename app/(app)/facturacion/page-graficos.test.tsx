/**
 * CHART-036 (AUDITORIA_VISUALIZACIONES_CHOME.md): `/facturacion` dibuja lo mensual
 * que consultaba y perdía (`summary.monthly`), reparte la antigüedad en un gráfico
 * con su tabla como «Ver datos», rankea clientes y faenas por moneda y compara el
 * facturado con el mes anterior.
 *
 * La página es un Server Component: se la invoca y se recorre el árbol de
 * elementos, sin renderizar (recharts en jsdom es incómodo y lo cubren las
 * pruebas de cada gráfico).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const summary = vi.hoisted(() => ({
  period: "2026-10",
  invoiceCount: 4,
  invoicedByCurrency: [{ currency: "CLP", amount: 1_500_000 }, { currency: "USD", amount: 20 }],
  collectedByCurrency: [{ currency: "CLP", amount: 300_000 }],
  outstandingByCurrency: [{ currency: "CLP", amount: 1_200_000 }],
  overdueByCurrency: [{ currency: "CLP", amount: 700_000 }],
  overdueCount: 2,
  providerStatus: [],
  averageDaysToPay: 12,
  generatedAt: "2026-10-15T15:00:00.000Z",
  aging: [
    { bucket: "not_due", label: "No vencida", count: 1, byCurrency: [{ currency: "CLP", amount: 500_000 }] },
    { bucket: "d1_30", label: "1–30 días", count: 0, byCurrency: [] },
    { bucket: "d31_60", label: "31–60 días", count: 1, byCurrency: [{ currency: "CLP", amount: 700_000 }] },
    { bucket: "d61_90", label: "61–90 días", count: 0, byCurrency: [] },
    { bucket: "d90_plus", label: "Más de 90 días", count: 0, byCurrency: [] },
  ],
  topClients: [
    { clientName: "Minera A", currency: "CLP", amount: 900_000 },
    { clientName: "Minera B", currency: "CLP", amount: 300_000 },
    { clientName: "Cliente USD", currency: "USD", amount: 15 },
  ],
  byWorksite: [{ worksiteName: "Faena Norte", currency: "CLP", amount: 1_000_000 }],
  monthly: [
    { period: "2026-08", currency: "CLP", invoiced: 1_000_000, collected: 1_000_000 },
    { period: "2026-09", currency: "CLP", invoiced: 1_000_000, collected: 700_000 },
    { period: "2026-10", currency: "CLP", invoiced: 1_500_000, collected: 300_000 },
    { period: "2026-10", currency: "USD", invoiced: 20, collected: 0 },
    { period: "2026-11", currency: "CLP", invoiced: 9_000_000, collected: 0 },
  ],
}))

vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT") }) }))
vi.mock("@/lib/auth/auth", () => ({ auth: () => Promise.resolve({ user: { id: "u-1" } }) }))
vi.mock("@/lib/auth/can", () => ({ can: () => true }))
vi.mock("@/lib/services/billing/queries", () => ({
  getBillingSummary: () => Promise.resolve(summary),
  listUnlinkedInvoices: () => Promise.resolve([]),
  todayIso: () => "2026-10-15",
}))
// El módulo cliente carga recharts de forma diferida; acá sólo importa quién es.
vi.mock("./billing-flow-lazy", () => ({ BillingFlowChartLazy: function BillingFlowChartLazy() { return null } }))

import { ChartSection } from "@/components/charts/chart-section"
import { DebtAgingChart } from "@/components/charts/debt-aging-chart"
import { RankedList } from "@/components/ui/ranked-list"
import { TableRoot } from "@/components/ui/table"
import { MoneyStat } from "./money-stat"
import { BillingFlowChartLazy } from "./billing-flow-lazy"
import BillingSummaryPage from "./page"

type El = { type: unknown; props: Record<string, unknown> }

function collectElements(node: unknown, result: El[] = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => collectElements(child, result))
    return result
  }
  if (!node || typeof node !== "object" || !("props" in node)) return result
  const element = node as El
  result.push(element)
  Object.values(element.props).forEach((value) => collectElements(value, result))
  return result
}

async function renderPage() {
  const page = await BillingSummaryPage({ searchParams: Promise.resolve({}) })
  return collectElements(page)
}

const sections = (elements: El[]) => elements.filter((element) => element.type === ChartSection)

describe("/facturacion · gráficos (CHART-036)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-15T15:00:00Z"))
  })
  afterEach(() => vi.useRealTimers())

  it("dibuja la serie mensual, un gráfico por moneda, sin los meses posteriores al período", async () => {
    const elements = await renderPage()
    const flows = sections(elements).filter((el) => String(el.props.title).startsWith("Facturado y cobrado"))
    expect(flows.map((el) => el.props.title)).toEqual(["Facturado y cobrado · CLP", "Facturado y cobrado · USD"])

    const charts = elements.filter((el) => el.type === BillingFlowChartLazy)
    expect(charts).toHaveLength(2)
    const clp = charts.find((el) => el.props.currency === "CLP")!
    // noviembre ($9.000.000) queda fuera: la página mira octubre.
    expect((clp.props.data as Array<{ period: string }>).map((row) => row.period)).toEqual(["2026-08", "2026-09", "2026-10"])
    expect(clp.props.variant).toBe("plain")
    // El mes en curso se marca parcial.
    expect(clp.props.partialPeriod).toBe("2026-10")
    // USD jamás se mezcla con CLP.
    const usd = charts.find((el) => el.props.currency === "USD")!
    expect(usd.props.data).toEqual([{ period: "2026-10", invoiced: 20, collected: 0 }])
  })

  it("cada gráfico trae su frase y su «Ver datos»", async () => {
    const [clp] = sections(await renderPage())
    expect(clp!.props.summary).toBe("Entre agosto y octubre de 2026 se facturaron $3.500.000 y el 57% está cobrado. Octubre de 2026 está en curso y su cifra es parcial.")
    const data = clp!.props.data as { headers: string[]; rows: string[][] }
    expect(data.headers).toEqual(["Mes", "Facturado", "Cobrado", "Cobrado %"])
    expect(data.rows).toHaveLength(3)
  })

  it("un período pasado no marca ningún mes como parcial", async () => {
    const page = await BillingSummaryPage({ searchParams: Promise.resolve({ periodo: "2026-09" }) })
    const chart = collectElements(page).find((el) => el.type === BillingFlowChartLazy && el.props.currency === "CLP")!
    expect(chart.props.partialPeriod).toBeUndefined()
    expect((chart.props.data as Array<{ period: string }>).at(-1)!.period).toBe("2026-09")
  })

  it("la antigüedad va en el orden de los días y su tabla es el «Ver datos»: no queda una tabla suelta", async () => {
    const elements = await renderPage()
    const aging = sections(elements).find((el) => el.props.title === "Antigüedad de la deuda")!
    expect(aging).toBeDefined()
    expect(aging.props.summary).toBe("El 58% del saldo lleva más de 30 días vencido: $700.000.")
    expect((aging.props.data as { headers: string[] }).headers).toEqual(["Tramo", "Facturas", "Saldo"])

    const chart = elements.find((el) => el.type === DebtAgingChart)!
    expect((chart.props.buckets as Array<{ key: string }>).map((bucket) => bucket.key)).toEqual(["not_due", "d1_30", "d31_60", "d61_90", "d90_plus"])
    expect(chart.props.variant).toBe("plain")
    // A5: la misma cifra no se representa dos veces.
    expect(elements.some((el) => el.type === TableRoot)).toBe(false)
  })

  it("clientes y faenas son listas por moneda, sin sumar CLP con USD", async () => {
    const elements = await renderPage()
    // `RankingSection` es un componente de la página (no exportado): se lo invoca para ver sus listas.
    const expand = (id: string) => {
      const section = elements.find((el) => el.props.id === id && typeof el.type === "function")!
      return collectElements((section.type as (props: unknown) => unknown)(section.props)).filter((el) => el.type === RankedList)
    }

    const clients = expand("clientes")
    const byLabel = (label: string) => clients.find((el) => el.props.ariaLabel === label)!

    const clientsClp = byLabel("Principales clientes del período en CLP")
    expect((clientsClp.props.items as Array<{ label: string }>).map((item) => item.label)).toEqual(["Minera A", "Minera B"])
    expect(clientsClp.props.format).toBe("clp")

    const clientsUsd = byLabel("Principales clientes del período en USD")
    expect((clientsUsd.props.items as Array<{ label: string }>).map((item) => item.label)).toEqual(["Cliente USD"])
    expect(clientsUsd.props.format).toBe("count")
    expect(clientsUsd.props.unit).toBe(" USD")

    // Con una sola moneda la lista no lleva sufijo ni rótulo de moneda.
    const worksites = expand("faenas")
    expect(worksites).toHaveLength(1)
    expect(worksites[0]!.props.ariaLabel).toBe("Facturación por faena")
  })

  it("«Facturado» se compara con el mes anterior por moneda y «Cobrado» no", async () => {
    const tiles = (await renderPage()).filter((el) => el.type === MoneyStat)
    const invoiced = tiles.find((el) => el.props.label === "Facturado en el período")!
    expect(invoiced.props.comparison).toEqual({ label: "vs. sep", changes: { CLP: 50, USD: null } })
    const collected = tiles.find((el) => el.props.label === "Cobrado del período")!
    expect(collected.props.comparison).toBeUndefined()
    // A1: no se agregan tiles.
    expect(tiles).toHaveLength(4)
  })
})
