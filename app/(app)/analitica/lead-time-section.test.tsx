// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { buildSupplyLeadTime, type LeadTimeItem } from "@/lib/services/analytics-module/lead-time-shape"
import { LEAD_TIME_MAX_WORKSITES, LeadTimeSection, leadTimeDataRows } from "./lead-time-section"

/** Día `d` desde 1970. */
const D = 20_000
const WINDOW = { current: [D, D + 30] as const, previous: [D - 31, D - 1] as const }

function item(over: Partial<LeadTimeItem> = {}): LeadTimeItem {
  return {
    worksiteId: "ws-a", worksiteName: "Faena A", requestType: "epp",
    submittedDay: D, approvedDay: D + 1, issuedDay: D + 3, arrivedDay: D + 9, deliveredDay: D + 10, closedDay: D + 10,
    ...over,
  }
}

const many = (count: number, over: Partial<LeadTimeItem> = {}) => Array.from({ length: count }, () => item(over))

describe("LeadTimeSection", () => {
  it("con datos: la frase, la barra con su n y los pies de nota (sólo lo cerrado, mínimo de ítems)", () => {
    render(<LeadTimeSection report={buildSupplyLeadTime(many(6), WINDOW)} ignoresFilters={false} />)

    expect(screen.getByRole("figure", { name: "Plazos del ciclo de abastecimiento" })).toBeInTheDocument()
    expect(screen.getByText(/La mitad de los 6 ítems cerrados tardó 10 días o menos/)).toBeInTheDocument()
    expect(screen.getByText(/Mediana 10 días · n = 6/)).toBeInTheDocument()
    expect(screen.getByText(/Sólo cuenta ítems ya cerrados/)).toBeInTheDocument()
    expect(screen.getByText(/al menos 5 ítems para publicarse/)).toBeInTheDocument()
  })

  it("con pocos ítems dice «datos insuficientes» con el n, nunca una cifra", () => {
    render(<LeadTimeSection report={buildSupplyLeadTime(many(3), WINDOW)} ignoresFilters={false} />)

    expect(screen.getByText(/Datos insuficientes: hay 3 ítems cerrados en el período/)).toBeInTheDocument()
    expect(screen.getAllByText(/Datos insuficientes · n = 3/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Mediana \d/)).toBeNull()
  })

  it("sin ítems cerrados explica el vacío y qué hacer, en vez de dibujar ejes en cero", () => {
    render(<LeadTimeSection report={buildSupplyLeadTime([], WINDOW)} ignoresFilters={false} />)

    expect(screen.getByText("Ningún ítem se cerró en el período")).toBeInTheDocument()
    expect(screen.getByText(/Amplía el rango de fechas/)).toBeInTheDocument()
  })

  it("si la consulta falló lo dice (no se confunde con «no hay datos»)", () => {
    render(<LeadTimeSection report={null} ignoresFilters={false} />)

    expect(screen.getByText("No se pudieron calcular los plazos")).toBeInTheDocument()
    expect(screen.queryByText("Ningún ítem se cerró en el período")).toBeNull()
  })

  it("declara los filtros que no aplica y las mediciones excluidas por fechas fuera de orden", () => {
    const report = buildSupplyLeadTime([...many(5), item({ approvedDay: D + 5, issuedDay: D + 3 })], WINDOW)
    render(<LeadTimeSection report={report} ignoresFilters />)

    expect(screen.getByText("Este gráfico respeta el período, la faena y el proveedor; no el vehículo.")).toBeInTheDocument()
    expect(screen.getByText(/1 medición con fechas fuera de orden/)).toBeInTheDocument()
  })

  it("con proveedor elegido lo dice y explica cómo se mide; sin él no habla de proveedor", () => {
    const report = { ...buildSupplyLeadTime(many(6), WINDOW), filters: { supplierId: "prov-1" } }
    const { unmount } = render(<LeadTimeSection report={report} ignoresFilters={false} />)
    expect(screen.getByText(/Con proveedor elegido sólo cuenta los ítems comprados a él/)).toBeInTheDocument()
    expect(screen.queryByText(/no el vehículo/)).toBeNull()
    unmount()

    render(<LeadTimeSection report={buildSupplyLeadTime(many(6), WINDOW)} ignoresFilters={false} />)
    expect(screen.queryByText(/Con proveedor elegido/)).toBeNull()
  })

  it("con proveedor y sin ítems cerrados el vacío nombra al proveedor como posible causa", () => {
    const report = { ...buildSupplyLeadTime([], WINDOW), filters: { supplierId: "prov-1" } }
    render(<LeadTimeSection report={report} ignoresFilters={false} />)

    expect(screen.getByText(/Ningún ítem comprado a ese proveedor/)).toBeInTheDocument()
    expect(screen.getByText(/quita el filtro de proveedor/)).toBeInTheDocument()
  })

  it("con varias faenas dibuja el total y cada faena; con una sola no repite la barra", () => {
    const two = buildSupplyLeadTime([...many(5), ...many(5, { worksiteId: "ws-b", worksiteName: "Faena B" })], WINDOW)
    const { unmount } = render(<LeadTimeSection report={two} ignoresFilters={false} />)
    const list = screen.getByRole("list", { name: "Plazos del ciclo de abastecimiento por faena" })
    expect(within(list).getAllByText(/^(Total|Faena A|Faena B)$/)).toHaveLength(3)
    unmount()

    render(<LeadTimeSection report={buildSupplyLeadTime(many(6), WINDOW)} ignoresFilters={false} />)
    expect(within(screen.getByRole("list", { name: "Plazos del ciclo de abastecimiento por faena" })).getAllByText(/^(Total|Faena A)$/)).toHaveLength(1)
  })

  it("las faenas que no caben van a «Ver datos» y se dice cuántas", () => {
    const items = Array.from({ length: LEAD_TIME_MAX_WORKSITES + 2 }, (_, index) => many(5, { worksiteId: `ws-${index}`, worksiteName: `Faena ${index}` })).flat()
    render(<LeadTimeSection report={buildSupplyLeadTime(items, WINDOW)} ignoresFilters={false} />)

    expect(screen.getByText(/Se dibujan las 8 faenas con más ítems cerrados.*2 faenas más/)).toBeInTheDocument()
  })
})

describe("leadTimeDataRows", () => {
  it("cada grupo trae sus cuatro tramos y el total, siempre con n; un tramo sin muestra dice «Datos insuficientes»", () => {
    const report = buildSupplyLeadTime(many(6, { deliveredDay: null }), WINDOW)
    const rows = leadTimeDataRows([report.overall])

    expect(rows).toHaveLength(5)
    expect(rows.find((row) => String(row[0]).endsWith("Aprobación"))).toEqual(["Total · Aprobación", "1 día", "—", 6])
    expect(rows.find((row) => String(row[0]).endsWith("Entrega"))).toEqual(["Total · Entrega", "Datos insuficientes", "—", 0])
    expect(rows.at(-1)).toEqual(["Total · Plazo total", "10 días", "—", 6])
  })
})

describe("LeadTimeSection · ítems más lentos", () => {
  const named = (i: number, over: Partial<LeadTimeItem> = {}) => item({
    itemId: `it-${i}`, requestId: `req-${i}`, requestCode: `SOL-00${i}`, productName: `Guantes ${i}`,
    arrivedDay: D + 9 + i, deliveredDay: D + 10 + i, closedDay: D + 10 + i, ...over,
  })
  const report = () => buildSupplyLeadTime(Array.from({ length: 6 }, (_, i) => named(i)), WINDOW)

  it("lista los ítems cerrados que más tardaron, con los días de cada tramo y el total", () => {
    render(<LeadTimeSection report={report()} ignoresFilters={false} />)

    const table = screen.getByRole("table", { name: /Ítems cerrados que más tardaron/ })
    const rows = within(table).getAllByRole("row")
    // Encabezado + 6 ítems; el más lento (i = 5, 15 días) primero.
    expect(rows).toHaveLength(7)
    expect(within(rows[1]!).getByText("SOL-005")).toBeInTheDocument()
    expect(within(rows[1]!).getByText("15 días")).toBeInTheDocument()
    expect(screen.getByText("Ítems más lentos (6)")).toBeInTheDocument()
  })

  it("sin permisos de enlace el código y el producto son texto: no se ofrece un enlace que el destino rechazaría", () => {
    render(<LeadTimeSection report={report()} ignoresFilters={false} />)

    const table = screen.getByRole("table", { name: /Ítems cerrados que más tardaron/ })
    expect(within(table).queryAllByRole("link")).toHaveLength(0)
  })

  it("con permiso, la solicitud y el ítem enlazan a su ficha", () => {
    render(<LeadTimeSection report={report()} ignoresFilters={false} itemLinks={{ requests: true, tracking: true }} />)

    const table = screen.getByRole("table", { name: /Ítems cerrados que más tardaron/ })
    expect(within(table).getByRole("link", { name: "SOL-005" })).toHaveAttribute("href", "/solicitudes/req-5")
    expect(within(table).getByRole("link", { name: "Guantes 5" })).toHaveAttribute("href", "/seguimiento/it-5")
  })

  it("cada permiso es independiente: sólo seguimiento deja la solicitud como texto", () => {
    render(<LeadTimeSection report={report()} ignoresFilters={false} itemLinks={{ requests: false, tracking: true }} />)

    const table = screen.getByRole("table", { name: /Ítems cerrados que más tardaron/ })
    expect(within(table).queryByRole("link", { name: "SOL-005" })).toBeNull()
    expect(within(table).getByRole("link", { name: "Guantes 5" })).toBeInTheDocument()
  })

  it("un tramo que no se pudo medir dice «—», no 0 días", () => {
    const items = [...Array.from({ length: 5 }, (_, i) => named(i)), named(9, { deliveredDay: null, closedDay: D + 9 })]
    render(<LeadTimeSection report={buildSupplyLeadTime(items, WINDOW)} ignoresFilters={false} />)

    const row = within(screen.getByRole("table", { name: /Ítems cerrados que más tardaron/ })).getAllByRole("row").find((r) => within(r).queryByText("SOL-009"))!
    expect(within(row).getAllByRole("cell").some((cell) => cell.textContent === "—")).toBe(true)
  })

  it("un informe en caché sin la lista (forma anterior) no rompe la tarjeta", () => {
    const old = { ...report() } as Partial<ReturnType<typeof report>> as ReturnType<typeof report>
    delete (old as { slowest?: unknown }).slowest
    render(<LeadTimeSection report={old} ignoresFilters={false} />)

    expect(screen.queryByText(/Ítems más lentos/)).toBeNull()
    expect(screen.getByRole("figure", { name: "Plazos del ciclo de abastecimiento" })).toBeInTheDocument()
  })
})
