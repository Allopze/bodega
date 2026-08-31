// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}))

import { DeliveriesTable, type DeliveryRow } from "./deliveries-table"

const row: DeliveryRow = {
  id: "del-1",
  code: "ENT-2026-0001",
  sourceWorksiteName: "Oficina CHOME",
  worksiteName: "Faena E2E",
  workerName: "Trabajador E2E",
  receiverName: null,
  itemSummary: "Casco EPP E2E",
  quantityCorrected: false,
  requestCode: "SOL-2026-EPP",
  deliveredAt: "2026-06-29T12:00:00.000Z",
  attachmentId: null,
}

describe("DeliveriesTable", () => {
  it("muestra enlace al comprobante imprimible de cada entrega", () => {
    render(<DeliveriesTable deliveries={[row]} />)

    const links = screen.getAllByRole("link", { name: /Comprobante/ })
    expect(links.length).toBeGreaterThanOrEqual(1)
    expect(links[0]).toHaveAttribute("href", "/entregas/del-1/print")
  })

  it("identifica una cantidad histórica regularizada", () => {
    render(<DeliveriesTable deliveries={[{ ...row, quantityCorrected: true }]} />)

    expect(screen.getAllByText(/Regularizada/i).length).toBeGreaterThanOrEqual(1)
  })
})
