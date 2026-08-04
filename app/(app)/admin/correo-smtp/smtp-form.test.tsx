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
    render(<CorreoForms resendStatus={configuredStatus} initialEmailsEnabled={true} lastTest={null} />)
    expect(screen.getByText("Configurado: prueba de envío pendiente")).toBeInTheDocument()
    expect(screen.getByText("Configurado; requiere prueba")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Enviar correo de prueba" })).toBeInTheDocument()
    expect(screen.queryByText(/Configura.*RESEND_API_KEY/)).not.toBeInTheDocument()
  })

  it("hides the test button and shows warning when key is absent", () => {
    render(<CorreoForms resendStatus={unconfiguredStatus} initialEmailsEnabled={true} lastTest={null} />)
    expect(screen.getByText("Suspendido: proveedor no configurado")).toBeInTheDocument()
    expect(screen.getByText("No configurado")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Enviar correo de prueba" })).not.toBeInTheDocument()
    expect(screen.getByText(/Configura/)).toBeInTheDocument()
  })

  it("reports that the global switch suspends delivery even with a configured provider", () => {
    render(<CorreoForms resendStatus={configuredStatus} initialEmailsEnabled={false} lastTest={null} />)
    expect(screen.getByText("Suspendido: envíos globales desactivados")).toBeInTheDocument()
  })

  // El estado "pendiente" no podía cambiar nunca: la prueba se registraba en la
  // auditoría y la pantalla no la leía. Verde sólo con entrega aceptada.
  it("reports confirmed delivery once the provider accepted a test", () => {
    render(<CorreoForms
      resendStatus={configuredStatus}
      initialEmailsEnabled={true}
      lastTest={{ attemptedAt: "2026-08-03T12:00:00.000Z", recipient: "admin@x.cl", ok: true, error: null }}
    />)
    expect(screen.getByText("Entrega confirmada")).toBeInTheDocument()
    expect(screen.getByText(/admin@x\.cl/)).toBeInTheDocument()
    expect(screen.queryByText("Configurado: prueba de envío pendiente")).not.toBeInTheDocument()
  })

  it("names the cause when the last test failed", () => {
    render(<CorreoForms
      resendStatus={configuredStatus}
      initialEmailsEnabled={true}
      lastTest={{ attemptedAt: "2026-08-03T12:00:00.000Z", recipient: "admin@x.cl", ok: false, error: "Dominio no verificado" }}
    />)
    expect(screen.getByText("La última prueba de envío falló")).toBeInTheDocument()
    expect(screen.getByText("Dominio no verificado")).toBeInTheDocument()
  })

  it("shows the from address", () => {
    render(<CorreoForms resendStatus={configuredStatus} initialEmailsEnabled={true} lastTest={null} />)
    expect(screen.getByText("plataforma@portalchome.cl")).toBeInTheDocument()
  })

  it("shows success toast when test send succeeds", async () => {
    mockTestResendAction.mockResolvedValueOnce({ ok: true, message: "Enviado a admin@x.cl" })
    render(<CorreoForms resendStatus={configuredStatus} initialEmailsEnabled={true} lastTest={null} />)

    fireEvent.click(screen.getByRole("button", { name: "Enviar correo de prueba" }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Enviado a admin@x.cl"))
    expect(mockTestResendAction).toHaveBeenCalledOnce()
  })

  it("shows error toast when test send fails", async () => {
    mockTestResendAction.mockResolvedValueOnce({ ok: false, message: "RESEND_API_KEY no configurado" })
    render(<CorreoForms resendStatus={configuredStatus} initialEmailsEnabled={true} lastTest={null} />)

    fireEvent.click(screen.getByRole("button", { name: "Enviar correo de prueba" }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("RESEND_API_KEY no configurado"))
  })
})
