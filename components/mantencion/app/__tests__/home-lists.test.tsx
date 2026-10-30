// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { CatalogObservation } from "@/lib/mantencion/contracts"
import type { RecentRow } from "@/lib/mantencion/client/home-model"
import { ObservationBanner, RecentSection } from "../home-lists"

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
})
