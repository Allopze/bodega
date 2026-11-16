// @vitest-environment jsdom
import type { ReactNode } from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { describeFuelPeriod } from "@/lib/combustibles/period/parse"
import type { FieldPanelData } from "@/lib/combustibles/panel/data"
import type { PanelDueRow } from "@/lib/combustibles/panel/due"
import { buildPanelSteps } from "@/lib/combustibles/panel/steps"

// El enlace de Next como `<a>` plano: aquí se prueba qué dibuja el Panel, no cómo navega Next.
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, ...rest }: Record<string, unknown>) => (
    <a href={String(href)} {...rest}>{children as ReactNode}</a>
  ),
}))

import { PanelDueList } from "./panel-due-list"
import { FieldPanel } from "./panel-field"
import { PanelProgress, PanelStepsStrip } from "./panel-steps"

const TODAY = "2026-10-31"
const october = describeFuelPeriod({ kind: "month", year: 2026, month: 10 }, "url", TODAY)

function row(partial: Partial<PanelDueRow> = {}): PanelDueRow {
  return {
    key: "carga:l1",
    href: "/combustibles/cargas/terreno/l1",
    dueLabel: "31 oct",
    overdue: false,
    equipment: "CA-14 · KPRT·14",
    title: "Lectura menor a la anterior",
    detail: "Espera hace 6 días · 182.310 km",
    waitingSince: "2026-10-25T14:00:00.000Z",
    ...partial,
  }
}

describe("tira de pasos", () => {
  const noData = buildPanelSteps({
    period: october,
    today: TODAY,
    visible: { fuentes: true, cuadratura: true, pagos: true },
    sources: null, inbox: null, reconciliation: null, worse: null, hasPerformanceData: null, payables: null,
  })

  it("dibuja cada paso como un enlace a su pantalla, numerado y con su estado dicho en palabras", () => {
    render(<PanelStepsStrip steps={noData.steps} />)
    const list = screen.getByRole("list")
    const links = within(list).getAllByRole("link")
    expect(links).toHaveLength(5)
    expect(links.map((anchor) => anchor.getAttribute("href"))).toEqual([
      "/combustibles/fuentes", "/combustibles/revisar", "/combustibles/cuadratura", "/combustibles/consumo", "/combustibles/pagos",
    ])
    // Un dato que no llegó se dice «Sin datos» (insignia y cifra), nunca «Listo».
    expect(within(links[0]!).getAllByText("Sin datos")).toHaveLength(2)
    expect(screen.queryByText("Listo")).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 2, name: "Pasos para cerrar el período" })).toBeInTheDocument()
    expect(links[1]).toHaveTextContent(/Paso 2/)
    expect(within(links[1]!).getByRole("heading", { level: 3, name: "Falta decidir" })).toBeInTheDocument()
  })

  it("marca el estado de cada paso para quien depure y para las pruebas de interfaz", () => {
    const steps = buildPanelSteps({
      period: october, today: TODAY,
      visible: { fuentes: false, cuadratura: false, pagos: false },
      sources: null,
      inbox: { total: 2, byKind: { carga: 2, caso: 0, patente: 0, pedido: 0 }, oldestWaitingSince: null, oldestByKind: { carga: null, caso: null, patente: null, pedido: null } },
      reconciliation: null,
      worse: { count: 0, examples: [] },
      hasPerformanceData: true,
      payables: null,
    })
    const { container } = render(<PanelStepsStrip steps={steps.steps} />)
    expect([...container.querySelectorAll("[data-step]")].map((el) => `${el.getAttribute("data-step")}:${el.getAttribute("data-status")}`)).toEqual([
      "revisar:pendiente", "equipos:ok",
    ])
    // Con 2 pasos no hay hueco que rellenar.
    expect(container.querySelectorAll("li[aria-hidden]")).toHaveLength(0)
  })

  it("con cinco pasos rellena el hueco de la segunda columna con una celda oculta a los lectores", () => {
    const { container } = render(<PanelStepsStrip steps={noData.steps} />)
    expect(container.querySelectorAll("li[aria-hidden='true']")).toHaveLength(1)
  })

  it("el avance dice el período, su estado y cuántos pasos están listos, una sola vez y sin barra", () => {
    render(<PanelProgress label="Octubre 2026" status="en_curso" ready={3} total={5} />)
    expect(screen.getByText("Octubre 2026")).toBeInTheDocument()
    expect(screen.getByText(/En curso/)).toBeInTheDocument()
    expect(screen.getByText("3 de 5")).toBeInTheDocument()
    expect(screen.queryByRole("progressbar")).toBeNull()
  })
})

describe("lo que vence primero", () => {
  const rows = [row(), row({ key: "caso:c1", href: "/combustibles/revisar?item=caso%3Ac1", equipment: "", title: "Caso · Sello repetido", overdue: true, dueLabel: "30 sep", waitingSince: "2026-09-20T12:00:00.000Z" })]

  beforeEach(() => window.localStorage.clear())

  it("antes de que la persona tenga historial no marca nada como nuevo", () => {
    render(<PanelDueList rows={rows} userId="u1" ariaLabel="Lo que vence primero" />)
    expect(screen.queryByText("Nuevo:", { exact: false })).not.toBeInTheDocument()
  })

  it("marca lo que llegó después de su primera visita y deja de marcarlo al abrirlo", () => {
    window.localStorage.setItem("chome:fuel-inbox-seen:u1", JSON.stringify({ since: "2026-10-01T00:00:00.000Z", keys: [] }))
    render(<PanelDueList rows={rows} userId="u1" ariaLabel="Lo que vence primero" />)
    const items = screen.getAllByRole("listitem")
    expect(within(items[0]!).getByText("Nuevo:", { exact: false })).toBeInTheDocument()
    // Lo que ya esperaba antes de su primera visita no es nuevo.
    expect(within(items[1]!).queryByText("Nuevo:", { exact: false })).not.toBeInTheDocument()

    const anchor = within(items[0]!).getByRole("link")
    // jsdom no navega: se cancela el comportamiento por defecto del enlace y sólo se prueba el manejador.
    anchor.addEventListener("click", (event) => event.preventDefault())
    fireEvent.click(anchor)
    expect(within(screen.getAllByRole("listitem")[0]!).queryByText("Nuevo:", { exact: false })).not.toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem("chome:fuel-inbox-seen:u1") ?? "{}").keys).toEqual(["carga:l1"])
  })

  it("cada fila enlaza a su ficha y lo vencido se dice vencido a los lectores de pantalla", () => {
    render(<PanelDueList rows={rows} userId="u1" ariaLabel="Lo que vence primero" />)
    const links = within(screen.getByRole("list", { name: "Lo que vence primero" })).getAllByRole("link")
    expect(links.map((anchor) => anchor.getAttribute("href"))).toEqual(["/combustibles/cargas/terreno/l1", "/combustibles/revisar?item=caso%3Ac1"])
    expect(within(links[1]!).getByText("(vencido)", { exact: false })).toHaveClass("sr-only")
    expect(within(links[0]!).getByText("CA-14 · KPRT·14")).toHaveClass("font-semibold")
  })

})

describe("panel de terreno y de contrato", () => {
  const base: FieldPanelData = {
    variant: "terreno",
    degraded: [],
    total: 5,
    counts: { all: 41, toValidate: 3, withObservation: 1 },
    recent: [
      { id: "sub-1", loadedAt: "2026-10-30T11:12:00.000Z", equipmentCode: "CA-14", plate: "KPRT14", worksiteName: "Biodiversa", liters: 185, status: "submitted" },
      { id: "sub-2", loadedAt: "2026-10-29T21:05:00.000Z", equipmentCode: "CA-22", plate: null, worksiteName: null, liters: 210, status: "observed" },
    ],
    toFix: [row()],
    ranking: [
      { vehicleId: "v1", label: "CA-14 · Biodiversa", liters: 1840 },
      { vehicleId: "v2", label: "CA-22 · Biodiversa", liters: 1712 },
      { vehicleId: "v3", label: "CM-08 · Mininco", liters: 980 },
    ],
    planilla: undefined,
  }
  const panel = (data: FieldPanelData, canRegister = true) =>
    render(<FieldPanel data={data} period={october} userId="u1" canRegister={canRegister} link={(href) => `${href}${href.includes("?") ? "&" : "?"}periodo=2026-10`} />)

  it("invita a registrar y enlaza los tres conteos a sus cargas, por estado", () => {
    panel(base)
    expect(screen.getByRole("link", { name: "Registrar carga" })).toHaveAttribute("href", "/combustibles/cargas/registrar")
    const counts = within(screen.getByRole("navigation", { name: "Tus cargas del período" })).getAllByRole("link")
    expect(counts.map((anchor) => anchor.getAttribute("href"))).toEqual([
      "/combustibles/cargas?mias=si&periodo=2026-10",
      "/combustibles/cargas?mias=si&estado=por-validar&periodo=2026-10",
      "/combustibles/cargas?mias=si&estado=con-observacion&periodo=2026-10",
    ])
    expect(counts.map((anchor) => anchor.textContent)).toEqual([
      expect.stringContaining("41cargas tuyas en octubre"),
      expect.stringContaining("3por validar"),
      expect.stringContaining("1con observación"),
    ])
  })

  it("lista mis últimas cargas con su estado en palabras y enlaza cada una a su ficha", () => {
    panel(base)
    const list = screen.getByRole("list", { name: "Tus últimas cargas" })
    const links = within(list).getAllByRole("link")
    expect(links.map((anchor) => anchor.getAttribute("href"))).toEqual(["/combustibles/cargas/terreno/sub-1", "/combustibles/cargas/terreno/sub-2"])
    expect(within(list).getByText("Por validar")).toBeInTheDocument()
    expect(within(list).getByText("Con observación")).toBeInTheDocument()
    expect(within(list).queryByText("submitted")).not.toBeInTheDocument()
  })

  it("el ranking de equipos usa litros y enlaza a la ficha de cada equipo", () => {
    panel(base)
    const ranking = screen.getByRole("list", { name: "Litros por equipo en octubre" })
    expect(within(ranking).getAllByRole("link").map((anchor) => anchor.getAttribute("href"))).toEqual([
      "/flota/v1/combustible", "/flota/v2/combustible", "/flota/v3/combustible",
    ])
    expect(within(ranking).getByText("1.840 L")).toBeInTheDocument()
  })

  it("sin permiso para registrar no hay botón, aunque el bloque siga explicando", () => {
    panel(base, false)
    expect(screen.queryByRole("link", { name: "Registrar carga" })).not.toBeInTheDocument()
  })

  it("el contrato ve su última planilla con enlace al archivo", () => {
    panel({ ...base, variant: "contrato", planilla: { id: "b1", fileName: "consolidado.xlsx", importedAt: "2026-10-28T20:02:00.000Z", validRows: 1228, invalidRows: 12 } })
    expect(screen.getByText(/Tu última planilla de cargas llegó el 28-10-2026: 1\.228 filas válidas y 12 con errores/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Ver el archivo" })).toHaveAttribute("href", "/combustibles/fuentes/archivos/planilla/b1")
  })

  it("un contrato sin planilla no muestra la línea", () => {
    panel({ ...base, variant: "contrato", planilla: null })
    expect(screen.queryByText(/Tu última planilla/)).not.toBeInTheDocument()
  })

  it("nada que registrar, nada que corregir y nada que rankear: tres vacíos con su explicación", () => {
    panel({ ...base, counts: { all: 0, toValidate: 0, withObservation: 0 }, recent: [], toFix: [], ranking: [] })
    expect(screen.getByText("Todavía no registraste cargas en octubre")).toBeInTheDocument()
    expect(screen.getByText("Nada te espera: ninguna de tus cargas tiene algo pendiente.")).toBeInTheDocument()
    expect(screen.getByText("Todavía no hay cargas en tus faenas en octubre")).toBeInTheDocument()
    // Los vacíos traen su acción, no sólo texto.
    expect(screen.getAllByRole("link", { name: "Registrar carga" }).length).toBeGreaterThanOrEqual(2)
  })

  it("si una consulta falló, cada bloque lo dice en vez de mostrar un vacío o un cero", () => {
    panel({ ...base, counts: null, recent: null, toFix: null, ranking: null })
    expect(screen.getAllByText("Sin datos")).toHaveLength(3)
    expect(screen.getByText(/No se pudieron leer tus cargas/)).toBeInTheDocument()
    expect(screen.getByText(/No se pudo leer lo pendiente/)).toBeInTheDocument()
    expect(screen.getByText(/No se pudo leer el consumo de tus equipos/)).toBeInTheDocument()
    expect(screen.queryByText(/Nada te espera/)).not.toBeInTheDocument()
  })
})
