// @vitest-environment jsdom
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { FuelLogRow } from "@/lib/combustibles/fuel-log-shared"

vi.mock("./actions", () => ({ toggleReviewMarkAction: vi.fn(), exportFuelLogAction: vi.fn(), exportFuelLogSelectionAction: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/combustibles/bitacora" }))

import { BitacoraTable } from "./bitacora-table"

afterEach(() => cleanup())

function row(overrides: Partial<FuelLogRow> = {}) {
  return {
    id: "tae-1", detailId: "tae-1", source: "tae_pwa", occurredAt: "2026-06-01T12:00:00.000Z",
    worksiteName: "Faena A", supplierId: null, supplierName: null, loadingPointName: null,
    equipmentCode: "CC-1", plate: "AB-1234", equipmentTypeId: null, equipmentTypeName: null,
    driverName: "Ana Conductora", supervisorName: "Luis Supervisor", productId: null, productName: "Diésel",
    liters: 40, meterReading: null, meterLabel: null, performanceValue: null, performanceUnit: null,
    sealRemoved: null, sealInstalled: null, evidenceCount: 4, notes: null, statusLabel: "submitted",
    createdByName: null, updatedByName: null, createdAt: null, updatedAt: null,
    anomalyCount: null, reviewMark: null, reviewMarkNotes: null, reviewMarkId: null,
    detailHref: "/combustibles/tae/tae-1", auditEntity: null,
    ...overrides,
  } as FuelLogRow & { detailHref: string; auditEntity: null }
}

describe("BitacoraTable y datos personales (D-10)", () => {
  it("sin view_personal rotula Reservado y oculta el enlace a las evidencias", () => {
    render(<BitacoraTable rows={[row({ driverName: null, supervisorName: null })]} canViewPersonal={false} />)
    expect(screen.getAllByText("Reservado")).toHaveLength(2)
    expect(screen.queryByTitle("Ver evidencias")).not.toBeInTheDocument()
  })

  it("con view_personal muestra los nombres y el enlace a las evidencias", () => {
    render(<BitacoraTable rows={[row()]} canViewPersonal />)
    expect(screen.getByText("Ana Conductora")).toBeInTheDocument()
    expect(screen.getByText("Luis Supervisor")).toBeInTheDocument()
    expect(screen.queryByText("Reservado")).not.toBeInTheDocument()
    expect(screen.getByTitle("Ver evidencias")).toBeInTheDocument()
  })
})
