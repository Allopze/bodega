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
})
