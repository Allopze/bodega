// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("./actions", () => ({
  createWorkerPositionAction: vi.fn(),
  updateWorkerPositionAction: vi.fn(),
}))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { PositionForm } from "./position-form"

afterEach(cleanup)

describe("PositionForm", () => {
  it("permite revisar identidad, capacidades y estado del cargo", () => {
    render(
      <PositionForm
        open
        onClose={vi.fn()}
        capabilities={[
          { id: "cap-drive", code: "drives_vehicle", name: "Conduce vehículos", description: "Vehículos livianos", isActive: true, positionCount: 2, overrideCount: 0 },
          { id: "cap-equipment", code: "operates_equipment", name: "Opera equipos", description: null, isActive: true, positionCount: 1, overrideCount: 1 },
        ]}
        editPosition={{
          id: "pos-operador",
          code: "OPERADOR",
          name: "Operador",
          isActive: true,
          needsReview: true,
          isSystem: false,
          workerCount: 4,
          aliases: [],
          capabilities: [{ id: "cap-equipment", code: "operates_equipment", name: "Opera equipos" }],
        }}
      />,
    )

    expect(screen.getByRole("dialog", { name: "Revisar cargo" })).toBeTruthy()
    expect(screen.getByRole("textbox", { name: /Código/ })).toHaveValue("OPERADOR")
    expect(screen.getByRole("textbox", { name: /Nombre del cargo/ })).toHaveValue("Operador")
    expect(screen.getByLabelText(/Conduce vehículos/)).not.toBeChecked()
    expect(screen.getByLabelText(/Opera equipos/)).toBeChecked()
    expect(screen.getByLabelText("Cargo pendiente de revisión")).toBeChecked()
  })
})
