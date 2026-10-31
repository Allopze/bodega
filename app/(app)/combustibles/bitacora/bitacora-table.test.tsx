// @vitest-environment jsdom
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"

vi.mock("./actions", () => ({ requestReviewAction: vi.fn(), withdrawReviewRequestAction: vi.fn(), exportFuelLogAction: vi.fn(), exportFuelLogSelectionAction: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/combustibles/cargas" }))

import { BitacoraTable, rowKey, type EnrichedRow } from "./bitacora-table"

afterEach(() => cleanup())

function row(overrides: Partial<EnrichedRow> = {}): EnrichedRow {
  return {
    id: "tae-1", detailId: "tae-1", source: "tae_pwa", occurredAt: "2026-06-01T12:00:00.000Z",
    worksiteName: "Faena A", supplierId: null, supplierName: null, loadingPointName: null,
    equipmentCode: "CC-1", plate: "AB-1234", equipmentTypeId: null, equipmentTypeName: "Camión",
    driverName: "Ana Conductora", supervisorName: "Luis Supervisor", productId: null, productName: "Diésel",
    liters: 40, meterReading: 182310, meterLabel: "Odómetro", performanceValue: null, performanceUnit: null,
    sealRemoved: null, sealInstalled: null, evidenceCount: 4, notes: null, statusLabel: "submitted",
    createdByName: null, updatedByName: null, createdAt: null, updatedAt: null,
    anomalyCount: null, reviewMark: null, reviewMarkNotes: null, reviewMarkId: null, reviewMarkedBy: null,
    origin: "qr", worksiteId: "w-1", vehicleId: "veh-1", equipmentLoadId: "el-1", reviewFlagged: null, reviewFlagReason: null,
    hrefs: {
      detail: "/combustibles/cargas/terreno/tae-1",
      equipment: "/combustibles/consumo/equipos/veh-1",
      history: null,
      evidence: "/combustibles/cargas/terreno/tae-1#evidencia",
      decide: null,
      requested: "/combustibles/revisar?tipo=pedido",
      cases: "/combustibles/revisar?tipo=caso",
    },
    ...overrides,
  } as EnrichedRow
}

const PERSONAL_COLUMNS = ["equipment", "driverName", "supervisorName"]

describe("BitacoraTable y datos personales (D-10)", () => {
  it("sin view_personal rotula Reservado y no ofrece el enlace a las fotos si la página no lo armó", () => {
    render(<BitacoraTable rows={[row({ driverName: null, supervisorName: null, hrefs: { ...row().hrefs, evidence: null } })]} canViewPersonal={false} initialColumnKeys={PERSONAL_COLUMNS} />)
    expect(screen.getAllByText("Reservado")).toHaveLength(2)
    expect(screen.queryByTitle("Ver fotos")).not.toBeInTheDocument()
  })

  it("con view_personal muestra los nombres y el enlace a las fotos", () => {
    render(<BitacoraTable rows={[row()]} canViewPersonal initialColumnKeys={PERSONAL_COLUMNS} />)
    expect(screen.getByText("Ana Conductora")).toBeInTheDocument()
    expect(screen.getByText("Luis Supervisor")).toBeInTheDocument()
    expect(screen.queryByText("Reservado")).not.toBeInTheDocument()
    expect(screen.getByTitle("Ver fotos")).toHaveAttribute("href", "/combustibles/cargas/terreno/tae-1#evidencia")
  })
})

describe("BitacoraTable: columna «Pendiente» y «Cómo llegó»", () => {
  it("muestra el motivo en palabras y enlaza la carga por decidir a la bandeja", () => {
    const flagged = row({ reviewFlagged: true, reviewFlagReason: "meter_regression", hrefs: { ...row().hrefs, decide: "/combustibles/revisar?tipo=carga&item=carga%3Ael-1" } })
    render(<BitacoraTable rows={[flagged]} canViewPersonal />)
    const links = screen.getAllByRole("link", { name: "Lectura de medidor menor a la anterior" })
    expect(links.length).toBeGreaterThan(0)
    expect(links[0]).toHaveAttribute("href", "/combustibles/revisar?tipo=carga&item=carga%3Ael-1")
  })

  it("la insignia de un caso abierto enlaza al enlace que armó la página para ESA carga", () => {
    const withCase = row({ anomalyCount: 1, hrefs: { ...row().hrefs, cases: "/combustibles/revisar?tipo=caso&ref=tae_pwa%3Atae-1" } })
    render(<BitacoraTable rows={[withCase]} canViewPersonal />)
    const links = screen.getAllByRole("link", { name: "Caso abierto" })
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(link).toHaveAttribute("href", "/combustibles/revisar?tipo=caso&ref=tae_pwa%3Atae-1")
  })

  it("una carga con observación y un pedido abierto muestra los dos pendientes", () => {
    const pending = row({ statusLabel: "observed", reviewMark: true, reviewMarkId: "m-1", reviewMarkNotes: "Revisar los litros" })
    render(<BitacoraTable rows={[pending]} canViewPersonal />)
    expect(screen.getAllByText("Revisión pedida").length).toBeGreaterThan(0)
    // «Con observación» sale también como estado: la columna Pendiente aporta la suya.
    expect(screen.getAllByText("Con observación").length).toBeGreaterThanOrEqual(2)
  })

  it("una carga sin nada pendiente no inventa un pendiente", () => {
    render(<BitacoraTable rows={[row()]} canViewPersonal />)
    expect(screen.queryByText("Por decidir")).not.toBeInTheDocument()
    expect(screen.queryByText("Revisión pedida")).not.toBeInTheDocument()
  })

  it("rotula cómo llegó cada carga y no muestra el estado crudo de la planilla", () => {
    const planilla = row({ id: "op-1", detailId: "op-1", source: "operation_manual", origin: "planilla", statusLabel: "importado", hrefs: { ...row().hrefs, detail: "/combustibles/cargas/planilla/op-1" } })
    render(<BitacoraTable rows={[row(), planilla]} canViewPersonal />)
    expect(screen.getAllByText("Formulario en terreno (QR)").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Planilla de cargas").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Importada").length).toBeGreaterThan(0)
    expect(screen.queryByText("importado")).not.toBeInTheDocument()
  })
})

describe("BitacoraTable: selección de filas", () => {
  it("avisa de la selección con la llave fuente:id y puede seleccionar todas", () => {
    const onChange = vi.fn()
    const rows = [row(), row({ id: "inv-1", detailId: "inv-1", source: "invoiced", origin: "factura", statusLabel: "registered", equipmentCode: "CC-2" })]
    render(<BitacoraTable rows={rows} canViewPersonal selectedKeys={new Set()} onSelectedKeysChange={onChange} />)

    fireEvent.click(screen.getByLabelText("Seleccionar la carga de CC-1"))
    expect(onChange).toHaveBeenLastCalledWith(new Set([rowKey(rows[0]!)]))

    fireEvent.click(screen.getByLabelText("Seleccionar todas las filas"))
    expect(onChange).toHaveBeenLastCalledWith(new Set(rows.map(rowKey)))
  })

  it("sin onSelectedKeysChange no hay casillas de selección", () => {
    render(<BitacoraTable rows={[row()]} canViewPersonal />)
    const table = screen.getByRole("table")
    expect(within(table).queryAllByRole("checkbox")).toHaveLength(0)
  })
})
