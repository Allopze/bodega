// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PanelData } from "@/lib/services/mantencion/panel"

// Recharts sólo corre en el navegador: el gráfico se prueba aparte y aquí basta saber que se monta.
vi.mock("./weekly-chart", () => ({ WeeklyChart: () => <div data-testid="weekly-chart" /> }))

const { FleetCard, HoursCard, NotDoneCard, UpcomingCard, WeeklyCard, WorkshopCard } = await import("./panel-cards")
const { PanelKpis, PanelStrip } = await import("./panel-kpis")

const NO_COUNTS = { vencida: 0, proxima: 0, al_dia: 0, sin_lecturas: 0, sin_pauta: 0, baja: 0 }

function panelData(overrides: Partial<PanelData> = {}): PanelData {
  return {
    filters: { period: "30" },
    today: "2026-10-28",
    from: "2026-09-29",
    records: { total: 12, preventive: 8, corrective: 4, hours: 17.5, pendingReview: 5 },
    fleet: { active: 10, counts: { vencida: 3, proxima: 2, al_dia: 4, sin_lecturas: 1, sin_pauta: 0, baja: 0 } },
    workshop: {
      equipment: 2, stale: 1,
      rows: [{ recordId: "rec-1", folio: "MC-BIO-0001", code: "KA-135", plate: "RBYD-98", worksiteName: "Biodiversa", summary: "Cambio de bomba", reason: "Espera repuesto de Santiago", daysStopped: 5, stale: true }],
    },
    stoppedDays: { total: 9, equipment: 2 },
    weeks: [{ start: "2026-10-19", preventive: 3, corrective: 1 }, { start: "2026-10-26", preventive: 2, corrective: 0 }],
    upcoming: [{ vehicleId: "veh-1", code: "KA-135", plate: "RBYD-98", worksiteName: "Biodiversa", scheduleName: "Camiones y tractos", unit: "km", reading: 40_312, nextReading: 40_000, remaining: -312, nextIntervalValue: 40_000, state: "vencida", workshopDays: null }],
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
      fleet: { active: 5, counts: { ...NO_COUNTS, al_dia: 5 } },
      workshop: { equipment: 0, stale: 0, rows: [] }, stoppedDays: { total: 0, equipment: 0 },
    })} />)
    expect(screen.getByRole("link", { name: /^Mantenciones vencidas/ }).textContent).toContain("Todas las pautas al día")
    expect(screen.getByRole("link", { name: /^Equipos en taller/ }).textContent).toContain("Ninguno detenido")
    expect(screen.getByRole("link", { name: /^Días fuera de servicio/ }).textContent).toContain("Ningún equipo detenido")
  })

  it("cero vencidas no promete «todo al día» si casi nadie tiene lectura", () => {
    // 112 de 119 sin lecturas, 7 evaluados y ninguno vencido: la verdad es «ninguna entre los 7».
    render(<PanelKpis data={panelData({ fleet: { active: 119, counts: { ...NO_COUNTS, al_dia: 7, sin_lecturas: 112 } } })} />)
    const tile = screen.getByRole("link", { name: /^Mantenciones vencidas/ })
    expect(within(tile).getByText("0")).toBeTruthy()
    expect(tile.textContent).toContain("Ninguna entre los 7 con pauta y lectura")
    expect(tile.textContent).not.toContain("Todas las pautas al día")
  })

  it("si ningún equipo tiene pauta y lectura, el tile no afirma nada sobre las pautas", () => {
    render(<PanelKpis data={panelData({ fleet: { active: 4, counts: { ...NO_COUNTS, sin_lecturas: 3, sin_pauta: 1 } } })} />)
    const tile = screen.getByRole("link", { name: /^Mantenciones vencidas/ })
    expect(tile.textContent).toContain("Aún ningún equipo tiene pauta y lectura para evaluarse")
    expect(tile.textContent).not.toContain("al día")
  })

  it("sin registros en el período el tile ofrece ampliar el período", () => {
    render(<PanelKpis data={panelData({ records: { total: 0, preventive: 0, corrective: 0, hours: 0, pendingReview: 0 } })} />)
    const tile = screen.getByRole("link", { name: /^Registros · / })
    expect(tile.textContent).toContain("Aún no hay registros en este período")
    expect(tile.getAttribute("href")).toBe("/mantencion/panel?periodo=todo")
  })

  it("las horas hombre van en la tira de texto, no en una quinta tarjeta", () => {
    render(<PanelStrip data={panelData()} />)
    expect(screen.getByText(/Horas hombre/).textContent).toContain("17,5 h")
  })

  it("la tira lleva a los registros por revisar del mismo período y faena, y calla si no hay ninguno", () => {
    const { unmount } = render(<PanelStrip data={panelData({ filters: { period: "30", worksiteId: "ws-1" } })} />)
    const link = screen.getByRole("link", { name: /5 registros por revisar/ })
    expect(link.getAttribute("href")).toBe("/mantencion/registros?revision=pendiente&estado=vigente&desde=2026-09-29&faena=ws-1")
    expect(link.textContent).toContain("últimos 30 días")
    unmount()

    render(<PanelStrip data={panelData({ records: { total: 12, preventive: 8, corrective: 4, hours: 17.5, pendingReview: 0 } })} />)
    expect(screen.queryByRole("link", { name: /por revisar/ })).toBeNull()
  })
})

describe("tarjetas del panel", () => {
  afterEach(cleanup)

  it("la flota dibuja una barra por estado calculable y cada una lleva a Equipos filtrado", () => {
    render(<FleetCard data={panelData()} />)
    const bar = screen.getByRole("link", { name: "Vencida: 3 equipos. Ver esos equipos" })
    expect(bar.getAttribute("href")).toBe("/mantencion/equipos?estado=vencida")
    expect(screen.getByRole("link", { name: "Al día: 4 equipos. Ver esos equipos" })).toBeTruthy()
    // «Sin pauta» y «Sin lecturas» no son un estado de mantención: no se dibujan como barra.
    expect(screen.queryByRole("link", { name: /^Sin pauta: / })).toBeNull()
    expect(screen.queryByRole("link", { name: /^Sin lecturas: / })).toBeNull()
  })

  it("los equipos sin lecturas son un aviso con enlace a Equipos filtrado, no una barra gris", () => {
    render(<FleetCard data={panelData({
      filters: { period: "30", worksiteId: "ws-1" },
      fleet: { active: 119, counts: { ...NO_COUNTS, al_dia: 7, sin_lecturas: 112 } },
    })} />)
    const notices = screen.getByRole("list", { name: "Equipos con el estado por conocer" })
    expect(notices.textContent).toContain("112 equipos aún no tienen lecturas; su estado se conocerá con el primer registro de mantención de cada uno.")
    const link = within(notices).getByRole("link", { name: "Ver los 112 equipos sin lecturas →" })
    expect(link.getAttribute("href")).toBe("/mantencion/equipos?estado=sin_lecturas&faena=ws-1")
    // La barra de «Al día» ya no se escala contra los 112.
    expect(screen.getByRole("link", { name: "Al día: 7 equipos. Ver esos equipos" })).toBeTruthy()
    expect(screen.getByText("7 de 119 equipos activos tienen pauta y lectura para calcular su estado")).toBeTruthy()
  })

  it("el aviso de la flota concuerda en singular y también cubre los equipos sin pauta", () => {
    render(<FleetCard data={panelData({ fleet: { active: 3, counts: { ...NO_COUNTS, al_dia: 1, sin_lecturas: 1, sin_pauta: 1 } } })} />)
    expect(screen.getByText("1 equipo aún no tiene lecturas; su estado se conocerá con su primer registro de mantención.")).toBeTruthy()
    expect(screen.getByText("1 equipo no tiene pauta asignada, así que no se puede calcular cuándo le toca.")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Ver el equipo sin pauta →" }).getAttribute("href")).toBe("/mantencion/equipos?estado=sin_pauta")
  })

  it("si ningún equipo es calculable las barras quedan en cero y el aviso explica por qué y cómo resolverlo", () => {
    render(<FleetCard data={panelData({ fleet: { active: 4, counts: { ...NO_COUNTS, sin_lecturas: 4 } } })} />)
    expect(screen.getByRole("link", { name: "Vencida: 0 equipos. Ver esos equipos" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Ver los 4 equipos sin lecturas →" })).toBeTruthy()
    expect(screen.getByText("4 equipos activos, según su pauta y su última lectura")).toBeTruthy()
  })

  it("una flota vacía lleva a Equipos en vez de mostrar barras en cero", () => {
    render(<FleetCard data={panelData({ fleet: { active: 0, counts: NO_COUNTS } })} />)
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
    expect(within(table).getByRole("link", { name: /^KA-135/ }).getAttribute("href")).toBe("/mantencion/equipos/veh-1")
    expect(within(table).getByText("pasada por 312 km")).toBeTruthy()
    expect(within(table).getByText("Vencida")).toBeTruthy()
  })

  it("un equipo en taller lo dice antes que su estado de pauta, en la tabla y en la lista del teléfono", () => {
    const base = panelData()
    const upcoming = [{ ...base.upcoming[0]!, code: "KA-110", plate: "DKPG-54", state: "al_dia" as const, remaining: 8_000, workshopDays: 15 }]
    const { container } = render(<UpcomingCard data={panelData({ upcoming })} />)
    const table = screen.getByRole("table")
    expect(within(table).getByText("En taller · 15 días").closest("td")!.textContent).toBe("En taller · 15 díasAl día")
    // En teléfono es una lista de filas: un solo enlace por equipo, con el estado dentro.
    const list = screen.getByRole("list", { name: "Próximas mantenciones" })
    const link = within(list).getByRole("link", { name: /^KA-110/ })
    expect(link.getAttribute("href")).toBe("/mantencion/equipos/veh-1")
    expect(link.textContent).toContain("En taller · 15 días")
    expect(link.textContent).toContain("faltan 8.000 km")
    // C5: la tabla de una tarjeta no repite el borde de la tarjeta.
    expect(container.querySelector('[role="region"][aria-label="Próximas mantenciones"]')!.className).toContain("border-0")
  })

  it("sin taller de por medio la fila sólo muestra su estado de pauta", () => {
    render(<UpcomingCard data={panelData()} />)
    expect(screen.queryByText(/^En taller/)).toBeNull()
  })

  it("en taller ahora enlaza al registro y marca el que no se actualiza", () => {
    render(<WorkshopCard data={panelData()} />)
    const row = screen.getByRole("link", { name: /KA-135/ })
    expect(row.getAttribute("href")).toBe("/mantencion/registros/rec-1")
    expect(row.textContent).toContain("5 días")
    expect(row.textContent).toContain("Sin actualizar")
    expect(row.textContent).toContain("Sigue en taller: Espera repuesto de Santiago")
  })

  it("«Sin actualizar» va en tono señal (no rojo) y el texto largo se recorta a dos líneas sin perderse", () => {
    const base = panelData()
    const long = "Soldadura de soporte de estanque y revisión completa del sistema de escape con cambio de abrazaderas"
    const data = panelData({ workshop: { equipment: 1, stale: 1, rows: [{ ...base.workshop.rows[0]!, summary: long }] } })
    render(<WorkshopCard data={data} />)
    const flag = screen.getByText("Sin actualizar")
    expect(flag.className).toContain("--color-signal-ink")
    expect(flag.className).not.toContain("danger")
    // Texto completo en el DOM (lector de pantalla) y recorte visual a dos líneas.
    const summary = screen.getByText((content) => content.includes(long))
    expect(summary.className).toContain("line-clamp-2")
    expect(summary.className).not.toContain("truncate")
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
