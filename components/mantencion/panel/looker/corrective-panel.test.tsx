// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/mantencion/panel",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/components/charts/hours-records-combo-chart-lazy", () => ({
  HoursRecordsComboChartLazy: (props: { data: unknown[]; ariaLabel: string }) => <div data-testid="combo" aria-label={props.ariaLabel}>{props.data.length}</div>,
}))
vi.mock("@/components/charts/monthly-work-chart-lazy", () => ({
  MonthlyWorkChartLazy: (props: { data: unknown[]; selectedKey?: string | null }) => <div data-testid="months" data-selected={props.selectedKey ?? ""}>{props.data.length}</div>,
}))

import type { CorrectivePage, CorrectiveStats, CorrectiveWorkRow } from "@/lib/services/mantencion/looker/types"
import { CorrectivePanel, correctiveStatBar } from "./corrective-panel"

afterEach(cleanup)

const stats: CorrectiveStats = { total: 5, hours: 12.5, equipment: 3, photoEligible: 5, withoutPhoto: 1 }

function work(over: Partial<CorrectiveWorkRow> = {}): CorrectiveWorkRow {
  return {
    id: "ot:1", source: "ot", date: "2026-10-20", vehicleId: "v-1", recordId: null, code: "KA-143", plate: "SJFC-66", typeName: "Camión",
    unit: "km", reading: 345_000, readingText: null, reference: "33843", workPerformed: "Reparación de frenos del eje trasero",
    worksiteId: "ws-1", worksiteName: "Teno", hours: 4, photoId: null, photoUrl: null, drivers: ["JUAN PEREZ"], ...over,
  }
}

function panel(page: Partial<CorrectivePage> = {}, over: Partial<Parameters<typeof CorrectivePanel>[0]> = {}) {
  return render(
    <CorrectivePanel
      stats={stats}
      controlled={12}
      series={[{ vehicleId: "v-1", label: "SJFC-66", code: "KA-143", plate: "SJFC-66", records: 2, hours: 6 }]}
      drivers={[{ key: "juan perez", label: "JUAN PEREZ", records: 2, hours: 6 }]}
      monthly={[{ key: "2026-10", label: "oct 2026", count: 5, partial: false }]}
      page={{ rows: [work()], total: 1, page: 1, pageSize: 25, ...page }}
      unit="km"
      period={{ from: "2026-10-01", to: "2026-10-31" }}
      hrefForPage={(target) => `/mantencion/panel?page=${target}`}
      selected={{ workId: null, driverKey: null, equipmentId: null, monthKey: null }}
      {...over}
    />,
  )
}

describe("correctiveStatBar", () => {
  it("las cuatro cifras de la tira: trabajos, horas, equipos «de N controlados» y trabajos sin foto con su porcentaje", () => {
    const bar = correctiveStatBar({ total: 10, hours: 12.5, equipment: 3, photoEligible: 5, withoutPhoto: 1 }, 12)
    expect(bar.map((stat) => stat.label)).toEqual(["Trabajos correctivos", "Horas de trabajo", "Equipos con correctivo", "Sin foto de respaldo"])
    expect(bar[0]).toMatchObject({ value: 10 })
    expect(bar[1]).toMatchObject({ value: "12,5" })
    expect(bar[2]).toMatchObject({ value: 3, secondary: "de 12 controlados" })
    // Naranja (pendiente por subir), no rojo: no es una falla crítica.
    expect(bar[3]).toMatchObject({ value: 1, tone: "signal", secondary: "20 % de las OT y registros" })
  })

  it("el porcentaje sin foto cuenta sólo OT y registros: sin ninguno no inventa un 0 %", () => {
    const bar = correctiveStatBar({ total: 4, hours: 0, equipment: 1, photoEligible: 0, withoutPhoto: 0 }, 1)
    expect(bar[2]!.secondary).toBe("de 1 controlado")
    expect(bar[3]!.secondary).toBe("Sin OT ni registros de la plataforma")
  })
})

describe("CorrectivePanel", () => {
  it("una columna: la tira y dos secciones con su h2, sin la tabla de conductores", () => {
    panel()
    expect(screen.getByRole("heading", { level: 2, name: "¿Dónde se concentra el trabajo?" })).toBeTruthy()
    expect(screen.getByRole("heading", { level: 2, name: "Trabajos del período" })).toBeTruthy()
    expect(screen.getByText("Clic en un equipo, un conductor o un mes filtra el resto de la pestaña.")).toBeTruthy()
    expect(screen.queryByRole("table", { name: "Conductores del período" })).toBeNull()
    expect(screen.getByText("Trabajos correctivos")).toBeTruthy()
    expect(screen.getByTestId("combo").textContent).toBe("1")
    expect(screen.getByTestId("months")).toBeTruthy()
    // Las barras de conductores son botones reales con la cifra de horas y los registros.
    expect(screen.getByRole("button", { name: "JUAN PEREZ: 6 h" })).toBeTruthy()
  })

  it("sin ningún trabajo con equipo ni en ningún mes, los gráficos lo dicen en vez de dibujar ejes en cero", () => {
    panel({ rows: [], total: 0 }, {
      stats: { total: 0, hours: 0, equipment: 0, photoEligible: 0, withoutPhoto: 0 },
      series: [],
      drivers: [],
      monthly: [{ key: "2026-10", label: "oct 2026", count: 0, partial: false }],
    })
    expect(screen.queryByTestId("combo")).toBeNull()
    expect(screen.queryByTestId("months")).toBeNull()
    expect(screen.getByText("Sin trabajos con equipo en el período.")).toBeTruthy()
    expect(screen.getByText("Sin trabajos correctivos en el período.")).toBeTruthy()
    expect(screen.getByText("Sin conductores registrados en el período.")).toBeTruthy()
    expect(screen.getByText("Sin trabajos correctivos con estos filtros")).toBeTruthy()
  })

  it("el mes elegido llega al gráfico para atenuar los demás", () => {
    panel({}, { selected: { workId: null, driverKey: null, equipmentId: null, monthKey: "2026-10" } })
    expect(screen.getByTestId("months").dataset.selected).toBe("2026-10")
  })
})

describe("Trabajos del período", () => {
  it("la patente enlaza al historial del equipo con el período y la faena; el embudo y el folio filtran, no navegan", () => {
    panel()
    const link = screen.getAllByRole("link", { name: "SJFC-66" })[0]!
    const href = link.getAttribute("href")!
    expect(href).toContain("/mantencion/registros/historicos?")
    expect(href).toContain("equipo=v-1")
    expect(href).toContain("faena=ws-1")
    expect(href).toContain("desde=2026-10-01")
    expect(href).toContain("hasta=2026-10-31")
    expect(screen.getAllByRole("button", { name: "Filtrar el panel por SJFC-66" }).length).toBeGreaterThan(0)
    const toggle = screen.getAllByRole("button", { name: "Filtrar el panel por el trabajo OT 33843" })[0]!
    expect(toggle.getAttribute("aria-pressed")).toBe("false")
    expect(toggle.textContent).toBe("OT 33843")
  })

  it("muestra el trabajo completo, el conductor, las horas y el odómetro en la unidad del panel", () => {
    panel()
    const table = screen.getByRole("table", { name: "Trabajos correctivos del período" })
    expect(within(table).getByRole("columnheader", { name: "Odómetro" })).toBeTruthy()
    expect(within(table).getByText("Reparación de frenos del eje trasero")).toBeTruthy()
    expect(within(table).getByText("JUAN PEREZ")).toBeTruthy()
    expect(within(table).getByText("345.000 km")).toBeTruthy()
    expect(within(table).getByText("4 h")).toBeTruthy()
    expect(within(table).getByText("20-10-2026")).toBeTruthy()
  })

  it("en horas el encabezado es Horómetro y la lectura va en h", () => {
    panel({ rows: [work({ unit: "h", reading: 2_300 })] }, { unit: "h" })
    expect(screen.getByRole("columnheader", { name: "Horómetro" })).toBeTruthy()
    expect(screen.getByText("2.300 h")).toBeTruthy()
  })

  it("«Sin foto» dice texto (no sólo color): en aviso si la OT debería traerla y neutro en un formulario anterior", () => {
    panel({
      rows: [
        work({ id: "ot:1" }),
        work({ id: "h:2", source: "historial", reference: "33844", plate: "", vehicleId: null, code: "KA-9" }),
        work({ id: "r:3", source: "registro", reference: "MR-1", photoUrl: "https://drive.example/foto" }),
      ],
      total: 3,
    })
    const table = screen.getByRole("table", { name: "Trabajos correctivos del período" })
    const missing = within(table).getAllByText("Sin foto")
    expect(missing).toHaveLength(2)
    expect(missing[0]!.className).toContain("text-[var(--color-warning-ink)]")
    expect(missing[1]!.className).not.toContain("text-[var(--color-warning-ink)]")
    // Un formulario con enlace de respaldo lo ofrece, en otra pestaña.
    const photo = within(table).getByRole("link", { name: /Ver foto/ })
    expect(photo.getAttribute("href")).toBe("https://drive.example/foto")
    expect(photo.getAttribute("target")).toBe("_blank")
    expect(within(table).getByText("Formulario 33844")).toBeTruthy()
    expect(within(table).getByText("Registro MR-1")).toBeTruthy()
    // Un equipo que el formulario no pudo vincular no enlaza ni se puede filtrar.
    expect(within(table).queryByRole("button", { name: "Filtrar el panel por KA-9" })).toBeNull()
  })

  it("el trabajo elegido queda marcado y la página siguiente enlaza con la paginación del servidor", () => {
    panel({ total: 60 }, { selected: { workId: "ot:1", driverKey: null, equipmentId: null, monthKey: null } })
    const table = screen.getByRole("table", { name: "Trabajos correctivos del período" })
    expect(table.querySelector("tr[data-selected='true']")).toBeTruthy()
    expect(screen.getAllByRole("button", { name: "Filtrar el panel por el trabajo OT 33843" })[0]!.getAttribute("aria-pressed")).toBe("false")
    expect(screen.getByRole("link", { name: "Página siguiente" }).getAttribute("href")).toBe("/mantencion/panel?page=2")
  })
})
