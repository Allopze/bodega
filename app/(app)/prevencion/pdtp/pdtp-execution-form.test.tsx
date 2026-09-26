// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const mockMarkPdtpExecutionFormAction = vi.hoisted(() => vi.fn(async () => ({ ok: true })))
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock("./actions", () => ({
  markPdtpExecutionFormAction: mockMarkPdtpExecutionFormAction,
}))
vi.mock("@/lib/toast", () => ({ toast: mockToast }))

import { PdtpExecutionForm } from "./pdtp-execution-form"

afterEach(cleanup)

beforeEach(() => {
  mockMarkPdtpExecutionFormAction.mockClear()
  mockToast.success.mockClear()
  mockToast.error.mockClear()
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ path: "storage/pdtp-evidence/acta.pdf" }),
    { status: 201, headers: { "Content-Type": "application/json" } },
  )))
})

describe("PdtpExecutionForm", () => {
  it("vincula la subida de evidencia con la actividad que se está acreditando", async () => {
    render(<PdtpExecutionForm activityId="activity-constancia" worksiteId="ws-1" year={2026} />)

    fireEvent.click(screen.getByRole("button", { name: "Registrar" }))
    const file = new File(["%PDF-1.4"], "acta.pdf", { type: "application/pdf" })
    fireEvent.change(screen.getByLabelText("Evidencia (foto o PDF)"), { target: { files: [file] } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar ejecución" }))

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1))
    const request = vi.mocked(fetch).mock.calls[0]![1] as RequestInit
    const upload = request.body as FormData
    expect(upload.get("activityId")).toBe("activity-constancia")
    expect(upload.get("worksiteId")).toBe("ws-1")
  })

  it("por defecto avisa que el archivo es obligatorio para declararla realizada (PREV-B02)", () => {
    render(<PdtpExecutionForm activityId="a" worksiteId="ws-1" year={2026} />)
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }))
    expect(screen.getByText(/sin un archivo la actividad no se puede declarar realizada/i)).toBeTruthy()
  })

  it("con la excepción declarada explica que basta una observación escrita", () => {
    render(<PdtpExecutionForm activityId="a" worksiteId="ws-1" year={2026} manualEvidencePolicy="declaration_allowed" />)
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }))
    expect(screen.getByText(/basta una observación escrita/i)).toBeTruthy()
  })

  it("en una actividad de enganche avisa que la acreditación del módulo y la carga manual cuentan una sola vez (PREV-C02)", () => {
    render(<PdtpExecutionForm activityId="a" worksiteId="ws-1" year={2026} mechanism="enganche" />)
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }))
    expect(screen.getByText(/cuenta una sola vez/i)).toBeTruthy()
    expect((screen.getByLabelText("Cantidad") as HTMLInputElement).max).toBe("100000")
  })

  it("en una actividad sin fuente automática no muestra el aviso de fuente única", () => {
    render(<PdtpExecutionForm activityId="a" worksiteId="ws-1" year={2026} mechanism="constancia" />)
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }))
    expect(screen.queryByText(/cuenta una sola vez/i)).toBeNull()
  })

  it("rechaza en el cliente un archivo sobre 25 MB sin intentar subirlo (PREV-I09)", async () => {
    render(<PdtpExecutionForm activityId="a" worksiteId="ws-1" year={2026} />)
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }))
    const big = new File(["x"], "acta-grande.pdf", { type: "application/pdf" })
    Object.defineProperty(big, "size", { value: 26 * 1024 * 1024 })
    fireEvent.change(screen.getByLabelText("Evidencia (foto o PDF)"), { target: { files: [big] } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar ejecución" }))

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled())
    expect(String(mockToast.error.mock.calls[0]![0])).toMatch(/supera 25 MB/)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    expect(mockMarkPdtpExecutionFormAction).not.toHaveBeenCalled()
  })
})
