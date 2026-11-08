// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CopecAdminStatus } from "@/lib/combustibles/copec-settings"
import type { VisionLinkAdminStatus } from "@/lib/integrations/visionlink/visionlink-settings"

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  saveCopec: vi.fn(),
  clearCopec: vi.fn(),
  testCopec: vi.fn(),
  saveVisionLink: vi.fn(),
  clearVisionLink: vi.fn(),
  testVisionLink: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock("@/lib/toast", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }))
vi.mock("./actions", () => ({
  saveCopecSettingsAction: (...args: unknown[]) => mocks.saveCopec(...args),
  clearCopecSettingsAction: (...args: unknown[]) => mocks.clearCopec(...args),
  testCopecConnectionAction: (...args: unknown[]) => mocks.testCopec(...args),
  saveVisionLinkSettingsAction: (...args: unknown[]) => mocks.saveVisionLink(...args),
  clearVisionLinkSettingsAction: (...args: unknown[]) => mocks.clearVisionLink(...args),
  testVisionLinkConnectionAction: (...args: unknown[]) => mocks.testVisionLink(...args),
}))

const { CopecSettingsDialog } = await import("./copec-settings-dialog")
const { VisionLinkSettingsDialog } = await import("./visionlink-settings-dialog")

/** Valores que NUNCA deben aparecer en el HTML: el servidor no los manda, y si se colaran aquí se verían. */
const SECRETS = ["usuario-secreto", "clave-secreta", "secreto-de-vision"]

const copecStatus: CopecAdminStatus = {
  fields: {
    username: { configured: true, source: "system_settings" },
    password: { configured: true, source: "system_settings" },
    clientRut: { configured: true, source: "environment", value: "76123456-0" },
    syncEnabled: { configured: false, source: "missing" },
    importerEmail: { configured: true, source: "environment", value: "importador@chome.cl" },
  },
  hasStoredSettings: true,
  canStoreSecrets: true,
}

const visionStatus: VisionLinkAdminStatus = {
  fields: {
    clientId: { configured: true, source: "environment", value: "id-de-vision" },
    clientSecret: { configured: true, source: "environment" },
    scope: { configured: false, source: "missing" },
    syncEnabled: { configured: true, source: "system_settings", value: "true" },
  },
  hasStoredSettings: false,
  canStoreSecrets: true,
}

function open(name = "Configurar") {
  fireEvent.click(screen.getByRole("button", { name }))
  return screen.getByRole("dialog")
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.saveCopec.mockResolvedValue({ ok: true, message: "Configuración de Copec guardada." })
  mocks.clearCopec.mockResolvedValue({ ok: true, message: "Se restauró la configuración del servidor" })
  mocks.testCopec.mockResolvedValue({ ok: true, message: "Conexión correcta: Copec aceptó las credenciales." })
  mocks.saveVisionLink.mockResolvedValue({ ok: true, message: "Configuración de VisionLink guardada." })
  mocks.clearVisionLink.mockResolvedValue({ ok: true, message: "Se restauró la configuración del servidor" })
  mocks.testVisionLink.mockResolvedValue({ ok: true, message: "Conexión correcta: VisionLink aceptó las credenciales." })
})

describe("CopecSettingsDialog", () => {
  it("abre con los secretos vacíos, el RUT y el correo precargados, y sin un solo secreto en el HTML", () => {
    render(<CopecSettingsDialog status={copecStatus} />)
    const dialog = open()

    expect(within(dialog).getByLabelText("Usuario")).toHaveValue("")
    expect(within(dialog).getByLabelText("Contraseña")).toHaveValue("")
    expect(within(dialog).getByLabelText("RUT de la empresa")).toHaveValue("76123456-0")
    expect(within(dialog).getByLabelText("Usuario que registra la actualización")).toHaveValue("importador@chome.cl")
    for (const secret of SECRETS) expect(document.body.innerHTML).not.toContain(secret)
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument()
  })

  it("dice de dónde viene cada credencial y ofrece borrar sólo lo guardado en la plataforma", () => {
    render(<CopecSettingsDialog status={copecStatus} />)
    const dialog = open()
    // Usuario y contraseña están guardados en la plataforma; el RUT y el correo vienen del .env.
    expect(within(dialog).getAllByText(/Guardado en la plataforma · vacío conserva el valor actual/, { selector: "p" })).toHaveLength(2)
    expect(within(dialog).getByLabelText("Borrar el valor guardado (Usuario)")).toBeEnabled()
    expect(within(dialog).getByLabelText("Borrar el valor guardado (Contraseña)")).toBeEnabled()
    expect(within(dialog).getAllByText(/^Del servidor \(\.env\)\./, { selector: "p" })).toHaveLength(2)
  })

  it("el interruptor parte encendido cuando nada lo apaga (el default de Copec)", () => {
    render(<CopecSettingsDialog status={copecStatus} />)
    const dialog = open()
    expect(within(dialog).getByRole("checkbox", { name: "Activar la actualización diaria de Copec" })).toBeChecked()
  })

  it("el interruptor parte apagado cuando lo apagó lo guardado", () => {
    render(<CopecSettingsDialog status={{
      ...copecStatus,
      fields: { ...copecStatus.fields, syncEnabled: { configured: true, source: "system_settings", value: "false" } },
    }} />)
    const dialog = open()
    expect(within(dialog).getByRole("checkbox", { name: "Activar la actualización diaria de Copec" })).not.toBeChecked()
  })

  it("sin llavero avisa, deshabilita los secretos y deja guardar lo demás", () => {
    render(<CopecSettingsDialog status={{ ...copecStatus, canStoreSecrets: false }} />)
    const dialog = open()
    expect(within(dialog).getByRole("alert")).toHaveTextContent("No hay llavero de cifrado en el servidor")
    expect(within(dialog).getByLabelText("Usuario")).toBeDisabled()
    expect(within(dialog).getByLabelText("Contraseña")).toBeDisabled()
    expect(within(dialog).getByLabelText("RUT de la empresa")).toBeEnabled()
    expect(within(dialog).getByRole("button", { name: "Guardar" })).toBeEnabled()
  })

  it("«Restaurar la configuración del servidor» sólo existe si hay algo guardado", () => {
    const { unmount } = render(<CopecSettingsDialog status={{ ...copecStatus, hasStoredSettings: false }} />)
    expect(within(open()).queryByRole("button", { name: "Restaurar la configuración del servidor" })).not.toBeInTheDocument()
    unmount()

    render(<CopecSettingsDialog status={copecStatus} />)
    expect(within(open()).getByRole("button", { name: "Restaurar la configuración del servidor" })).toBeInTheDocument()
  })

  it("guarda lo escrito: los campos viajan en el envío y el diálogo se cierra al terminar", async () => {
    render(<CopecSettingsDialog status={copecStatus} />)
    const dialog = open()
    fireEvent.change(within(dialog).getByLabelText("Contraseña"), { target: { value: "clave-nueva" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }))

    await waitFor(() => expect(mocks.saveCopec).toHaveBeenCalledTimes(1))
    const formData = mocks.saveCopec.mock.calls[0]![1] as FormData
    expect(formData.get("password")).toBe("clave-nueva")
    expect(formData.get("clientRut")).toBe("76123456-0")
    expect(formData.get("syncEnabled")).toBe("on")
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Configuración de Copec guardada."))
    expect(mocks.refresh).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("si el guardado falla deja el diálogo abierto y muestra el motivo", async () => {
    mocks.saveCopec.mockResolvedValue({ ok: false, message: "El RUT de la empresa tiene el dígito verificador incorrecto." })
    render(<CopecSettingsDialog status={copecStatus} />)
    fireEvent.click(within(open()).getByRole("button", { name: "Guardar" }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("El RUT de la empresa tiene el dígito verificador incorrecto."))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it("«Probar conexión» muestra el resultado dentro del diálogo y avisa que prueba lo guardado", async () => {
    render(<CopecSettingsDialog status={copecStatus} />)
    const dialog = open()
    expect(within(dialog).getByText("Prueba lo guardado: guarda los cambios antes.")).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole("button", { name: "Probar conexión" }))
    expect(await within(dialog).findByRole("status")).toHaveTextContent("Conexión correcta: Copec aceptó las credenciales.")
    expect(mocks.testCopec).toHaveBeenCalledTimes(1)
  })

  it("una prueba fallida se muestra como alerta, no como éxito", async () => {
    mocks.testCopec.mockResolvedValue({ ok: false, message: "Copec rechazó la consulta. Revisa el usuario, la contraseña y el RUT de la empresa." })
    render(<CopecSettingsDialog status={copecStatus} />)
    const dialog = open()
    fireEvent.click(within(dialog).getByRole("button", { name: "Probar conexión" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Copec rechazó la consulta")
  })

  it("restaurar pide confirmación y no borra nada hasta confirmar", async () => {
    render(<CopecSettingsDialog status={copecStatus} />)
    fireEvent.click(within(open()).getByRole("button", { name: "Restaurar la configuración del servidor" }))

    expect(mocks.clearCopec).not.toHaveBeenCalled()
    const confirm = await screen.findByRole("dialog", { name: "¿Restaurar la configuración del servidor?" })
    fireEvent.click(within(confirm).getByRole("button", { name: "Restaurar" }))

    await waitFor(() => expect(mocks.clearCopec).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Se restauró la configuración del servidor"))
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it("si restaurar falla, el motivo se ve dentro de la confirmación", async () => {
    mocks.clearCopec.mockResolvedValue({ ok: false, message: "No se pudo restaurar la configuración del servidor" })
    render(<CopecSettingsDialog status={copecStatus} />)
    fireEvent.click(within(open()).getByRole("button", { name: "Restaurar la configuración del servidor" }))
    const confirm = await screen.findByRole("dialog", { name: "¿Restaurar la configuración del servidor?" })
    fireEvent.click(within(confirm).getByRole("button", { name: "Restaurar" }))
    expect(await within(confirm).findByRole("alert")).toHaveTextContent("No se pudo restaurar")
  })
})

describe("VisionLinkSettingsDialog", () => {
  it("abre con el secreto vacío, el client id precargado y sin secretos en el HTML", () => {
    render(<VisionLinkSettingsDialog status={visionStatus} />)
    const dialog = open()
    expect(within(dialog).getByLabelText("Client secret")).toHaveValue("")
    expect(within(dialog).getByLabelText("Client id")).toHaveValue("id-de-vision")
    expect(within(dialog).getByLabelText("Scope")).toHaveValue("")
    for (const secret of SECRETS) expect(document.body.innerHTML).not.toContain(secret)
  })

  it("el interruptor refleja lo guardado y viaja en el envío", async () => {
    render(<VisionLinkSettingsDialog status={visionStatus} />)
    const dialog = open()
    const toggle = within(dialog).getByRole("checkbox", { name: "Activar la actualización diaria de VisionLink" })
    expect(toggle).toBeChecked()

    fireEvent.click(toggle)
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }))
    await waitFor(() => expect(mocks.saveVisionLink).toHaveBeenCalledTimes(1))
    expect((mocks.saveVisionLink.mock.calls[0]![1] as FormData).get("syncEnabled")).toBe("")
  })

  it("apagado por omisión: el .env sólo la enciende con «true»", () => {
    render(<VisionLinkSettingsDialog status={{
      ...visionStatus,
      fields: { ...visionStatus.fields, syncEnabled: { configured: false, source: "missing" } },
    }} />)
    expect(within(open()).getByRole("checkbox", { name: "Activar la actualización diaria de VisionLink" })).not.toBeChecked()
  })

  it("sin llavero deshabilita el secreto y avisa qué sí se puede guardar", () => {
    render(<VisionLinkSettingsDialog status={{ ...visionStatus, canStoreSecrets: false }} />)
    const dialog = open()
    expect(within(dialog).getByRole("alert")).toHaveTextContent("El client id, el scope y el interruptor sí se pueden guardar.")
    expect(within(dialog).getByLabelText("Client secret")).toBeDisabled()
    expect(within(dialog).getByLabelText("Client id")).toBeEnabled()
  })

  it("«Probar conexión» usa la acción de VisionLink", async () => {
    render(<VisionLinkSettingsDialog status={visionStatus} />)
    const dialog = open()
    fireEvent.click(within(dialog).getByRole("button", { name: "Probar conexión" }))
    expect(await within(dialog).findByRole("status")).toHaveTextContent("VisionLink aceptó las credenciales")
    expect(mocks.testVisionLink).toHaveBeenCalledTimes(1)
    expect(mocks.testCopec).not.toHaveBeenCalled()
  })

  it("«Restaurar» sólo aparece con algo guardado", () => {
    render(<VisionLinkSettingsDialog status={visionStatus} />)
    expect(within(open()).queryByRole("button", { name: "Restaurar la configuración del servidor" })).not.toBeInTheDocument()
  })
})
