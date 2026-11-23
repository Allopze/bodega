// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { WorkOrderListRow } from "@/lib/services/mantencion/work-orders/types"

/**
 * Las tarjetas de OT del móvil sólo muestran los datos que la OT ya tiene (crítica 2026-11-15,
 * paso 7): una «Por asignar» mostraba «Ingreso —», «Entrega estimada —» y «Días en taller —».
 */

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))

import { OtTable } from "./ot-table"

function row(overrides: Partial<WorkOrderListRow> = {}): WorkOrderListRow {
  return {
    id: "ot-1", folio: "OT-PAC-0008", status: "solicitada", vehicleId: "veh-1", equipmentCode: "KA-119", equipmentPlate: "JFDB-88",
    equipmentType: "Camión", worksiteId: "ws-1", worksiteName: "Pacifico", equipmentWorksiteId: "ws-1", equipmentWorksiteName: "Pacifico", repair: true, maintenance: false, requestDate: "2026-11-10",
    requesterName: "Ana", assignedToUserId: null, assignedToName: null, workshopEntryAt: null, estimatedDeliveryDate: null,
    workshopExitAt: null, estimateOverdue: false, daysInWorkshop: null, rejectionCount: 0, waitingParts: false,
    ...overrides,
  } as WorkOrderListRow
}

const cardTerms = () => within(screen.getByRole("list", { name: "Órdenes de trabajo como tarjetas" })).getAllByRole("term").map((term) => term.textContent)

afterEach(cleanup)

describe("tarjetas de OT en el móvil", () => {
  it("una OT por asignar no muestra campos vacíos", () => {
    render(<OtTable rows={[row()]} />)
    expect(cardTerms()).toEqual(["Tipo", "Mecánico"])
  })

  it("una OT en taller muestra ingreso, entrega estimada y días; y si fue devuelta, cuántas veces", () => {
    render(<OtTable rows={[row({ status: "en_ejecucion", assignedToName: "Luis", workshopEntryAt: "2026-11-11T12:00:00.000Z", estimatedDeliveryDate: "2026-11-20", daysInWorkshop: 3, rejectionCount: 2 })]} />)
    expect(cardTerms()).toEqual(["Tipo", "Mecánico", "Ingreso", "Entrega estimada", "Días en taller", "Devuelta"])
    expect(within(screen.getByRole("list", { name: "Órdenes de trabajo como tarjetas" })).getByText("2 veces")).toBeTruthy()
  })

  it("sin traslado no marca nada; con el equipo en otra faena, la tarjeta dice dónde está ahora", () => {
    const { rerender } = render(<OtTable rows={[row()]} />)
    expect(screen.queryByText(/Equipo ahora en/)).toBeNull()
    rerender(<OtTable rows={[row({ equipmentWorksiteId: "ws-2", equipmentWorksiteName: "Mininco" })]} />)
    // Una marca en la tarjeta del móvil y otra en la tabla de escritorio (las dos quedan en el DOM).
    expect(within(screen.getByRole("list", { name: "Órdenes de trabajo como tarjetas" })).getByText("Equipo ahora en Mininco")).toBeTruthy()
    expect(screen.getAllByText("Equipo ahora en Mininco")).toHaveLength(2)
  })
})
