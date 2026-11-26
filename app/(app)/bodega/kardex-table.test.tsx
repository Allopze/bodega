// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("./kardex-export-button", () => ({ KardexExportButton: () => null }))

import { KardexTable } from "./kardex-table"
import type { InventoryMovementWithRelations } from "./types"

function movement(overrides: Partial<InventoryMovementWithRelations> & { id: string }): InventoryMovementWithRelations {
  return {
    worksiteId: "ws-1",
    productId: "p-1",
    type: "ingreso_oc",
    quantity: 5,
    stockBefore: 0,
    stockAfter: 5,
    performedAt: "2026-11-20T15:00:00.000Z",
    reason: null,
    notes: null,
    product: { name: "Filtro de aceite" },
    worksite: { name: "Biodiversa" },
    ...overrides,
  }
}

const USE = movement({
  id: "m-uso", type: "egreso_mantencion", quantity: -1, stockBefore: 5, stockAfter: 4,
  referenceType: "mant_record", referenceId: "rec-1",
  documentFolio: "C-BIO-0007", workOrderId: "ot-1", workOrderFolio: "OT-BIO-0001",
})
const REVERSAL = movement({
  id: "m-reverso", type: "ingreso_anulacion", quantity: 1, stockBefore: 4, stockAfter: 5,
  referenceType: "mant_record_void", referenceId: "rec-1",
  documentFolio: "C-BIO-0007", workOrderId: "ot-1", workOrderFolio: "OT-BIO-0001",
})
const DELIVERY = movement({
  id: "m-entrega", type: "egreso_entrega", quantity: -2, stockBefore: 5, stockAfter: 3,
  referenceType: "delivery", referenceId: "del-1", product: { name: "Guante" },
})

afterEach(cleanup)

/** jsdom no aplica media queries: la tabla de escritorio y las tarjetas móviles se montan a la vez. */
function renderTable(movements: InventoryMovementWithRelations[], props: { canOpenMaintenanceRecord?: boolean; canOpenWorkOrder?: boolean } = {}) {
  render(<KardexTable movements={movements} {...props} />)
  return within(screen.getByRole("table"))
}

describe("KardexTable — uso de repuestos en mantención", () => {
  it("rotula el consumo «Uso en mantención» y enlaza al registro con su folio", () => {
    const table = renderTable([USE], { canOpenMaintenanceRecord: true, canOpenWorkOrder: true })

    expect(table.getByText("Uso en mantención")).toBeTruthy()
    const record = table.getByRole("link", { name: /Registro de mantención/ })
    expect(record).toHaveAttribute("href", "/mantencion/registros/rec-1")
    expect(within(record).getByText("C-BIO-0007")).toBeTruthy()
  })

  it("muestra el folio de la OT con su propio enlace, aparte del enlace al registro", () => {
    const table = renderTable([USE], { canOpenMaintenanceRecord: true, canOpenWorkOrder: true })

    const workOrder = table.getByRole("link", { name: /OT-BIO-0001/ })
    expect(workOrder).toHaveAttribute("href", "/mantencion/ot/ot-1")
    // Un enlace dentro de otro no es HTML válido: la OT no cuelga del enlace del registro.
    expect(workOrder.closest('a[href^="/mantencion/registros"]')).toBeNull()
  })

  it("sin permiso para abrirlos, el folio se ve igual pero sin enlace", () => {
    const table = renderTable([USE])

    expect(table.getByText("C-BIO-0007")).toBeTruthy()
    expect(table.getByText(/OT-BIO-0001/)).toBeTruthy()
    expect(table.queryByRole("link")).toBeNull()
  })

  it("el permiso de una pantalla no abre la otra", () => {
    const table = renderTable([USE], { canOpenWorkOrder: true })

    expect(table.queryByRole("link", { name: /Registro de mantención/ })).toBeNull()
    expect(table.getByRole("link", { name: /OT-BIO-0001/ })).toBeTruthy()
  })

  it("el reverso por anulación del registro dice de qué es, no «Reverso por anulación» a secas", () => {
    const table = renderTable([REVERSAL], { canOpenMaintenanceRecord: true, canOpenWorkOrder: true })

    expect(table.getByText("Reverso de uso en mantención")).toBeTruthy()
    expect(table.queryByText("Reverso por anulación")).toBeNull()
    expect(table.getByRole("link", { name: /Anulación de registro/ })).toHaveAttribute("href", "/mantencion/registros/rec-1")
    expect(table.getByRole("link", { name: /OT-BIO-0001/ })).toBeTruthy()
  })

  it("una anulación de entrega sigue diciendo «Reverso por anulación»", () => {
    const table = renderTable([movement({ id: "m-rev-ent", type: "ingreso_anulacion", quantity: 2, referenceType: "delivery", referenceId: "del-1" })])

    expect(table.getByText("Reverso por anulación")).toBeTruthy()
  })

  it("lo que no es mantención no cambia: la entrega enlaza a su comprobante y no trae OT", () => {
    const table = renderTable([DELIVERY], { canOpenMaintenanceRecord: true, canOpenWorkOrder: true })

    expect(table.getByRole("link", { name: /Entrega/ })).toHaveAttribute("href", "/entregas/del-1/print")
    expect(table.queryByText(/^OT /)).toBeNull()
  })

  it("la tarjeta móvil también lleva el registro y la OT", () => {
    render(<KardexTable movements={[USE]} canOpenMaintenanceRecord canOpenWorkOrder />)
    const card = screen.getByRole("article")

    expect(within(card).getByText("Uso en mantención")).toBeTruthy()
    expect(within(card).getByRole("link", { name: /Registro de mantención/ })).toHaveAttribute("href", "/mantencion/registros/rec-1")
    expect(within(card).getByRole("link", { name: /OT-BIO-0001/ })).toHaveAttribute("href", "/mantencion/ot/ot-1")
  })
})
