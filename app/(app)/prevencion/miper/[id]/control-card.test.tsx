// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { OperationResult } from "@/lib/hooks/use-operation"
import type { MiperControlSnapshot } from "@/lib/prevention/miper/snapshot"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast }))

import { ControlCard } from "./control-card"

const control: MiperControlSnapshot = { id: "c1", hierarchy: "ppe", description: "Uso de casco y guantes", responsibleUserId: null, responsibleName: "Supervisor", dueDate: "2026-10-30", status: "proposed" }
const deleted = () => vi.fn(async (): Promise<OperationResult> => ({ ok: true, message: "Medida eliminada" }))
const openConfirm = () => {
  fireEvent.click(screen.getByRole("button", { name: /^Eliminar la medida/ }))
  return screen.getByRole("dialog", { name: "Eliminar la medida" })
}

afterEach(() => { vi.clearAllMocks() })

describe("ControlCard", () => {
  it("muestra tipo, responsable, plazo y actividades del programa", () => {
    render(<ControlCard control={control} linkedActionNumbers={[3]} editable verifyHref={null} onEdit={() => {}} onDelete={deleted()} />)
    expect(screen.getByText("V. Elementos de protección personal")).toBeTruthy()
    expect(screen.getByText(/Responsable: Supervisor · Plazo: 30-10-2026/)).toBeTruthy()
    expect(screen.getByText("En el programa: Actividad #3")).toBeTruthy()
  })

  it("con otra medida en edición no se edita ni se elimina esta", () => {
    render(<ControlCard control={control} linkedActionNumbers={[]} editable verifyHref={null} onEdit={() => {}} onDelete={deleted()} editDisabled />)
    expect(screen.getByRole("button", { name: /^Editar la medida/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /^Eliminar la medida/ })).toBeDisabled()
  })

  it("eliminar pide confirmación; si sale bien, el diálogo se cierra y avisa", async () => {
    const onDelete = deleted()
    render(<ControlCard control={control} linkedActionNumbers={[]} editable verifyHref={null} onEdit={() => {}} onDelete={onDelete} />)
    const dialog = openConfirm()
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Eliminar medida" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Eliminar la medida" })).toBeNull())
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith("Medida eliminada")
  })

  it("el diálogo espera el borrado: mientras tanto no se cierra, ni con Escape", async () => {
    const onDelete = vi.fn(() => new Promise<OperationResult>(() => {}))
    render(<ControlCard control={control} linkedActionNumbers={[]} editable verifyHref={null} onEdit={() => {}} onDelete={onDelete} />)
    const dialog = openConfirm()
    fireEvent.click(within(dialog).getByRole("button", { name: "Eliminar medida" }))
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Eliminar medida" })).toBeDisabled())
    fireEvent.keyDown(dialog, { key: "Escape" })
    expect(screen.getByRole("dialog", { name: "Eliminar la medida" })).toBeTruthy()
  })

  it("si el borrado falla, el motivo se ve en el diálogo, que sigue abierto", async () => {
    const onDelete = vi.fn(async (): Promise<OperationResult> => ({ ok: false, message: "La medida cambió mientras la editabas. Recarga el riesgo para ver el cambio de la otra persona." }))
    render(<ControlCard control={control} linkedActionNumbers={[]} editable verifyHref={null} onEdit={() => {}} onDelete={onDelete} />)
    const dialog = openConfirm()
    fireEvent.click(within(dialog).getByRole("button", { name: "Eliminar medida" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("La medida cambió mientras la editabas.")
    expect(screen.getByRole("dialog", { name: "Eliminar la medida" })).toBeTruthy()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("con otra medida en edición, «Editar» queda deshabilitado", () => {
    render(<ControlCard control={control} linkedActionNumbers={[]} editable verifyHref={null} onEdit={() => {}} onDelete={deleted()} editDisabled />)
    expect(screen.getByRole("button", { name: /^Editar la medida/ })).toBeDisabled()
  })
})
