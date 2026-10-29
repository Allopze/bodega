// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PanelData } from "@/lib/services/mantencion/panel"

// Recharts sólo corre en el navegador: el gráfico se prueba aparte y aquí basta saber que se monta.
vi.mock("./weekly-chart", () => ({ WeeklyChart: () => <div data-testid="weekly-chart" /> }))

const { FleetCard, HoursCard, NotDoneCard, UpcomingCard, WeeklyCard, WorkshopCard } = await import("./panel-cards")
const { PanelKpis, PanelStrip } = await import("./panel-kpis")

function panelData(overrides: Partial<PanelData> = {}): PanelData {
  return {
    filters: { period: "30" },
    today: "2026-10-28",
    from: "2026-09-29",
    records: { total: 12, preventive: 8, corrective: 4, hours: 17.5 },
    fleet: { active: 10, counts: { vencida: 3, proxima: 2, al_dia: 4, sin_lecturas: 1, sin_pauta: 0, baja: 0 } },
    workshop: {
      equipment: 2, stale: 1,
      rows: [{ recordId: "rec-1", folio: "MC-BIO-0001", code: "KA-135", plate: "RBYD-98", worksiteName: "Biodiversa", summary: "Cambio de bomba", daysStopped: 5, stale: true }],
    },
    stoppedDays: { total: 9, equipment: 2 },
    weeks: [{ start: "2026-10-19", preventive: 3, corrective: 1 }, { start: "2026-10-26", preventive: 2, corrective: 0 }],
    upcoming: [{ vehicleId: "veh-1", code: "KA-135", plate: "RBYD-98", worksiteName: "Biodiversa", scheduleName: "Camiones y tractos", unit: "km", reading: 40_312, nextReading: 40_000, remaining: -312, nextIntervalValue: 40_000, state: "vencida" }],
    hoursByWorksite: [{ worksiteId: "ws-1", worksiteName: "Biodiversa", hours: 12 }, { worksiteId: "ws-2", worksiteName: "Cholguán", hours: 5.5 }],
    notDone: [{ item: "Pastillas de freno", group: "Frenos", count: 4, lastReason: "Falta repuesto" }],
    ...overrides,
  }
}

describe("indicadores del panel (A1)", () => {
  afterEach(cleanup)

  it("son cuatro tarjetas y cada una lleva a su subconjunto", () => {
    const { container } = render(<PanelKpis data={panelData({ filters: { period: "30", worksiteId: "ws-1" } })} />)
    expect(container.querySelectorAll("[data-kpi-card]")).toHaveLength(4)
    const hrefOf = (name: RegExp) => screen.getByRole("link", { name }).getAttribute("href")
    expect(hrefOf(/^Registros · /)).toBe("/mantencion/registros?estado=vigente&desde=2026-09-29&faena=ws-1")
    expect(hrefOf(/^Mantenciones vencidas/)).toBe("/mantencion/equipos?estado=vencida&faena=ws-1")
    expect(hrefOf(/^Equipos en taller/)).toBe("/mantencion/registros?tipo=C&situacion=en_taller&estado=vigente&faena=ws-1")
    expect(hrefOf(/^Días fuera de servicio/)).toBe("/mantencion/registros?tipo=C&situacion=paso_taller&estado=vigente&desde=2026-09-29&faena=ws-1")
  })

  it("las vencidas se marcan en rojo con su cifra, y el taller dice cuántos están sin actualizar", () => {
    render(<PanelKpis data={panelData()} />)
    const overdue = screen.getByRole("link", { name: /^Mantenciones vencidas/ })
    expect(within(overdue).getByText("3")).toBeTruthy()
    expect(overdue.textContent).toContain("2 próximas a vencer")
    expect(screen.getByRole("link", { name: /^Equipos en taller/ }).textContent).toContain("1 sin actualizar hace más de 2 días")
  })

  it("sin vencidas ni equipos detenidos lo dice con palabras, no con ceros pelados", () => {
    render(<PanelKpis data={panelData({
      fleet: { active: 5, counts: { vencida: 0, proxima: 0, al_dia: 5, sin_lecturas: 0, sin_pauta: 0, baja: 0 } },
      workshop: { equipment: 0, stale: 0, rows: [] }, stoppedDays: { total: 0, equipment: 0 },
    })} />)
    expect(screen.getByRole("link", { name: /^Mantenciones vencidas/ }).textContent).toContain("Todas las pautas al día")
    expect(screen.getByRole("link", { name: /^Equipos en taller/ }).textContent).toContain("Ninguno detenido")
    expect(screen.getByRole("link", { name: /^Días fuera de servicio/ }).textContent).toContain("Ningún equipo detenido")
  })

  it("sin registros en el período el tile ofrece ampliar el período", () => {
    render(<PanelKpis data={panelData({ records: { total: 0, preventive: 0, corrective: 0, hours: 0 } })} />)
    const tile = screen.getByRole("link", { name: /^Registros · / })
    expect(tile.textContent).toContain("Aún no hay registros en este período")
    expect(tile.getAttribute("href")).toBe("/mantencion/panel?periodo=todo")
  })

  it("las horas hombre van en la tira de texto, no en una quinta tarjeta", () => {
    render(<PanelStrip data={panelData()} />)
    expect(screen.getByText(/Horas hombre/).textContent).toContain("17,5 h")
  })
})

describe("tarjetas del panel", () => {
  afterEach(cleanup)

  it("la flota dibuja una barra por estado y cada una lleva a Equipos filtrado", () => {
    render(<FleetCard data={panelData()} />)
    const bar = screen.getByRole("link", { name: "Vencida: 3 equipos. Ver esos equipos" })
    expect(bar.getAttribute("href")).toBe("/mantencion/equipos?estado=vencida")
    expect(screen.getByRole("link", { name: "Sin pauta: 0 equipos. Ver esos equipos" })).toBeTruthy()
  })

  it("una flota vacía lleva a Equipos en vez de mostrar barras en cero", () => {
    render(<FleetCard data={panelData({ fleet: { active: 0, counts: { vencida: 0, proxima: 0, al_dia: 0, sin_lecturas: 0, sin_pauta: 0, baja: 0 } } })} />)
    expect(screen.getByText("Aún no hay equipos en el módulo")).toBeTruthy()
    expect(screen.getByRole("link", { name: /Ir a Equipos/ })).toBeTruthy()
  })

  it("el gráfico semanal trae su tabla «Ver datos» con las semanas completas", () => {
    render(<WeeklyCard data={panelData()} />)
    expect(screen.getByTestId("weekly-chart")).toBeTruthy()
    const table = screen.getByRole("table", { name: "Registros por semana", hidden: true })
    expect(within(table).getByText("19-10 al 25-10")).toBeTruthy()
    expect(within(table).getByText("26-10 al 01-11")).toBeTruthy()
  })

  it("próximas mantenciones: equipo, lectura, falta o pasada y estado con texto", () => {
    render(<UpcomingCard data={panelData()} />)
    const table = screen.getByRole("table", { name: undefined })
    expect(within(table).getByRole("link", { name: "KA-135" }).getAttribute("href")).toBe("/mantencion/equipos/veh-1")
    expect(within(table).getByText("pasada por 312 km")).toBeTruthy()
    expect(within(table).getByText("Vencida")).toBeTruthy()
  })

  it("en taller ahora enlaza al registro y marca el que no se actualiza", () => {
    render(<WorkshopCard data={panelData()} />)
    const row = screen.getByRole("link", { name: /KA-135/ })
    expect(row.getAttribute("href")).toBe("/mantencion/registros/rec-1")
    expect(row.textContent).toContain("5 días")
    expect(row.textContent).toContain("Sin actualizar")
  })

  it("horas por faena y los ítems sin hacer con su último motivo", () => {
    render(<><HoursCard data={panelData()} /><NotDoneCard data={panelData()} /></>)
    expect(screen.getByRole("list", { name: "Horas de taller por faena" })).toBeTruthy()
    expect(screen.getByText("Pastillas de freno")).toBeTruthy()
    expect(screen.getByText(/último motivo: Falta repuesto/)).toBeTruthy()
  })

  it("sin datos cada tarjeta lo dice en vez de quedar vacía", () => {
    const empty = panelData({ upcoming: [], hoursByWorksite: [], notDone: [], workshop: { equipment: 0, stale: 0, rows: [] } })
    render(<><UpcomingCard data={empty} /><WorkshopCard data={empty} /><HoursCard data={empty} /><NotDoneCard data={empty} /></>)
    expect(screen.getByText("Todavía no hay mantenciones que calcular")).toBeTruthy()
    expect(screen.getByText("Ningún equipo en taller.")).toBeTruthy()
    expect(screen.getByText("Sin correctivas en el período.")).toBeTruthy()
    expect(screen.getByText("Todos los ítems se realizaron en el período.")).toBeTruthy()
  })
})
