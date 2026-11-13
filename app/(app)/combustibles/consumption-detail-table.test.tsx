// @vitest-environment jsdom
import React from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, replace: _replace, scroll: _scroll, children, ...rest }: { href: string; replace?: boolean; scroll?: boolean; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

import { ConsumptionDetailTable, consumptionPeriodLabel, consumptionPerformanceLabel, type ConsumptionRecordRow } from "./consumption-detail-table"

afterEach(() => cleanup())

const PAGINATION = { page: 1, pageSize: 50, totalItems: 2, totalPages: 1, offset: 0, from: 1, to: 2 } as never

function record(overrides: Partial<ConsumptionRecordRow> = {}): ConsumptionRecordRow {
  return {
    id: "r1", batchId: "b1", patente: "KLJZ69", numeroTarjetas: 1, numeroTransacciones: 12, cantidadUnidad: 1840.5,
    monto: 2_000_000, precioPromedioUnidad: 1086, rendimientoPromedio: 3.456, periodoDesde: "2026-10-01", periodoHasta: "2026-10-31",
    fuente: "Copec TCT Diesel", vehicle: { id: "v1", code: "KA-127", plate: "KLJZ69", type: "Camión", performanceUnit: "km_per_liter" },
    equipmentHref: "/combustibles/consumo/equipos/v1", batchHref: "/combustibles/fuentes/archivos/tarjeta/b1", ...overrides,
  }
}

describe("totales de tarjeta", () => {
  it("el proveedor se lee en lenguaje de usuario, sin «Copec TCT»", () => {
    render(<ConsumptionDetailTable rows={[record()]} pagination={PAGINATION} hrefForPage={() => "#"} canViewCosts unlinkedHref="/x" emptyState={<p>vacío</p>} />)
    expect(screen.getAllByText(/Tarjeta Copec de equipos · Diésel/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/TCT/)).toBeNull()
  })

  it("el rendimiento lleva su unidad y la coma decimal: km/L en camiones, L/h en maquinaria", () => {
    expect(consumptionPerformanceLabel(3.456, "km_per_liter")).toBe("3,46 km/L")
    expect(consumptionPerformanceLabel(12.5, "liters_per_hour")).toBe("12,5 L/h")
    expect(consumptionPerformanceLabel(0, "km_per_liter")).toBe("—")
  })

  it("el rango de fechas usa el formato de la plataforma", () => {
    expect(consumptionPeriodLabel("2026-10-01", "2026-10-31")).toBe("Octubre 2026")
    expect(consumptionPeriodLabel("2026-10-01", "2026-11-15")).toBe("01-10-2026 a 15-11-2026")
  })

  it("equipo y patente van en una sola columna: la patente de un equipo vinculado no se repite", () => {
    render(<ConsumptionDetailTable rows={[record()]} pagination={PAGINATION} hrefForPage={() => "#"} canViewCosts={false} unlinkedHref="/x" emptyState={null} />)
    const table = screen.getByRole("table")
    expect(table.querySelectorAll("th")[0]).toHaveTextContent("Equipo")
    expect(screen.queryByRole("columnheader", { name: "Patente" })).toBeNull()
    expect(screen.getAllByRole("link", { name: "Ver ficha de KA-127" })).toHaveLength(1)
  })

  it("una patente sin equipo muestra «Sin vincular» y enlaza a Por revisar", () => {
    render(<ConsumptionDetailTable rows={[record({ vehicle: null, equipmentHref: null })]} pagination={PAGINATION} hrefForPage={() => "#"} canViewCosts={false} unlinkedHref="/combustibles/revisar?tipo=patente" emptyState={null} />)
    expect(screen.getAllByText("Sin vincular").length).toBeGreaterThan(0)
  })

  it("sin filas muestra el estado vacío que le pasa la página", () => {
    render(<ConsumptionDetailTable rows={[]} pagination={PAGINATION} hrefForPage={() => "#"} canViewCosts unlinkedHref="/x" emptyState={<p>Aún no hay totales</p>} />)
    expect(screen.getByText("Aún no hay totales")).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
  })
})
