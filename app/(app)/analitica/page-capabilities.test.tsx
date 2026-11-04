import { beforeEach, describe, expect, it, vi } from "vitest"

const requirePermission = vi.hoisted(() => vi.fn())
const can = vi.hoisted(() => vi.fn())
const getAnalyticsDashboard = vi.hoisted(() => vi.fn())
const getFilterOptions = vi.hoisted(() => vi.fn())
const getSupplyLeadTime = vi.hoisted(() => vi.fn())

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
// CHART-029: los plazos del ciclo salen de su propia consulta (con prueba PGlite propia); acá sólo interesa qué se pinta.
vi.mock("@/lib/services/analytics-module/lead-time", () => ({ getSupplyLeadTime }))
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

/** Todo el texto literal del árbol, en orden: las frases con partes en negrita quedan cortadas en varios hijos. */
function allText(node: unknown): string {
  if (typeof node === "string") return node
  if (Array.isArray(node)) return node.map(allText).join("")
  if (!node || typeof node !== "object" || !("props" in node)) return ""
  return allText((node as { props: { children?: unknown } }).props.children)
}

function typeName(type: unknown) {
  if (type && typeof type === "object" && "displayName" in type) {
    const displayName = (type as { displayName?: unknown }).displayName
    if (typeof displayName === "string") return displayName
  }
  return typeof type === "function" ? type.name : String(type)
}

const noStat = { n: 0, median: null, p90: null, insufficient: true }
function emptyLeadTime() {
  const group = { key: "all", label: "Todas las faenas", closedItems: 0, stages: [], total: noStat }
  return { overall: group, byWorksite: [], previousTotal: noStat, outOfOrder: 0, filters: { fromDate: "2026-08-01", toDate: "2026-08-31" } }
}

beforeEach(() => {
  vi.clearAllMocks()
  requirePermission.mockResolvedValue(analyticsOnlySession)
  can.mockImplementation((session, permission) => session.user.permissions.includes(permission))
  getFilterOptions.mockResolvedValue({ worksites: [], suppliers: [], vehicles: [] })
  getSupplyLeadTime.mockResolvedValue(emptyLeadTime())
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
    recentOrders: [{ id: "order-1", code: "OC-1", worksiteName: "Faena", supplierName: "Proveedor", totalAmount: 10, issuedAt: "2026-08-01" }],
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
      .filter((element) => typeName(element.type) === "CardTitle" || typeName(element.type) === "ChartSection")
      .map((element) => element.props.children ?? element.props.title)

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
  it("«Gasto total (con IVA)» declara que subir es malo", async () => {
    const data = await getAnalyticsDashboard()
    getAnalyticsDashboard.mockResolvedValue({
      ...data,
      kpis: { ...data.kpis, totalSpend: 233, previousTotalSpend: 100, spendVariationPct: 133 },
    })

    const page = await AnaliticaPage({ searchParams: Promise.resolve({}) })
    const spend = collectElements(page).find(
      (element) => typeName(element.type) === "KpiCard" && element.props.label === "Gasto total (con IVA)",
    )

    expect(spend, "el tile «Gasto total (con IVA)» debe existir").toBeDefined()
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
const section = (page: unknown, title: string) =>
  collectElements(page).find((element) => typeName(element.type) === "ChartSection" && element.props.title === title)

const spendMonths = (partial: boolean) => [
  { month: "2026-07", purchasingAmount: 10, fuelAmount: 0, totalAmount: 10, partial: false },
  { month: "2026-08", purchasingAmount: 1, fuelAmount: 0, totalAmount: 1, partial, },
]

describe("AnaliticaPage · tendencia de 12 meses y tile «Alertas»", () => {
  it("la frase de la tendencia nombra la ventana real: 12 meses hasta el mes de `hasta`", async () => {
    const data = await getAnalyticsDashboard()
    getAnalyticsDashboard.mockResolvedValue({ ...data, spendByMonth: spendMonths(false) })

    const page = await AnaliticaPage({ searchParams: Promise.resolve({}) })
    const trend = section(page, "Tendencia mensual de gasto (con IVA)")

    expect(String(trend?.props.summary)).toContain("Últimos 12 meses hasta ago-2026")
  })

  it("avisa que el último mes es parcial cuando `hasta` no lo cierra", async () => {
    const data = await getAnalyticsDashboard()
    getAnalyticsDashboard.mockResolvedValue({ ...data, spendByMonth: spendMonths(true) })

    const page = await AnaliticaPage({ searchParams: Promise.resolve({}) })

    expect(String(section(page, "Tendencia mensual de gasto (con IVA)")?.props.summary)).toContain("el último mes es parcial")
  })

  it("sin gasto en la ventana la tarjeta explica el vacío en vez de dibujar ejes en cero", async () => {
    const page = await AnaliticaPage({ searchParams: Promise.resolve({}) })
    const trend = section(page, "Tendencia mensual de gasto (con IVA)")

    expect(trend?.props.empty).toMatchObject({ label: "Aún no hay gasto en los últimos 12 meses" })
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

/*
 * CHART-033 (AUDITORIA_VISUALIZACIONES_CHOME.md): Pareto de proveedores en lugar de la tabla «Top proveedores»
 * (un gráfico no repite una tabla debajo: A5), rankings en `RankedList` y la base de fecha dicha en pantalla.
 */
describe("AnaliticaPage · Pareto de proveedores, rankings y base de las cifras (CHART-033)", () => {
  const fuelPermissions = ["analytics:view", "combustibles:view", "combustibles:view_costs", "purchasing:view"]

  async function renderWith(patch: Record<string, unknown> = {}, permissions = fuelPermissions) {
    requirePermission.mockResolvedValue({ user: { ...analyticsOnlySession.user, permissions } })
    const data = await getAnalyticsDashboard()
    getAnalyticsDashboard.mockResolvedValue({ ...data, ...patch })
    return AnaliticaPage({ searchParams: Promise.resolve({}) })
  }

  const suppliers = [
    { id: "s-1", name: "Ferretería Sur", module: "Compras", totalAmount: 700, count: 4 },
    { id: "s-2", name: "Copec", module: "Combustible", totalAmount: 200, count: 30 },
  ]

  it("el Pareto reemplaza a la tabla «Top proveedores»: la cifra no va dos veces", async () => {
    const page = await renderWith({ topSuppliers: suppliers, kpis: { totalSpend: 1000, previousTotalSpend: 0, spendVariationPct: null, purchaseOrderCount: 4, pendingApprovals: 0, fuelAmount: 200, fuelLiters: 0, fuelLoadCount: 30, averageOrderAmount: 175 } })
    const elements = collectElements(page)

    expect(section(page, "Concentración del gasto por proveedor (con IVA)")).toBeDefined()
    const tableTitles = elements.filter((element) => typeName(element.type) === "RankingTable").map((element) => element.props.title)
    expect(tableTitles).not.toContain("Top proveedores")
    expect(String(section(page, "Concentración del gasto por proveedor (con IVA)")?.props.summary)).toBe(
      "Ferretería Sur concentra el 70% del gasto; los 2 mayores proveedores, el 90%. Supera el umbral de concentración (60%).",
    )
  })

  it("el enlace de cada proveedor lleva a SU lista y al MISMO período (la base de fecha es emisión)", async () => {
    const page = await renderWith({ topSuppliers: suppliers, kpis: { totalSpend: 1000, previousTotalSpend: 0, spendVariationPct: null, purchaseOrderCount: 4, pendingApprovals: 0, fuelAmount: 200, fuelLiters: 0, fuelLoadCount: 30, averageOrderAmount: 175 } })
    const hrefs = collectElements((section(page, "Concentración del gasto por proveedor (con IVA)")?.props.data as { rows: unknown[] }).rows).flatMap((element) => typeof element.props.href === "string" ? [element.props.href] : [])

    expect(hrefs).toContain("/compras?desde=2026-08-01&hasta=2026-08-31&proveedor=s-1")
    expect(hrefs.some((href) => href.startsWith("/combustibles/consumo/litros") && href.endsWith("proveedor=s-2"))).toBe(true)
  })

  it("sin costos de combustible la frase no llama «el gasto» a lo que sólo son compras", async () => {
    const page = await renderWith(
      { topSuppliers: [suppliers[0]], kpis: { totalSpend: 1000, previousTotalSpend: 0, spendVariationPct: null, purchaseOrderCount: 4, pendingApprovals: 0, fuelAmount: 0, fuelLiters: 0, fuelLoadCount: 0, averageOrderAmount: 175 } },
      ["analytics:view", "purchasing:view"],
    )

    expect(String(section(page, "Concentración del gasto por proveedor (con IVA)")?.props.summary)).toContain("del gasto en compras")
  })

  it("con el filtro de proveedor activo el Pareto no se dibuja y dice por qué", async () => {
    const page = await renderWith({ topSuppliers: [suppliers[0]], filters: { fromDate: "2026-08-01", toDate: "2026-08-31", supplierId: "s-1" } })

    expect(section(page, "Concentración del gasto por proveedor (con IVA)")?.props.empty).toMatchObject({ label: "El Pareto compara proveedores entre sí" })
  })

  it("dice cuál es la base de fecha del gasto: emisión, con impuestos, igual que el tablero", async () => {
    const page = await renderWith()
    const text = allText(page)

    expect(text).toContain("emitió")
    expect(text).toContain("con IVA incluido")
    expect(text).toContain("con IVA e impuesto específico incluidos")
    expect(text).toContain("misma definición de Finanzas en el tablero")
  })

  it("la base con IVA se ve en el título de cada cifra de gasto, no sólo en la nota del pie", async () => {
    const page = await renderWith({
      kpis: { totalSpend: 1000, previousTotalSpend: 0, spendVariationPct: null, purchaseOrderCount: 4, pendingApprovals: 0, fuelAmount: 200, fuelLiters: 0, fuelLoadCount: 30, averageOrderAmount: 175 },
      spendByModule: [{ module: "EPP", totalAmount: 700 }, { module: "Combustible", totalAmount: 200 }],
      topWorksites: [{ id: "w-1", name: "Faena Norte", totalAmount: 600 }],
      vehicleCosts: [{ id: "v-1", plate: "AA-BB-11", type: "camioneta", totalFuelAmount: 300, totalLiters: 100, loadCount: 3, lastOdometerReading: null, lastHourMeterReading: null }],
    })
    const elements = collectElements(page)
    const chartTitles = elements.filter((element) => typeName(element.type) === "ChartSection").map((element) => String(element.props.title))
    const kpiLabels = elements.filter((element) => typeName(element.type) === "KpiCard").map((element) => element.props.label)

    expect(kpiLabels).toContain("Gasto total (con IVA)")
    expect(chartTitles).toEqual(expect.arrayContaining([
      "Tendencia mensual de gasto (con IVA)",
      "Gasto por tipo (con IVA)",
      "Concentración del gasto por proveedor (con IVA)",
      "Faenas con mayor gasto (con IVA)",
      "Vehículos con mayor gasto de combustible (con IVA)",
    ]))
    // El monto de la tabla de OC recientes también es con IVA.
    const orders = elements.find((element) => typeName(element.type) === "RankingTable" && element.props.title === "Órdenes de compra emitidas recientemente")
    expect(orders!.props.headers).toContain("Monto con IVA")
    const averageTile = elements.find((element) => typeName(element.type) === "KpiCard" && element.props.label === "Órdenes de compra")
    expect(String(averageTile!.props.detail)).toBe("Promedio con IVA $175")
  })

  it("faenas y vehículos son rankings de un tono, no gráficos con un color por barra", async () => {
    const page = await renderWith({
      topWorksites: [{ id: "w-1", name: "Faena Norte", totalAmount: 600 }, { id: "w-2", name: "Faena Sur", totalAmount: 400 }],
      vehicleCosts: [{ id: "v-1", plate: "AA-BB-11", type: "camioneta", totalFuelAmount: 300, totalLiters: 100, loadCount: 3, lastOdometerReading: null, lastHourMeterReading: null }],
    })
    const ranked = collectElements(page).filter((element) => typeName(element.type) === "RankedList").map((element) => element.props.ariaLabel)

    expect(ranked).toEqual(expect.arrayContaining(["Faenas con mayor gasto", "Vehículos con mayor gasto de combustible", "Gasto por tipo"]))
    expect(String(section(page, "Faenas con mayor gasto (con IVA)")?.props.summary)).toBe("Faena Norte lidera con $600: 60% de lo listado.")
  })

  it("el gráfico de plazos aparece con su n y, si la consulta falla, lo dice en vez de quedar vacío", async () => {
    getSupplyLeadTime.mockRejectedValueOnce(new Error("boom"))
    const page = await renderWith()
    const leadTime = collectElements(page).find((element) => typeName(element.type) === "LeadTimeSection")

    expect(leadTime, "la sección de plazos debe renderizarse").toBeDefined()
    expect(leadTime!.props.report).toBeNull()
  })

  it("el filtro de proveedor o vehículo se declara como no aplicado a los plazos", async () => {
    const page = await renderWith({ filters: { fromDate: "2026-08-01", toDate: "2026-08-31", vehicleId: "v-1" } })
    const leadTime = collectElements(page).find((element) => typeName(element.type) === "LeadTimeSection")

    expect(leadTime!.props.ignoresFilters).toBe(true)
  })
})
