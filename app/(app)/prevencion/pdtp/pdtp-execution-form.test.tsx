// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

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
  it("en una semana aprobada parcialmente ofrece registrar un complemento (PRV-08)", () => {
    render(<PdtpExecutionForm activityId="a" worksiteId="ws-1" year={2025} defaultMonth={3} defaultWeek={1}
      partialApprovedCells={[{ month: 3, week: 1, executed: 1, planned: 3 }]} />)
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }))
    expect(screen.getByRole("heading", { name: /Registrar complemento/ })).toBeTruthy()
    expect(screen.getByText(/ya tiene 1 de 3 aprobadas/)).toBeTruthy()
  })

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

  it("el diálogo dice qué actividad se está registrando: N° y nombre (PREV-I01)", () => {
    render(<PdtpExecutionForm activityId="a" worksiteId="ws-1" year={2026} activityN={42} activityName="Inspección de extintores" />)
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByRole("heading", { name: /N°42/ })).toBeTruthy()
    expect(within(dialog).getByText("Inspección de extintores")).toBeTruthy()
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
