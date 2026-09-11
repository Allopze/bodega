// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("./actions", () => ({ createWorker: vi.fn(), updateWorker: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { WorkerForm } from "./worker-form"

afterEach(cleanup)

const positions = [
  { id: "worker-position-unclassified", code: "SIN-CLASIFICAR", name: "Sin clasificar", isActive: true, needsReview: true },
  { id: "pos-operador", code: "OPERADOR", name: "Operador", isActive: true, needsReview: true },
]

describe("WorkerForm", () => {
  it("usa el catálogo y advierte cuando el cargo requiere revisión", () => {
    render(
      <WorkerForm
        open
        onClose={vi.fn()}
        worksites={[{ id: "ws-1", name: "Faena Uno" }]}
        sizeFamilies={[]}
        positions={positions}
        editWorker={{
          id: "worker-1",
          rut: null,
          firstName: "Ana",
          lastName: "Pérez",
          positionId: "pos-operador",
          position: "Operador",
          positionNeedsReview: true,
          worksiteId: "ws-1",
          isActive: true,
          sizeTop: null,
          sizeBottom: null,
          sizeShoe: null,
          sizeGloves: null,
          sizeHelmet: null,
        }}
      />,
    )

    expect(screen.getByRole("combobox", { name: "Cargo" })).toHaveTextContent("Operador")
    expect(screen.getByText(/pendiente de revisión/i)).toBeTruthy()
    expect(document.querySelector('input[name="positionId"]')).toHaveValue("pos-operador")
    expect(document.querySelector('input[name="position"]')).toBeNull()
  })
})
