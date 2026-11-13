// @vitest-environment jsdom
import type { ReactNode } from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { describeFuelPeriod } from "@/lib/combustibles/period/parse"
import type { ConsultaPanelData, FieldPanelData, PanelDueState } from "@/lib/combustibles/panel/data"
import type { PanelDueRow } from "@/lib/combustibles/panel/due"
import { buildPanelFigures, type PanelFigureBucket } from "@/lib/combustibles/panel/figures"
import { buildPanelSteps } from "@/lib/combustibles/panel/steps"

// El enlace de Next como `<a>` plano: aquí se prueba qué dibuja el Panel, no cómo navega Next.
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, ...rest }: Record<string, unknown>) => (
    <a href={String(href)} {...rest}>{children as ReactNode}</a>
  ),
}))

import { ConsultaPanel } from "./panel-consulta"
import { PanelDueCard } from "./panel-due-card"
import { PanelDueList } from "./panel-due-list"
import { FieldPanel } from "./panel-field"
import { PanelFiguresCard } from "./panel-figures-card"
import { PanelProgress, PanelStepsStrip } from "./panel-steps"

const TODAY = "2026-10-31"
const october = describeFuelPeriod({ kind: "month", year: 2026, month: 10 }, "url", TODAY)
const september = describeFuelPeriod({ kind: "month", year: 2026, month: 9 }, "url", TODAY)
const link = (href: string) => href

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
      inbox: { total: 2, byKind: { carga: 2, caso: 0, patente: 0, pedido: 0 }, oldestWaitingSince: null },
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

  describe("tarjeta", () => {
    const card = (due: PanelDueState, period = october) => render(<PanelDueCard due={due} period={period} userId="u1" link={link} />)

    it("con filas, el enlace a la bandeja lleva el total", () => {
      card({ kind: "rows", rows, total: 9 })
      expect(screen.getByRole("heading", { level: 2, name: "Lo que vence primero" })).toBeInTheDocument()
      expect(screen.getByRole("link", { name: "Ver todo lo pendiente (9)" })).toHaveAttribute("href", "/combustibles/revisar")
    })

    it("en un período cerrado cambia el título y el texto", () => {
      card({ kind: "rows", rows, total: 2 }, september)
      expect(screen.getByRole("heading", { level: 2, name: "Lo que quedó pendiente de septiembre" })).toBeInTheDocument()
      expect(screen.getByText(/El período está cerrado/)).toBeInTheDocument()
    })

    it("vacío confirmado: lo dice; sin confirmar: no afirma que no hay nada y manda a la bandeja", () => {
      const { unmount } = card({ kind: "empty" })
      expect(screen.getByText("No hay nada pendiente: todo lo que llegó ya tiene una decisión.")).toBeInTheDocument()
      unmount()
      card({ kind: "unknown" })
      expect(screen.queryByText(/No hay nada pendiente/)).not.toBeInTheDocument()
      expect(screen.getByText(/No se pudo confirmar lo que está pendiente/)).toBeInTheDocument()
      expect(screen.getByRole("link", { name: "Abre la bandeja" })).toHaveAttribute("href", "/combustibles/revisar")
    })
  })
})

describe("el período en tres cifras", () => {
  function bucket(partial: Partial<PanelFigureBucket> = {}): PanelFigureBucket {
    return { from: "2026-01-01", to: "2026-01-31", liters: 0, loads: 0, equipment: 0, truckKm: 0, truckLiters: 0, truckExcluded: 0, machineHours: 0, machineLiters: 0, machineExcluded: 0, ...partial }
  }
  const figures = buildPanelFigures({
    partialPrevLiters: null,
    buckets: [
      bucket({ liters: 43_000, loads: 100, equipment: 100 }), bucket({ liters: 44_000, loads: 100, equipment: 100 }), bucket({ liters: 47_000, loads: 100, equipment: 100 }),
      bucket({ liters: 49_900, loads: 100, equipment: 121, truckKm: 5_600, truckLiters: 2_000, machineHours: 100, machineLiters: 1_350 }),
      bucket({ liters: 46_900, loads: 100, equipment: 118, truckKm: 5_600, truckLiters: 2_000, truckExcluded: 4, machineHours: 100, machineLiters: 1_400 }),
    ],
  }, september, TODAY)

  it("muestra las tres cifras con su unidad, su variación y su historia con rótulos", () => {
    render(<PanelFiguresCard figures={figures} period={september} link={link} />)
    expect(screen.getByRole("heading", { level: 2, name: "El período en tres cifras" })).toBeInTheDocument()
    expect(screen.getByText("Litros cargados a 118 equipos")).toBeInTheDocument()
    expect(screen.getByText("46.900")).toHaveClass("tabular-nums")
    expect(screen.getByText("km/L")).toHaveAttribute("title", expect.stringContaining("Kilómetros recorridos por litro"))
    expect(screen.getByText("L/h")).toHaveAttribute("title", expect.stringContaining("Litros consumidos por hora"))
    expect(screen.getByText("4 cargas por decidir no entran al promedio")).toBeInTheDocument()
    // Cinco barras por cifra, cada una con su rótulo, y el texto alternativo trae los valores.
    const histories = screen.getAllByRole("img")
    expect(histories).toHaveLength(3)
    expect(histories[0]).toHaveAccessibleName(expect.stringContaining("Septiembre 2026: 46.900"))
    expect(within(histories[0]!).getAllByText(/^(may|jun|jul|ago|sep)$/)).toHaveLength(5)
    expect(screen.getByText(/Las barras muestran los últimos 5 meses/)).toBeInTheDocument()
  })

  it("la variación de «menos es mejor» va con la polaridad contraria", () => {
    const { container } = render(<PanelFiguresCard figures={figures} period={september} link={link} />)
    const deltas = [...container.querySelectorAll("[data-delta]")].map((el) => el.getAttribute("data-delta"))
    // Litros: neutral. km/L sin cambio: neutral. L/h sube de 13,5 a 14: es peor.
    expect(deltas).toEqual(["neutral", "neutral", "negative"])
  })

  it("si la consulta falló no inventa cifras", () => {
    render(<PanelFiguresCard figures={null} period={september} link={link} />)
    expect(screen.getByText(/No se pudieron calcular las cifras del período/)).toBeInTheDocument()
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
  })

  it("una cifra sin dato dice qué falta en vez de un cero", () => {
    const empty = buildPanelFigures({ partialPrevLiters: null, buckets: Array.from({ length: 5 }, () => bucket()) }, september, TODAY)
    render(<PanelFiguresCard figures={empty} period={september} link={link} />)
    expect(screen.getAllByText("Sin datos")).toHaveLength(3)
    expect(screen.getByText("Todavía no hay cargas en este período.")).toBeInTheDocument()
    expect(screen.queryByText("0")).not.toBeInTheDocument()
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
      "/combustibles/consumo/equipos/v1", "/combustibles/consumo/equipos/v2", "/combustibles/consumo/equipos/v3",
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

describe("panel de consulta", () => {
  const figures = buildPanelFigures({
    partialPrevLiters: null,
    buckets: [
      ...Array.from({ length: 3 }, () => ({ from: "2026-01-01", to: "2026-01-31", liters: 0, loads: 0, equipment: 0, truckKm: 0, truckLiters: 0, truckExcluded: 0, machineHours: 0, machineLiters: 0, machineExcluded: 0 })),
      { from: "2026-08-01", to: "2026-08-31", liters: 19_700, loads: 90, equipment: 40, truckKm: 0, truckLiters: 0, truckExcluded: 0, machineHours: 0, machineLiters: 0, machineExcluded: 0 },
      { from: "2026-09-01", to: "2026-09-30", liters: 18_900, loads: 90, equipment: 41, truckKm: 0, truckLiters: 0, truckExcluded: 0, machineHours: 0, machineLiters: 0, machineExcluded: 0 },
    ],
  }, september, TODAY)
  const data: ConsultaPanelData = {
    variant: "consulta",
    degraded: [],
    total: 4,
    figures,
    worse: { count: 2, examples: [{ vehicleId: "1", code: "CA-14", familyLabel: "Camiones", deltaPct: -22 }, { vehicleId: "2", code: "CA-22", familyLabel: "Camiones", deltaPct: -15 }] },
    measured: true,
    unlinkedPlates: 2,
  }
  const panel = (value: ConsultaPanelData, canLinkPlates = true) =>
    render(<ConsultaPanel data={value} period={september} canLinkPlates={canLinkPlates} withPeriod={(href) => `${href}${href.includes("?") ? "&" : "?"}periodo=2026-09`} />)

  it("dice los litros y los equipos con su variación, y enlaza a las cargas", () => {
    panel(data)
    expect(screen.getByText(/En septiembre tus faenas cargaron/)).toHaveTextContent("18.900 L en 41 equipos, 4 % menos que en agosto.")
    expect(screen.getByRole("link", { name: /Ver las cargas/ })).toHaveAttribute("href", "/combustibles/cargas?periodo=2026-09")
  })

  it("nombra los equipos que rinden peor y enlaza al rendimiento", () => {
    panel(data)
    expect(screen.getByText(/rinden más de 10 % peor/).closest("p")).toHaveTextContent("CA-14 y CA-22 rinden más de 10 % peor que otros equipos de su mismo modelo.")
    expect(screen.getByRole("link", { name: /Ver el rendimiento/ })).toHaveAttribute("href", "/combustibles/consumo?periodo=2026-09")
  })

  it("las patentes sin vincular traen su acción real, según el permiso", () => {
    const { unmount } = panel(data)
    expect(screen.getByText(/2 patentes/).closest("p")).toHaveTextContent("2 patentes de tarjeta no están en la flota y sus litros no cuentan en ningún equipo. Puedes vincularlas.")
    expect(screen.getByRole("link", { name: "Vincular patentes" })).toHaveAttribute("href", "/combustibles/revisar?tipo=patente&periodo=2026-09")
    unmount()
    panel(data, false)
    expect(screen.queryByRole("link", { name: "Vincular patentes" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Ver las patentes/ })).toBeInTheDocument()
    expect(screen.queryByText(/Puedes vincularlas/)).not.toBeInTheDocument()
  })

  it("con todo en orden lo dice, y sin datos no afirma que todo está bien", () => {
    const { unmount } = panel({ ...data, worse: { count: 0, examples: [] }, unlinkedPlates: 0 })
    expect(screen.getByText("Ningún equipo rinde más de 10 % peor que otros de su mismo modelo.")).toBeInTheDocument()
    expect(screen.getByText("Todas las patentes de tarjeta están vinculadas a un equipo.")).toBeInTheDocument()
    unmount()
    panel({ ...data, figures: null, worse: null, unlinkedPlates: null })
    expect(screen.getByText(/No se pudieron calcular los litros de septiembre/)).toBeInTheDocument()
    expect(screen.getByText(/No se pudo calcular el rendimiento de los equipos/)).toBeInTheDocument()
    expect(screen.getByText(/No se pudo contar las patentes/)).toBeInTheDocument()
    expect(screen.queryByText(/Ningún equipo rinde/)).not.toBeInTheDocument()
  })

  it("sin cargas con rendimiento medido, «ningún equipo rinde peor» no se afirma", () => {
    panel({ ...data, worse: { count: 0, examples: [] }, measured: false })
    expect(screen.queryByText(/Ningún equipo rinde/)).not.toBeInTheDocument()
    expect(screen.getByText("Todavía no hay cargas con rendimiento calculado en septiembre.")).toBeInTheDocument()
  })
})
