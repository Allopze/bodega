// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MiperControlSnapshot } from "@/lib/prevention/miper/snapshot"

const saveMiperControlAction = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({ saveMiperControlAction }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast }))

import { ControlForm } from "./control-form"

// Pedro Soto ya no está en la faena: no viene en `responsibleOptions`.
const control: MiperControlSnapshot = { id: "c1", hierarchy: "administrative", description: "Pausas activas", responsibleUserId: "u9", responsibleName: "Pedro Soto", dueDate: "2026-10-30", status: "proposed" }
const base = { matrixId: "m1", entryId: "e1", responsibleOptions: [{ id: "u1", name: "Ana Pérez" }], measureSuggestions: [] as string[] }

afterEach(() => { vi.clearAllMocks() })

describe("ControlForm", () => {
  it("dice a la vista que la descripción pide al menos 3 caracteres", () => {
    render(<ControlForm {...base} control={null} controlVersion={undefined} onDone={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole("textbox", { name: "Descripción de la medida" })).toHaveAccessibleDescription("Mínimo 3 caracteres.")
    expect(screen.getByRole("button", { name: "Agregar medida" })).toBeDisabled()
  })

  it("guardar envía la versión de la medida, avisa y cierra", async () => {
    saveMiperControlAction.mockResolvedValueOnce({ ok: true, message: "Medida guardada", data: { id: "c1", version: 4 } })
    const onDone = vi.fn()
    render(<ControlForm {...base} control={control} controlVersion={3} onDone={onDone} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Guardar medida" }))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(saveMiperControlAction).toHaveBeenCalledWith({
      matrixId: "m1", entryId: "e1", controlId: "c1", expectedVersion: 3,
      values: { hierarchy: "administrative", description: "Pausas activas", responsibleUserId: "u9", responsibleName: null, dueDate: "2026-10-30" },
    })
    expect(toast.success).toHaveBeenCalledWith("Medida guardada")
  })

  it("un rechazo del servidor queda a la vista (role=alert) y el formulario no se cierra", async () => {
    saveMiperControlAction.mockResolvedValueOnce({ ok: false, message: "La medida cambió mientras la editabas. Recarga el riesgo para ver el cambio de la otra persona." })
    const onDone = vi.fn()
    render(<ControlForm {...base} control={control} controlVersion={3} onDone={onDone} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Guardar medida" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("La medida cambió mientras la editabas.")
    expect(onDone).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("mientras guarda, los campos quedan deshabilitados", async () => {
    saveMiperControlAction.mockReturnValueOnce(new Promise<never>(() => {}))
    render(<ControlForm {...base} control={control} controlVersion={3} onDone={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Guardar medida" }))
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Descripción de la medida" })).toBeDisabled())
    expect(screen.getByRole("combobox", { name: "Tipo de control" })).toBeDisabled()
    expect(screen.getByRole("combobox", { name: "Responsable de la medida" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled()
  })

  it("el responsable actual que ya no está en la faena sigue siendo la opción elegida", () => {
    render(<ControlForm {...base} control={control} controlVersion={3} onDone={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole("combobox", { name: "Responsable de la medida" })).toHaveTextContent("Pedro Soto")
  })
})
