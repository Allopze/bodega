// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { CatalogObservation } from "@/lib/mantencion/contracts"
import type { WorkshopEntry } from "@/lib/mantencion/client/fleet-view"
import type { RecentRow } from "@/lib/mantencion/client/home-model"
import { UUID, recordItem } from "@/lib/mantencion/client/__tests__/fixtures"
import { ObservationBanner, RecentSection, RejectedSection, WorkshopSection } from "../home-lists"

const observation = (id: string, recordId: string): CatalogObservation => ({
  id, recordId, folio: "MP-BIO-0001", equipmentCode: "KA-140", text: "Falta la foto del sticker", by: "Alexis", createdAt: "2026-10-27T12:00:00.000Z", response: null,
})

describe("avisos del inicio", () => {
  it("una observación se dice en singular y varias en plural, con el pronombre que corresponde", () => {
    const { rerender } = render(<ObservationBanner observations={[observation("o1", "r1")]} onOpen={() => {}} />)
    expect(screen.getByText("Tu supervisor dejó una observación. Respóndela para cerrarla.")).toBeTruthy()
    expect(screen.getByText("1 registro observado")).toBeTruthy()

    rerender(<ObservationBanner observations={[observation("o1", "r1"), observation("o2", "r1"), observation("o3", "r2")]} onOpen={() => {}} />)
    expect(screen.getByText("Tu supervisor dejó 3 observaciones. Respóndelas para cerrarlas.")).toBeTruthy()
    expect(screen.getByText("2 registros observados")).toBeTruthy()
  })

  it("el folio no se parte en dos líneas", () => {
    const row: RecentRow = {
      id: "r1", kind: "P", equipmentCode: "KA-107", equipmentPlate: "SGCP-84", title: "Preventiva 40.000 km", when: "2026-10-20T15:00:00.000Z",
      folio: "MP-SAN-9101", state: "sent", voided: false, rejection: null,
    }
    render(<RecentSection rows={[row, { ...row, id: "r2", folio: null, state: "pending" }]} now={Date.parse("2026-10-28T18:00:00.000Z")} />)
    expect(screen.getByText("MP-SAN-9101").className).toContain("nw")
    expect(screen.getByText("Folio pendiente").className).toContain("nw")
  })

  it("un equipo en taller por una OT ofrece «Abrir la OT» en vez de «Actualizar estado»", () => {
    const entry: WorkshopEntry = {
      vehicleId: "v1", recordId: "r1", workOrderId: null, worksiteId: "w1", equipmentCode: "KA-140", equipmentPlate: "ABCD-12",
      folio: "MC-BIO-0003", entryDate: "2026-10-20", lastActivityDate: "2026-10-20", stale: true, daysStopped: 8,
    }
    // La segunda es de una caché vieja (sin `workOrderId`): el folio «OT-» la reconoce igual.
    const openOt = vi.fn()
    render(
      <WorkshopSection
        entries={[entry, { ...entry, vehicleId: "v2", recordId: "ot-1", equipmentCode: "KA-141", folio: "OT-BIO-0001" }]}
        onUpdate={() => {}}
        onOpenWorkOrder={openOt}
      />,
    )
    expect(screen.getByRole("button", { name: "Actualizar estado de KA-140" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Actualizar estado de KA-141" })).toBeNull()
    expect(screen.getByText(/OT-BIO-0001/)).toBeTruthy()
    expect(screen.getAllByText(/Toca actualizar/)).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "Abrir la OT de KA-141" }))
    expect(openOt).toHaveBeenCalledWith("ot-1")
  })

  it("con el id de la OT en el catálogo, «Abrir la OT» usa ese id", () => {
    const entry: WorkshopEntry = {
      vehicleId: "v1", recordId: "r1", workOrderId: "ot-77", worksiteId: "w1", equipmentCode: "KA-140", equipmentPlate: "ABCD-12",
      folio: "OT-BIO-0009", entryDate: "2026-10-20", lastActivityDate: "2026-10-20", stale: false, daysStopped: 8,
    }
    const openOt = vi.fn()
    render(<WorkshopSection entries={[entry]} onUpdate={() => {}} onOpenWorkOrder={openOt} />)
    fireEvent.click(screen.getByRole("button", { name: "Abrir la OT de KA-140" }))
    expect(openOt).toHaveBeenCalledWith("ot-77")
  })

  it("un rechazo ofrece corregir y descartar, en ese orden", () => {
    const item = { ...recordItem(UUID(1), "u-1", [UUID(11), UUID(12)]), status: "rejected" as const, rejection: { message: "El equipo está dado de baja.", field: "vehicleId" } }
    const onFix = vi.fn()
    const onDiscard = vi.fn()
    render(<RejectedSection items={[item]} onFix={onFix} onDiscard={onDiscard} />)
    expect(screen.getByText(/El equipo está dado de baja/)).toBeTruthy()
    const buttons = within(screen.getByRole("region", { name: "Por corregir" })).getAllByRole("button").map((button) => button.textContent)
    expect(buttons).toEqual(["Corregir y reenviar", "Descartar"])
    fireEvent.click(screen.getByRole("button", { name: "Descartar KA-140" }))
    expect(onDiscard).toHaveBeenCalledWith(item)
  })
})
