import { beforeEach, describe, expect, it, vi } from "vitest"

const requirePermission = vi.hoisted(() => vi.fn())
const can = vi.hoisted(() => vi.fn())
const getAnalyticsDashboard = vi.hoisted(() => vi.fn())
const getFilterOptions = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ requirePermission, can }))
// ANA-002/PER-T02: la página ya no llama al servicio directo sino a su entrada
// cacheada (`read-model-cache`); el doble se mueve ahí. Lo que esta prueba
// verifica —qué secciones se pintan según permisos— no cambia.
vi.mock("@/lib/services/read-model-cache", () => ({ getCachedAnalyticsDashboard: getAnalyticsDashboard }))
vi.mock("@/lib/services/analytics", () => ({
  normalizeAnalyticsFilters: (filters: Record<string, unknown>) => ({
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    ...filters,
  }),
}))
vi.mock("./analytics-page.helpers", () => ({
  getFilterOptions,
  getParam: () => undefined,
}))

import AnaliticaPage from "./page"

const analyticsOnlySession = {
  user: { id: "analytics-only", permissions: ["analytics:view"], isGlobal: true, worksiteIds: [] },
}

function collectElements(node: unknown, result: Array<{ type: unknown; props: Record<string, unknown> }> = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => collectElements(child, result))
    return result
  }
  if (!node || typeof node !== "object" || !("props" in node)) return result
  const element = node as { type: unknown; props: Record<string, unknown> }
  result.push(element)
  Object.values(element.props).forEach((value) => collectElements(value, result))
  return result
}

function typeName(type: unknown) {
  if (type && typeof type === "object" && "displayName" in type) {
    const displayName = (type as { displayName?: unknown }).displayName
    if (typeof displayName === "string") return displayName
  }
  return typeof type === "function" ? type.name : String(type)
}

beforeEach(() => {
  vi.clearAllMocks()
  requirePermission.mockResolvedValue(analyticsOnlySession)
  can.mockImplementation((session, permission) => session.user.permissions.includes(permission))
  getFilterOptions.mockResolvedValue({ worksites: [], suppliers: [], vehicles: [] })
  getAnalyticsDashboard.mockResolvedValue({
    filters: { fromDate: "2026-08-01", toDate: "2026-08-31" },
    kpis: {
      totalSpend: 0,
      previousTotalSpend: 0,
      spendVariationPct: 0,
      purchaseOrderCount: 0,
      pendingApprovals: 0,
      fuelAmount: 0,
      fuelLiters: 0,
      fuelLoadCount: 0,
      averageOrderAmount: 0,
    },
    spendByMonth: [],
    spendByModule: [],
    topSuppliers: [{ id: "supplier-1", name: "Proveedor", module: "Compras", totalAmount: 10, count: 1 }],
    topWorksites: [],
    vehicleCosts: [],
    productRotation: [],
    eppDeliveries: [{ productId: "epp-1", productName: "EPP", workerName: "Trabajador", worksiteName: "Faena", totalQty: 1, deliveryCount: 1 }],
    recentOrders: [{ id: "order-1", code: "OC-1", worksiteName: "Faena", supplierName: "Proveedor", totalAmount: 10, createdAt: "2026-08-01" }],
    alerts: [],
    dataGaps: [],
  })
})

describe("AnaliticaPage capability matrix", () => {
  it("analytics:view aislado no presenta combustible como cero ni enlaces a módulos ajenos", async () => {
    const page = await AnaliticaPage({ searchParams: Promise.resolve({}) })
    const elements = collectElements(page)
    const hrefs = elements.flatMap((element) => typeof element.props.href === "string" ? [element.props.href] : [])
    const kpiLabels = elements
      .filter((element) => typeName(element.type) === "KpiCard")
      .map((element) => element.props.label)
    const cardTitles = elements
      .filter((element) => typeName(element.type) === "CardTitle")
      .map((element) => element.props.children)

    expect(kpiLabels).not.toContain("Combustible")
    expect(cardTitles.some((title) => String(title).includes("Vehículos con mayor"))).toBe(false)
    expect(hrefs.some((href) => href.startsWith("/combustibles"))).toBe(false)
    expect(hrefs.some((href) => href.startsWith("/compras"))).toBe(false)
    expect(hrefs.some((href) => href.startsWith("/bodega"))).toBe(false)
    expect(hrefs.some((href) => href.startsWith("/entregas"))).toBe(false)
    expect(hrefs.some((href) => href.startsWith("/reportes"))).toBe(false)
  })
})

/*
 * Fase 0 · 0.2 (AUDITORIA_VISUALIZACIONES_CHOME.md, CHART-033). «Gasto total» no
 * pasaba `trendPolarity` y `KpiCard` cae en `"up-good"`: un alza de gasto del
 * 133 % se pintaba en verde (éxito) y una baja del 100 % en rojo. Para dinero
 * gastado subir es mala noticia, igual que en el tablero
 * (`ORDERS_SPEND_TREND_POLARITY`).
 */
describe("AnaliticaPage · polaridad de las variaciones (0.2)", () => {
  it("«Gasto total» declara que subir es malo", async () => {
    const data = await getAnalyticsDashboard()
    getAnalyticsDashboard.mockResolvedValue({
      ...data,
      kpis: { ...data.kpis, totalSpend: 233, previousTotalSpend: 100, spendVariationPct: 133 },
    })

    const page = await AnaliticaPage({ searchParams: Promise.resolve({}) })
    const spend = collectElements(page).find(
      (element) => typeName(element.type) === "KpiCard" && element.props.label === "Gasto total",
    )

    expect(spend, "el tile «Gasto total» debe existir").toBeDefined()
    expect(spend!.props.trend).toBe(133)
    // Sin esto el default `up-good` colorea de verde el alza de gasto.
    expect(spend!.props.trendPolarity).toBe("up-bad")
  })

  it("ningún tile con variación depende del default `up-good`", async () => {
    // Un tile que recibe `trend` sin declarar polaridad hereda "subir es bueno":
    // hoy sólo «Gasto total» tiene variación, y esta guarda obliga a decidirlo
    // explícitamente si otro tile suma una.
    const page = await AnaliticaPage({ searchParams: Promise.resolve({}) })
    const withTrend = collectElements(page).filter(
      (element) => typeName(element.type) === "KpiCard" && element.props.trend !== undefined,
    )

    expect(withTrend.length).toBeGreaterThan(0)
    for (const tile of withTrend) {
      expect(tile.props.trendPolarity, `tile «${String(tile.props.label)}»`).toBeDefined()
    }
  })
})

/*
 * C-10 y «Alertas» (AUDITORIA_VISUALIZACIONES_CHOME.md, CHART-033, Anexo C).
 * La tendencia mensual dice qué ventana dibuja —antes un solo punto sin
 * explicación— y el tile «Alertas» lleva a la tarjeta «Alertas accionables» de
 * la misma pantalla, no a /dashboard (que no muestra esas alertas).
 */
describe("AnaliticaPage · tendencia de 12 meses y tile «Alertas»", () => {
  it("el subtítulo de la tendencia nombra la ventana real: 12 meses hasta el mes de `hasta`", async () => {
    const page = await AnaliticaPage({ searchParams: Promise.resolve({}) })
    const descriptions = collectElements(page)
      .filter((element) => typeName(element.type) === "CardDescription")
      .map((element) => String(element.props.children))

    expect(descriptions).toContain("Últimos 12 meses hasta ago-2026")
  })

  it("avisa que el último mes es parcial cuando `hasta` no lo cierra", async () => {
    const data = await getAnalyticsDashboard()
    getAnalyticsDashboard.mockResolvedValue({
      ...data,
      spendByMonth: [
        { month: "2026-07", purchasingAmount: 1, fuelAmount: 0, totalAmount: 1, partial: false },
        { month: "2026-08", purchasingAmount: 1, fuelAmount: 0, totalAmount: 1, partial: true },
      ],
    })

    const page = await AnaliticaPage({ searchParams: Promise.resolve({}) })
    const descriptions = collectElements(page)
      .filter((element) => typeName(element.type) === "CardDescription")
      .map((element) => String(element.props.children))

    expect(descriptions).toContain("Últimos 12 meses hasta ago-2026 · el último mes es parcial")
  })

  it("el tile «Alertas» enlaza a la tarjeta «Alertas accionables» de la misma página", async () => {
    const page = await AnaliticaPage({ searchParams: Promise.resolve({}) })
    const elements = collectElements(page)
    const tile = elements.find((element) => typeName(element.type) === "KpiCard" && element.props.label === "Alertas")
    const target = elements.find((element) => element.props.id === "alertas")

    expect(tile, "el tile «Alertas» debe existir").toBeDefined()
    expect(tile!.props.href).toBe("#alertas")
    expect(target, "debe existir el destino con id=\"alertas\"").toBeDefined()
    expect(typeName(target!.type)).toBe("Card")
    // El destino es la tarjeta que se llama «Alertas accionables».
    const titles = collectElements(target!.props.children)
      .filter((element) => typeName(element.type) === "CardTitle")
      .map((element) => element.props.children)
    expect(titles).toContain("Alertas accionables")
    // Enfocable por programa (el enlace de ancla mueve el foco al destino) y con margen
    // de scroll, como las demás anclas del producto.
    expect(target!.props.tabIndex).toBe(-1)
    expect(String(target!.props.className)).toContain("scroll-mt-")
  })

  it("el id del destino es único en la página", async () => {
    const page = await AnaliticaPage({ searchParams: Promise.resolve({}) })
    const ids = collectElements(page).filter((element) => element.props.id === "alertas")
    expect(ids).toHaveLength(1)
  })
})
