// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { INITIAL_STATE } from "@/lib/form-state"

const mockTestResendAction = vi.hoisted(() => vi.fn())
const mockSaveResendApiKeyAction = vi.hoisted(() => vi.fn())
const mockRestoreResendSettingsAction = vi.hoisted(() => vi.fn())

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("./actions", () => ({
  setEmailsEnabledAction: vi.fn(async () => INITIAL_STATE),
  testResendAction: mockTestResendAction,
  saveResendApiKeyAction: mockSaveResendApiKeyAction,
  restoreResendSettingsAction: mockRestoreResendSettingsAction,
}))

vi.mock("@/components/ui/submit-button", () => ({
  SubmitButton: ({ label, disabled }: { label: string; disabled?: boolean }) => (
    <button type="submit" disabled={disabled}>{label}</button>
  ),
}))

import { CorreoForms } from "./smtp-form"
import { toast } from "@/lib/toast"
import type { ResendStatus } from "@/lib/services/smtp-settings"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Estado seguro que llega del servidor: dice si hay clave y de dónde, nunca la clave.
const configuredStatus: ResendStatus = {
  configured: true,
  source: "environment",
  hasStoredSettings: false,
  canStoreSecrets: true,
  from: "plataforma@portalchome.cl",
}

const storedStatus: ResendStatus = {
  ...configuredStatus,
  source: "system_settings",
  hasStoredSettings: true,
}

const unconfiguredStatus: ResendStatus = {
  configured: false,
  source: "missing",
  hasStoredSettings: false,
  canStoreSecrets: true,
  from: "plataforma@portalchome.cl",
}

describe("CorreoForms — Resend status card", () => {
  it("shows configured state and test button when key is present", () => {
    render(<CorreoForms resendStatus={configuredStatus} initialEmailsEnabled={true} lastTest={null} />)
    expect(screen.getByText("Configurado: prueba de envío pendiente")).toBeInTheDocument()
    expect(screen.getByText("Configurado; requiere prueba")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Enviar correo de prueba" })).toBeInTheDocument()
    expect(screen.queryByText(/Guarda una clave de API/)).not.toBeInTheDocument()
    expect(screen.queryByText(/RESEND_API_KEY/)).not.toBeInTheDocument()
  })

  it("hides the test button and shows warning when key is absent", () => {
    render(<CorreoForms resendStatus={unconfiguredStatus} initialEmailsEnabled={true} lastTest={null} />)
    expect(screen.getByText("Suspendido: proveedor no configurado")).toBeInTheDocument()
    expect(screen.getByText("No configurado")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Enviar correo de prueba" })).not.toBeInTheDocument()
    expect(screen.getByText(/Guarda una clave de API de Resend/)).toBeInTheDocument()
    expect(screen.queryByText(/RESEND_API_KEY/)).not.toBeInTheDocument()
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
    mockTestResendAction.mockResolvedValueOnce({ ok: false, message: "Clave de Resend no configurada" })
    render(<CorreoForms resendStatus={configuredStatus} initialEmailsEnabled={true} lastTest={null} />)

    fireEvent.click(screen.getByRole("button", { name: "Enviar correo de prueba" }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Clave de Resend no configurada"))
  })
})

describe("CorreoForms — clave de API de Resend", () => {
  it("muestra de dónde viene la clave en lugar de un prefijo", () => {
    const { rerender } = render(<CorreoForms resendStatus={configuredStatus} initialEmailsEnabled={true} lastTest={null} />)
    expect(screen.getByText("Origen de la clave API")).toBeInTheDocument()
    expect(screen.getByText("Del servidor (.env)")).toBeInTheDocument()
    expect(screen.queryByText("Clave API (prefijo)")).not.toBeInTheDocument()

    rerender(<CorreoForms resendStatus={storedStatus} initialEmailsEnabled={true} lastTest={null} />)
    expect(screen.getByText("Guardado en la plataforma")).toBeInTheDocument()

    rerender(<CorreoForms resendStatus={unconfiguredStatus} initialEmailsEnabled={true} lastTest={null} />)
    expect(screen.getByText("Sin configurar")).toBeInTheDocument()
  })

  it("el campo es de solo escritura: parte vacío, enmascarado y sin valor en el HTML", () => {
    const { container } = render(<CorreoForms resendStatus={storedStatus} initialEmailsEnabled={true} lastTest={null} />)
    const input = screen.getByLabelText("Clave API de Resend")
    expect(input).toHaveValue("")
    expect(input).toHaveAttribute("type", "password")
    expect(input).not.toHaveAttribute("value")
    // Ni la clave ni un prefijo (el prefijo de antes: «re_liv…») viajan al navegador.
    expect(container.innerHTML).not.toContain("re_liv")
  })

  it("ofrece borrar sólo lo que se guardó desde la pantalla", () => {
    const { rerender } = render(<CorreoForms resendStatus={storedStatus} initialEmailsEnabled={true} lastTest={null} />)
    expect(screen.getByLabelText("Borrar el valor guardado (Clave API de Resend)")).toBeInTheDocument()

    rerender(<CorreoForms resendStatus={configuredStatus} initialEmailsEnabled={true} lastTest={null} />)
    expect(screen.queryByLabelText("Borrar el valor guardado (Clave API de Resend)")).not.toBeInTheDocument()
  })

  it("con llavero el botón de guardar está habilitado y no hay aviso", () => {
    render(<CorreoForms resendStatus={configuredStatus} initialEmailsEnabled={true} lastTest={null} />)
    expect(screen.getByRole("button", { name: "Guardar clave" })).toBeEnabled()
    expect(screen.queryByText("No hay llavero de cifrado en el servidor")).not.toBeInTheDocument()
  })

  it("sin llavero deshabilita el guardado y explica por qué, sin quitar la prueba de envío", () => {
    render(<CorreoForms resendStatus={{ ...configuredStatus, canStoreSecrets: false }} initialEmailsEnabled={true} lastTest={null} />)
    expect(screen.getByText("No hay llavero de cifrado en el servidor")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Guardar clave" })).toBeDisabled()
    expect(screen.getByLabelText("Clave API de Resend")).toBeDisabled()
    expect(screen.getByRole("button", { name: "Enviar correo de prueba" })).toBeEnabled()
  })

  it("envía la clave escrita a la acción y avisa el resultado", async () => {
    mockSaveResendApiKeyAction.mockResolvedValueOnce({ ok: true, message: "Clave de Resend guardada" })
    render(<CorreoForms resendStatus={configuredStatus} initialEmailsEnabled={true} lastTest={null} />)

    fireEvent.change(screen.getByLabelText("Clave API de Resend"), { target: { value: "re_new_key" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar clave" }))

    await waitFor(() => expect(mockSaveResendApiKeyAction).toHaveBeenCalledOnce())
    const formData = mockSaveResendApiKeyAction.mock.calls[0]![1] as FormData
    expect(formData.get("apiKey")).toBe("re_new_key")
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Clave de Resend guardada"))
  })

  it("muestra el error del servidor cuando el guardado falla", async () => {
    mockSaveResendApiKeyAction.mockResolvedValueOnce({ ok: false, message: "No hay llavero de cifrado activo" })
    render(<CorreoForms resendStatus={configuredStatus} initialEmailsEnabled={true} lastTest={null} />)

    fireEvent.change(screen.getByLabelText("Clave API de Resend"), { target: { value: "re_new_key" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar clave" }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No hay llavero de cifrado activo"))
  })

  it("«Restaurar» sólo aparece si hay algo guardado en la plataforma", () => {
    const { rerender } = render(<CorreoForms resendStatus={storedStatus} initialEmailsEnabled={true} lastTest={null} />)
    expect(screen.getByRole("button", { name: "Restaurar la configuración del servidor" })).toBeInTheDocument()

    rerender(<CorreoForms resendStatus={configuredStatus} initialEmailsEnabled={true} lastTest={null} />)
    expect(screen.queryByRole("button", { name: "Restaurar la configuración del servidor" })).not.toBeInTheDocument()
  })

  it("restaurar pide confirmación y no llama a la acción hasta confirmar", async () => {
    mockRestoreResendSettingsAction.mockResolvedValueOnce({ ok: true, message: "Se restauró la configuración del servidor" })
    render(<CorreoForms resendStatus={storedStatus} initialEmailsEnabled={true} lastTest={null} />)

    fireEvent.click(screen.getByRole("button", { name: "Restaurar la configuración del servidor" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("¿Restaurar la configuración del servidor?")).toBeInTheDocument()
    expect(mockRestoreResendSettingsAction).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole("button", { name: "Restaurar" }))
    await waitFor(() => expect(mockRestoreResendSettingsAction).toHaveBeenCalledOnce())
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Se restauró la configuración del servidor"))
  })

  it("si restaurar falla, el motivo queda dentro del diálogo, que sigue abierto", async () => {
    mockRestoreResendSettingsAction.mockResolvedValueOnce({ ok: false, message: "No fue posible restaurar" })
    render(<CorreoForms resendStatus={storedStatus} initialEmailsEnabled={true} lastTest={null} />)

    fireEvent.click(screen.getByRole("button", { name: "Restaurar la configuración del servidor" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Restaurar" }))

    await waitFor(() => expect(within(dialog).getByText("No fue posible restaurar")).toBeInTheDocument())
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
  })
})
