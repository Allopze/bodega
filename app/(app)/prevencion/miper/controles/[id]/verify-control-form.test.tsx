// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ verify: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock("../../actions", () => ({ verifyRiskControlAction: mocks.verify }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
import { VerifyControlForm } from "./verify-control-form"

afterEach(() => vi.clearAllMocks())

function open(conflicted: boolean, canOverride: boolean) {
  render(<VerifyControlForm controlId="c1" expectedVersion={7} conflicted={conflicted} canOverride={canOverride} />)
  fireEvent.click(screen.getByRole("button", { name: "Verificar control" }))
  return screen.getByRole("dialog", { name: "Verificar control" })
}

describe("Verificación de una medida", () => {
  it("explica la referencia y mantiene la segregación cuando no se autoriza una excepción", () => {
    const dialog = open(true, false)
    expect(within(dialog).getByText(/Aquí se registra la referencia, no se adjunta un archivo/)).toBeTruthy()
    expect(within(dialog).getByRole("textbox", { name: /Excepción a la segregación/ })).toBeDisabled()
    expect(within(dialog).getByRole("button", { name: "Registrar verificación" })).toBeDisabled()
    expect(mocks.verify).not.toHaveBeenCalled()
  })

  it("conserva la referencia libre y la versión al verificar, sin transformarla en archivo o enlace", async () => {
    mocks.verify.mockResolvedValue({ ok: true, message: "Verificación registrada" })
    const dialog = open(false, false)
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Referencia de evidencia/ }), { target: { value: "Acta 12, carpeta Prevención, 04-10-2026" } })
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Qué se verificó/ }), { target: { value: "Se comprobó la medida en terreno" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar verificación" }))
    await waitFor(() => expect(mocks.verify).toHaveBeenCalledWith(expect.objectContaining({ controlId: "c1", expectedVersion: 7, evidenceReference: "Acta 12, carpeta Prevención, 04-10-2026", effectivenessStatus: "effective" })))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
})
