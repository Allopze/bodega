// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
const createMiperAction = vi.hoisted(() => vi.fn(async () => ({ ok: true, message: "MIPER creada", data: { id: "m-new" } })))
vi.mock("./actions", () => ({ createMiperAction }))

import { NewMiperDialog, type CreationWorksite } from "./new-miper-dialog"

const worksites: CreationWorksite[] = [
  { id: "ws-a", name: "Faena A", vigenteId: null, vigentePeriod: null, vigenteIsLegacy: false, vigenteHasUnsentChanges: false },
  { id: "ws-b", name: "Faena B", vigenteId: "m-b", vigentePeriod: 2025, vigenteIsLegacy: false, vigenteHasUnsentChanges: false },
]

afterEach(() => { vi.clearAllMocks() })

describe("NewMiperDialog (controlado)", () => {
  it("abre con la faena de la fila ya elegida y crea el borrador de ESA faena", async () => {
    const onOpenChange = vi.fn()
    render(<NewMiperDialog open onOpenChange={onOpenChange} worksites={worksites} currentYear={2026} initialWorksiteId="ws-b" />)
    expect(screen.getByRole("combobox")).toHaveTextContent("Faena B")
    // La faena B tiene vigente: se propone copiarla.
    expect(screen.getByRole("radio", { name: "Copiar la MIPER vigente (2025)" })).toBeChecked()
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: "Renovación anual del período." } })
    fireEvent.click(screen.getByRole("button", { name: "Crear borrador" }))
    await waitFor(() => expect(createMiperAction).toHaveBeenCalledWith({ worksiteId: "ws-b", period: 2026, revisionReason: "Renovación anual del período.", sourceMatrixId: "m-b" }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/prevencion/miper/m-new?tab=resumen&ficha=1"))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("sin faena inicial, o con una que no está en la lista, parte de la primera", () => {
    render(<NewMiperDialog open onOpenChange={vi.fn()} worksites={worksites} currentYear={2026} initialWorksiteId="ws-otra" />)
    expect(screen.getByRole("combobox")).toHaveTextContent("Faena A")
  })

  it("cerrado no monta el formulario: cada apertura parte de la faena que le pasan", () => {
    const { rerender } = render(<NewMiperDialog open={false} onOpenChange={vi.fn()} worksites={worksites} currentYear={2026} initialWorksiteId="ws-b" />)
    expect(screen.queryByRole("dialog")).toBeNull()
    rerender(<NewMiperDialog open onOpenChange={vi.fn()} worksites={worksites} currentYear={2026} initialWorksiteId="ws-a" />)
    expect(screen.getByRole("dialog", { name: "Nueva MIPER" })).toBeInTheDocument()
    expect(screen.getByRole("combobox")).toHaveTextContent("Faena A")
  })

  it("ya no trae su propio botón «Nueva MIPER»: lo pone quien lo abre", () => {
    render(<NewMiperDialog open={false} onOpenChange={vi.fn()} worksites={worksites} currentYear={2026} />)
    expect(screen.queryByRole("button", { name: "Nueva MIPER" })).toBeNull()
  })
})
