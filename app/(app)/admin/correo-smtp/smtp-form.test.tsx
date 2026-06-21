// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { INITIAL_STATE } from "@/components/admin/form-state"

const mockTestResendAction = vi.hoisted(() => vi.fn())

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("./actions", () => ({
  setEmailsEnabledAction: vi.fn(async () => INITIAL_STATE),
  testResendAction: mockTestResendAction,
}))

vi.mock("@/components/admin/submit-button", () => ({
  SubmitButton: ({ label, disabled }: { label: string; disabled?: boolean }) => (
    <button type="submit" disabled={disabled}>{label}</button>
  ),
}))

import { CorreoForms } from "./smtp-form"
import { toast } from "@/lib/toast"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const configuredStatus = {
  configured: true,
  from: "plataforma@portalchome.cl",
  apiKeyPrefix: "re_liv…",
}

const unconfiguredStatus = {
  configured: false,
  from: "plataforma@portalchome.cl",
  apiKeyPrefix: "—",
}

describe("CorreoForms — Resend status card", () => {
  it("shows configured state and test button when key is present", () => {
    render(<CorreoForms resendStatus={configuredStatus} initialEmailsEnabled={true} />)
    expect(screen.getByText("✓ Configurado")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Enviar correo de prueba" })).toBeInTheDocument()
    expect(screen.queryByText(/Configura.*RESEND_API_KEY/)).not.toBeInTheDocument()
  })

  it("hides the test button and shows warning when key is absent", () => {
    render(<CorreoForms resendStatus={unconfiguredStatus} initialEmailsEnabled={true} />)
    expect(screen.getByText("✗ No configurado")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Enviar correo de prueba" })).not.toBeInTheDocument()
    expect(screen.getByText(/Configura/)).toBeInTheDocument()
  })

  it("shows the from address", () => {
    render(<CorreoForms resendStatus={configuredStatus} initialEmailsEnabled={true} />)
    expect(screen.getByText("plataforma@portalchome.cl")).toBeInTheDocument()
  })

  it("shows success toast when test send succeeds", async () => {
    mockTestResendAction.mockResolvedValueOnce({ ok: true, message: "Enviado a admin@x.cl" })
    render(<CorreoForms resendStatus={configuredStatus} initialEmailsEnabled={true} />)

    fireEvent.click(screen.getByRole("button", { name: "Enviar correo de prueba" }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Enviado a admin@x.cl"))
    expect(mockTestResendAction).toHaveBeenCalledOnce()
  })

  it("shows error toast when test send fails", async () => {
    mockTestResendAction.mockResolvedValueOnce({ ok: false, message: "RESEND_API_KEY no configurado" })
    render(<CorreoForms resendStatus={configuredStatus} initialEmailsEnabled={true} />)

    fireEvent.click(screen.getByRole("button", { name: "Enviar correo de prueba" }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("RESEND_API_KEY no configurado"))
  })
})
