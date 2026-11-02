// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { CatalogObservation } from "@/lib/mantencion/contracts"
import type { WorkshopEntry } from "@/lib/mantencion/client/fleet-view"
import type { RecentRow } from "@/lib/mantencion/client/home-model"
import { ObservationBanner, RecentSection, WorkshopSection } from "../home-lists"

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

  it("un equipo en taller por una OT no ofrece «Actualizar estado»: eso se registra en la OT", () => {
    const entry: WorkshopEntry = {
      vehicleId: "v1", recordId: "r1", worksiteId: "w1", equipmentCode: "KA-140", equipmentPlate: "ABCD-12",
      folio: "MC-BIO-0003", entryDate: "2026-10-20", lastActivityDate: "2026-10-20", stale: true, daysStopped: 8,
    }
    render(<WorkshopSection entries={[entry, { ...entry, vehicleId: "v2", recordId: "ot-1", equipmentCode: "KA-141", folio: "OT-BIO-0001" }]} onUpdate={() => {}} />)
    expect(screen.getByRole("button", { name: "Actualizar estado de KA-140" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Actualizar estado de KA-141" })).toBeNull()
    expect(screen.getByText(/OT-BIO-0001/)).toBeTruthy()
    expect(screen.getAllByText(/Toca actualizar/)).toHaveLength(1)
  })
})
