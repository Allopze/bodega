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
