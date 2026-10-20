// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PdtpScheduledActivityPanel } from "./pdtp-scheduled-activity-panel"

vi.mock("@/app/(app)/prevencion/pdtp/actions/scheduled-instances", () => ({
  startPdtpScheduledInstanceAction: vi.fn(),
}))

afterEach(cleanup)

const row = (over: Record<string, unknown> = {}) => ({
  id: "inst-1",
  kind: "scheduled",
  programId: "prog-1",
  activityId: "act-1",
  activityNumber: 1,
  activityName: "Inspección de extintores",
  activityTitle: "Inspección de extintores",
  worksiteId: "ws-1",
  worksiteName: "Teno - Arauco",
  connectorKey: "inspections",
  connectorLabel: "Inspecciones",
  status: "pending",
  derivedStatus: "pending",
  statusLabel: "Pendiente",
  // Muy lejos en el tiempo: el filtro de período por defecto (30 días) la deja fuera.
  dueAt: "2099-12-31",
  scheduledFor: "2099-12-31",
  createdAt: "2026-09-01T12:00:00Z",
  responsibleUserId: null,
  responsibleName: null,
  assignedToMe: false,
  instrumentId: null,
  scheduledInstanceId: "inst-1",
  obligationId: null,
  href: "/prevencion/inspecciones",
  startHref: "/prevencion/inspecciones",
  ctaLabel: "Iniciar",
  ...over,
})

describe("Actividades programadas — el bloque no sepulta la lista de la página", () => {
  it("sin nada programado se colapsa a un renglón y no ofrece filtros", () => {
    render(<PdtpScheduledActivityPanel rows={[]} connectorLabel="Inspecciones" />)
    expect(screen.getByRole("heading", { name: "Actividades programadas" })).toBeTruthy()
    expect(screen.getByText("Sin trabajo del Programa Preventivo pendiente en inspecciones.")).toBeTruthy()
    // Ni filtros ni estado vacío ilustrado: no hay conjunto que filtrar.
    expect(screen.queryByLabelText("Faena")).toBeNull()
    expect(screen.queryByLabelText("Período")).toBeNull()
  })

  it("cuando los filtros esconden todo, lo dice sin jerga y ofrece la salida", () => {
    render(<PdtpScheduledActivityPanel rows={[row()] as never} connectorLabel="Inspecciones" />)

    // El período por defecto son 30 días y la actividad vence en 2099.
    expect(screen.getByText("Ninguna actividad coincide con estos filtros")).toBeTruthy()
    expect(screen.getByText(/Hay 1 actividad programada en este bloque/)).toBeTruthy()
    expect(screen.queryByText(/conector/)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Quitar filtros del bloque" }))
    expect(screen.getByText("Inspección de extintores")).toBeTruthy()
    expect(screen.queryByText("Ninguna actividad coincide con estos filtros")).toBeNull()
  })
})

describe("Actividades programadas — la búsqueda de la pantalla llega explícita", () => {
  it("filtra el bloque con la búsqueda que le pasa la pantalla", () => {
    // En `/prevencion/inspecciones` la TopBar no pinta su input (la ruta está
    // en ROUTES_WITH_OWN_SEARCH), así que leer el contexto del shell daba
    // siempre vacío y el buscador visible no filtraba este bloque.
    const { unmount } = render(
      <PdtpScheduledActivityPanel
        rows={[row({ dueAt: null, scheduledFor: null })] as never}
        connectorLabel="Inspecciones"
        searchQuery="extintores"
      />,
    )
    expect(screen.getByText("Inspección de extintores")).toBeTruthy()
    unmount()

    render(
      <PdtpScheduledActivityPanel
        rows={[row({ dueAt: null, scheduledFor: null })] as never}
        connectorLabel="Inspecciones"
        searchQuery="no-existe-nada-asi"
      />,
    )
    expect(screen.getByText("Ninguna actividad coincide con «no-existe-nada-asi»")).toBeTruthy()
    // La culpable es la búsqueda de la pantalla: el botón de los filtros del
    // bloque no podría cambiar nada, así que no se ofrece.
    expect(screen.queryByRole("button", { name: "Quitar filtros del bloque" })).toBeNull()
  })
})

describe("Actividades programadas — presentation=\"summary\" (un aviso, no el bloque)", () => {
  // Fecha sin tope: el período por defecto (30 días) no la oculta.
  const pendiente = (over: Record<string, unknown> = {}) => row({ dueAt: null, scheduledFor: null, ...over })
  const vencida = (over: Record<string, unknown> = {}) => pendiente({ status: "overdue", derivedStatus: "overdue", statusLabel: "Vencida", ...over })

  it("sin filas no pinta nada, ni siquiera el renglón de «sin trabajo»", () => {
    const { container } = render(<PdtpScheduledActivityPanel rows={[]} connectorLabel="Inspecciones" presentation="summary" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("con filas es un aviso informativo con el conteo y «Ver actividades» plegado", () => {
    render(
      <PdtpScheduledActivityPanel
        rows={[pendiente({ id: "a" }), pendiente({ id: "b" })] as never}
        connectorLabel="Inspecciones"
        presentation="summary"
      />,
    )
    expect(screen.getByText("2 actividades del Programa Preventivo pendientes en inspecciones")).toBeTruthy()
    // Sin vencidas no hay «· 0 vencidas»: sería ruido en un aviso que debería ser calmo.
    expect(screen.queryByText(/vencida/)).toBeNull()
    const boton = screen.getByRole("button", { name: "Ver actividades" })
    expect(boton).toHaveAttribute("aria-expanded", "false")
    // El cuerpo (filtros y filas) no existe hasta que se despliega.
    expect(screen.queryByRole("heading", { name: "Actividades programadas" })).toBeNull()
    expect(screen.queryByLabelText("Período")).toBeNull()
    // Tono informativo: nada vencido.
    expect(screen.getByText("2 actividades del Programa Preventivo pendientes en inspecciones").closest("div[class*='border']")!.className)
      .toContain("--color-info-tint")
  })

  it("en singular concuerda: una actividad pendiente", () => {
    render(<PdtpScheduledActivityPanel rows={[pendiente()] as never} connectorLabel="Inspecciones" presentation="summary" />)
    expect(screen.getByText("1 actividad del Programa Preventivo pendiente en inspecciones")).toBeTruthy()
  })

  it("con alguna vencida cuenta cuántas y pasa a tono de peligro", () => {
    render(
      <PdtpScheduledActivityPanel
        rows={[pendiente({ id: "a" }), vencida({ id: "b" }), vencida({ id: "c" })] as never}
        connectorLabel="Inspecciones"
        presentation="summary"
      />,
    )
    const texto = screen.getByText("3 actividades del Programa Preventivo pendientes en inspecciones · 2 vencidas")
    expect(texto.closest("div[class*='border']")!.className).toContain("--color-danger-tint")
  })

  it("una sola vencida dice «1 vencida»", () => {
    render(<PdtpScheduledActivityPanel rows={[vencida()] as never} connectorLabel="Inspecciones" presentation="summary" />)
    expect(screen.getByText("1 actividad del Programa Preventivo pendiente en inspecciones · 1 vencida")).toBeTruthy()
  })

  it("«Ver actividades» despliega el cuerpo de siempre, con su estado en aria-expanded", () => {
    render(<PdtpScheduledActivityPanel rows={[pendiente()] as never} connectorLabel="Inspecciones" presentation="summary" />)
    const boton = screen.getByRole("button", { name: "Ver actividades" })
    fireEvent.click(boton)

    expect(boton).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("heading", { name: "Actividades programadas" })).toBeTruthy()
    expect(screen.getByText("Inspección de extintores")).toBeTruthy()
    // El botón controla el bloque que se abrió.
    const cuerpo = screen.getByRole("heading", { name: "Actividades programadas" }).closest("section")!
    expect(boton.getAttribute("aria-controls")).toBe(cuerpo.id)

    fireEvent.click(boton)
    expect(boton).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("heading", { name: "Actividades programadas" })).toBeNull()
  })

  it("habla de lo que la búsqueda de la pantalla deja pasar, y se apaga si no deja nada", () => {
    const rows = [pendiente({ id: "a", activityName: "Inspección de extintores" }), vencida({ id: "b", activityName: "Orden y aseo" })] as never
    const { unmount } = render(<PdtpScheduledActivityPanel rows={rows} connectorLabel="Inspecciones" presentation="summary" searchQuery="extintores" />)
    // De dos, la búsqueda deja una y esa no está vencida.
    expect(screen.getByText("1 actividad del Programa Preventivo pendiente en inspecciones")).toBeTruthy()
    unmount()

    const { container } = render(<PdtpScheduledActivityPanel rows={rows} connectorLabel="Inspecciones" presentation="summary" searchQuery="no-existe-nada-asi" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe("Actividades programadas — worksiteId (la pantalla ya eligió la faena)", () => {
  const delNorte = row({ id: "n", worksiteId: "ws-n", worksiteName: "Faena Norte", activityName: "Orden y aseo norte", dueAt: null, scheduledFor: null })
  const delSur = row({ id: "s", worksiteId: "ws-s", worksiteName: "Faena Sur", activityName: "Orden y aseo sur", dueAt: null, scheduledFor: null })

  it("sin worksiteId conserva el selector «Faena» y todas las filas (las otras 13 pantallas)", () => {
    render(<PdtpScheduledActivityPanel rows={[delNorte, delSur] as never} connectorLabel="Inspecciones" />)
    expect(screen.getByLabelText("Faena")).toBeTruthy()
    expect(screen.getByText("Orden y aseo norte")).toBeTruthy()
    expect(screen.getByText("Orden y aseo sur")).toBeTruthy()
  })

  it("con worksiteId acota a esa faena y esconde su propio selector «Faena»", () => {
    render(<PdtpScheduledActivityPanel rows={[delNorte, delSur] as never} connectorLabel="Inspecciones" worksiteId="ws-n" />)
    // Dos controles para la misma dimensión (A5): el de la pantalla manda.
    expect(screen.queryByLabelText("Faena")).toBeNull()
    expect(screen.getByLabelText("Estado")).toBeTruthy()
    expect(screen.getByText("Orden y aseo norte")).toBeTruthy()
    expect(screen.queryByText("Orden y aseo sur")).toBeNull()
    expect(screen.getByText("1 pendiente")).toBeTruthy()
  })

  it("el resumen cuenta sólo las actividades de la faena elegida", () => {
    render(<PdtpScheduledActivityPanel rows={[delNorte, delSur] as never} connectorLabel="Inspecciones" worksiteId="ws-s" presentation="summary" />)
    expect(screen.getByText("1 actividad del Programa Preventivo pendiente en inspecciones")).toBeTruthy()
  })

  it("una faena sin actividades se comporta como un bloque vacío", () => {
    render(<PdtpScheduledActivityPanel rows={[delNorte] as never} connectorLabel="Inspecciones" worksiteId="ws-otra" />)
    expect(screen.getByText("Sin trabajo del Programa Preventivo pendiente en inspecciones.")).toBeTruthy()
    const { container } = render(<PdtpScheduledActivityPanel rows={[delNorte] as never} connectorLabel="Inspecciones" worksiteId="ws-otra" presentation="summary" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe("Actividades programadas — el panel por defecto no cambia", () => {
  it("presentation omitido es «panel»: bloque completo, sin botón de despliegue ni id extra", () => {
    render(<PdtpScheduledActivityPanel rows={[row({ dueAt: null, scheduledFor: null })] as never} connectorLabel="Inspecciones" />)
    expect(screen.queryByRole("button", { name: "Ver actividades" })).toBeNull()
    const seccion = screen.getByRole("heading", { name: "Actividades programadas" }).closest("section")!
    // El `id` del cuerpo existe sólo para que «Ver actividades» pueda referirlo.
    expect(seccion.hasAttribute("id")).toBe(false)
  })
})
