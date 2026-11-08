// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TalanaAdminStatus } from "@/lib/integrations/talana/talana-settings"

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
  test: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/talana",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/lib/toast", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError, warning: vi.fn(), info: vi.fn() } }))
vi.mock("./settings-actions", () => ({
  saveTalanaSettingsAction: mocks.save,
  clearTalanaSettingsAction: mocks.clear,
  testTalanaConnectionAction: mocks.test,
}))

import { TalanaSettingsDialog } from "./talana-settings-dialog"

const FAKE_ENV_TOKEN = "token-del-servidor-falso"

const STATUS: TalanaAdminStatus = {
  token: { configured: true, source: "environment" },
  mode: "simulate",
  modeSource: "environment",
  hasStoredSettings: false,
  canStoreSecrets: true,
}

function openDialog(status: TalanaAdminStatus = STATUS) {
  render(<TalanaSettingsDialog status={status} />)
  fireEvent.click(screen.getByRole("button", { name: "Configurar" }))
  return screen.getByRole("dialog", { name: "Configurar la sincronización con Talana" })
}

const modeRadio = (name: string) => screen.getByRole("radio", { name })
const hiddenMode = (dialog: HTMLElement) => dialog.querySelector<HTMLInputElement>('input[type="hidden"][name="mode"]')

beforeEach(() => {
  mocks.save.mockResolvedValue({ ok: true, message: "Configuración de Talana guardada." })
  mocks.clear.mockResolvedValue({ ok: true, message: "Se restauró la configuración del servidor." })
  mocks.test.mockResolvedValue({ ok: true, message: "Conexión correcta: Talana aceptó el token." })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("TalanaSettingsDialog", () => {
  it("el token parte vacío y el DOM no lleva ningún valor de token: sólo dice de dónde viene", () => {
    const dialog = openDialog()
    const token = within(dialog).getByLabelText("Token de la API")
    expect(token).toHaveValue("")
    expect(token).toHaveAttribute("type", "password")
    expect(within(dialog).getByText(/Del servidor \(\.env\) · vacío conserva el valor actual/)).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain(FAKE_ENV_TOKEN)
  })

  it("ofrece los tres modos y marca el vigente; el modo sólo viaja si se cambió", () => {
    const dialog = openDialog()
    expect(screen.getByRole("radiogroup", { name: "Modo de sincronización" })).toBeInTheDocument()
    expect(modeRadio("Apagada")).toHaveAttribute("aria-checked", "false")
    expect(modeRadio("Simulación")).toHaveAttribute("aria-checked", "true")
    expect(modeRadio("Aplicar")).toHaveAttribute("aria-checked", "false")
    expect(within(dialog).getByText(/Hoy: Simulación · Del servidor \(\.env\)/)).toBeInTheDocument()
    expect(hiddenMode(dialog)).toBeNull()

    fireEvent.click(modeRadio("Apagada"))
    expect(hiddenMode(dialog)?.value).toBe("off")

    fireEvent.click(modeRadio("Simulación"))
    expect(hiddenMode(dialog)).toBeNull()
  })

  it("sin modo configurado en ningún lado lo dice en vez de inventar un origen", () => {
    const dialog = openDialog({ ...STATUS, token: { configured: false, source: "missing" }, mode: "off", modeSource: "missing" })
    expect(within(dialog).getByText("Hoy está apagada: no hay un modo configurado.")).toBeInTheDocument()
    expect(within(dialog).getByText("Sin configurar.")).toBeInTheDocument()
  })

  it("pasar a «Aplicar» pide confirmación y no guarda hasta que se confirma", async () => {
    const dialog = openDialog()
    fireEvent.click(modeRadio("Aplicar"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }))

    const confirm = await screen.findByRole("dialog", { name: "¿Pasar la sincronización a «Aplicar»?" })
    expect(confirm).toHaveTextContent("altas, bajas, cargos y jefes")
    expect(mocks.save).not.toHaveBeenCalled()

    fireEvent.click(within(confirm).getByRole("button", { name: "Aplicar y guardar" }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    const formData = mocks.save.mock.calls[0]![1] as FormData
    expect(formData.get("mode")).toBe("apply")
    expect(formData.get("apiToken")).toBe("")
  })

  it("cancelar la confirmación no guarda nada", async () => {
    const dialog = openDialog()
    fireEvent.click(modeRadio("Aplicar"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }))
    const confirm = await screen.findByRole("dialog", { name: "¿Pasar la sincronización a «Aplicar»?" })
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "¿Pasar la sincronización a «Aplicar»?" })).toBeNull())
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it("guardar un modo que no es «Aplicar» no pide confirmación", async () => {
    const dialog = openDialog()
    fireEvent.click(modeRadio("Apagada"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole("dialog", { name: "¿Pasar la sincronización a «Aplicar»?" })).toBeNull()
    expect((mocks.save.mock.calls[0]![1] as FormData).get("mode")).toBe("off")
  })

  it("si ya estaba en «Aplicar», guardar otra cosa no vuelve a pedir confirmación ni manda el modo", async () => {
    const dialog = openDialog({ ...STATUS, mode: "apply", modeSource: "system_settings", hasStoredSettings: true })
    fireEvent.change(within(dialog).getByLabelText("Token de la API"), { target: { value: "token-nuevo-falso" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole("dialog", { name: "¿Pasar la sincronización a «Aplicar»?" })).toBeNull()
    const formData = mocks.save.mock.calls[0]![1] as FormData
    expect(formData.get("mode")).toBeNull()
    expect(formData.get("apiToken")).toBe("token-nuevo-falso")
  })

  it("tras guardar bien avisa, cierra y relee la pantalla", async () => {
    const dialog = openDialog()
    fireEvent.click(modeRadio("Apagada"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }))
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Configuración de Talana guardada."))
    expect(mocks.refresh).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Configurar la sincronización con Talana" })).toBeNull())
  })

  it("si el guardado falla avisa con el mensaje del servidor y deja el diálogo abierto", async () => {
    mocks.save.mockResolvedValue({ ok: false, message: "No se pudo guardar la configuración de Talana." })
    const dialog = openDialog()
    fireEvent.click(modeRadio("Apagada"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("No se pudo guardar la configuración de Talana."))
    expect(screen.getByRole("dialog", { name: "Configurar la sincronización con Talana" })).toBeInTheDocument()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it("sin llavero avisa, bloquea el token y deja guardar el modo", async () => {
    const dialog = openDialog({ ...STATUS, canStoreSecrets: false })
    expect(within(dialog).getByRole("alert")).toHaveTextContent("No hay llavero de cifrado en el servidor")
    expect(within(dialog).getByRole("alert")).toHaveTextContent("El modo de sincronización sí se puede guardar")
    expect(within(dialog).getByLabelText("Token de la API")).toBeDisabled()
    expect(within(dialog).getByRole("button", { name: "Guardar" })).toBeEnabled()

    fireEvent.click(modeRadio("Apagada"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    const formData = mocks.save.mock.calls[0]![1] as FormData
    expect(formData.get("mode")).toBe("off")
    expect(formData.get("apiToken")).toBeNull()
  })

  it("con llavero no muestra el aviso", () => {
    const dialog = openDialog()
    expect(within(dialog).queryByRole("alert")).toBeNull()
  })

  it("«Borrar» sólo se ofrece para un token guardado en la plataforma", () => {
    const first = openDialog()
    expect(within(first).queryByLabelText("Borrar el valor guardado (Token de la API)")).toBeNull()
    cleanup()
    const second = openDialog({ ...STATUS, token: { configured: true, source: "system_settings" }, hasStoredSettings: true })
    expect(within(second).getByLabelText("Borrar el valor guardado (Token de la API)")).toBeEnabled()
  })

  it("«Probar conexión» usa lo guardado y muestra el resultado dentro del diálogo", async () => {
    const dialog = openDialog()
    fireEvent.click(within(dialog).getByRole("button", { name: "Probar conexión" }))
    expect(await within(dialog).findByText("Conexión correcta: Talana aceptó el token.")).toBeInTheDocument()
    expect(mocks.test).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByRole("status")).toHaveTextContent("Conexión correcta")
  })

  it("si la prueba falla muestra el motivo como alerta", async () => {
    mocks.test.mockResolvedValue({ ok: false, message: "Talana rechazó el token." })
    const dialog = openDialog()
    fireEvent.click(within(dialog).getByRole("button", { name: "Probar conexión" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Talana rechazó el token.")
  })

  it("sin token configurado no hay nada que probar", () => {
    const dialog = openDialog({ ...STATUS, token: { configured: false, source: "missing" } })
    expect(within(dialog).getByRole("button", { name: "Probar conexión" })).toBeDisabled()
  })

  it("«Restaurar la configuración del servidor» sólo aparece si hay algo guardado y pide confirmación", async () => {
    const first = openDialog()
    expect(within(first).queryByRole("button", { name: "Restaurar la configuración del servidor" })).toBeNull()
    cleanup()

    const dialog = openDialog({ ...STATUS, hasStoredSettings: true, mode: "apply", modeSource: "system_settings" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Restaurar la configuración del servidor" }))
    const confirm = await screen.findByRole("dialog", { name: "¿Restaurar la configuración del servidor?" })
    expect(mocks.clear).not.toHaveBeenCalled()

    await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: "Restaurar" })) })
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Se restauró la configuración del servidor."))
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it("si restaurar falla, el motivo queda dentro de la confirmación y no se cierra nada", async () => {
    mocks.clear.mockResolvedValue({ ok: false, message: "No se pudo restaurar la configuración del servidor." })
    const dialog = openDialog({ ...STATUS, hasStoredSettings: true })
    fireEvent.click(within(dialog).getByRole("button", { name: "Restaurar la configuración del servidor" }))
    const confirm = await screen.findByRole("dialog", { name: "¿Restaurar la configuración del servidor?" })
    fireEvent.click(within(confirm).getByRole("button", { name: "Restaurar" }))
    expect(await within(confirm).findByRole("alert")).toHaveTextContent("No se pudo restaurar la configuración del servidor.")
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it("reabrir el diálogo descarta un modo elegido y no guardado", async () => {
    const dialog = openDialog()
    fireEvent.click(modeRadio("Aplicar"))
    expect(modeRadio("Aplicar")).toHaveAttribute("aria-checked", "true")
    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Configurar la sincronización con Talana" })).toBeNull())

    fireEvent.click(screen.getByRole("button", { name: "Configurar" }))
    expect(modeRadio("Simulación")).toHaveAttribute("aria-checked", "true")
    expect(modeRadio("Aplicar")).toHaveAttribute("aria-checked", "false")
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
