// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { MiperControlSnapshot } from "@/lib/prevention/miper/snapshot"
import { ControlCard } from "./control-card"

const control: MiperControlSnapshot = { id: "c1", hierarchy: "ppe", description: "Uso de casco y guantes", responsibleUserId: null, responsibleName: "Supervisor", dueDate: "2026-10-30", status: "proposed" }

describe("ControlCard", () => {
  it("muestra tipo, responsable, plazo y actividades del programa", () => {
    render(<ControlCard control={control} linkedActionNumbers={[3]} editable verifyHref={null} onEdit={() => {}} onDelete={() => {}} deleting={false} />)
    expect(screen.getByText("V. Elementos de protección personal")).toBeTruthy()
    expect(screen.getByText(/Responsable: Supervisor · Plazo: 30-10-2026/)).toBeTruthy()
    expect(screen.getByText("En el programa: Actividad #3")).toBeTruthy()
  })
  it("eliminar pide confirmación antes de llamar a onDelete", () => {
    const onDelete = vi.fn()
    render(<ControlCard control={control} linkedActionNumbers={[]} editable verifyHref={null} onEdit={() => {}} onDelete={onDelete} deleting={false} />)
    fireEvent.click(screen.getByRole("button", { name: /^Eliminar la medida/ }))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Eliminar medida" }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
