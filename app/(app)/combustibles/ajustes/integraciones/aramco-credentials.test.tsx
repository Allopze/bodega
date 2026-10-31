// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AramcoAdminStatus } from "@/lib/combustibles/aramco-settings"

const save = vi.hoisted(() => vi.fn())
const clear = vi.hoisted(() => vi.fn())
vi.mock("../../importar/aramco-sync-action", () => ({ saveAramcoSettingsAction: save, clearAramcoSettingsAction: clear }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const { AramcoCredentials } = await import("./aramco-credentials")

const configured: AramcoAdminStatus = {
  syncEnabled: true,
  fields: { documentNumber: { configured: true, source: "system_settings" }, password: { configured: true, source: "system_settings" } },
  hasStoredSettings: true,
  canStoreSecrets: true,
}
const missing: AramcoAdminStatus = {
  syncEnabled: false,
  fields: { documentNumber: { configured: false, source: "missing" }, password: { configured: false, source: "missing" } },
  hasStoredSettings: false,
  canStoreSecrets: true,
}

describe("credenciales de Aramco", () => {
  beforeEach(() => vi.clearAllMocks())

  it("configuradas: dice desde cuándo y de dónde, sin campos ni valores", () => {
    const { container } = render(<AramcoCredentials status={configured} configuredAt="2026-10-28T13:45:00.000Z" />)
    expect(screen.getByText(/Credenciales guardadas el .+\./)).toBeInTheDocument()
    expect(screen.getAllByText(/Configurada · guardada en la aplicación/)).toHaveLength(2)
    expect(container.querySelector("input[type=password]")).toBeNull()
    expect(screen.queryByLabelText("Clave")).toBeNull()
    expect(screen.getByRole("button", { name: "Reemplazar credenciales" })).toBeInTheDocument()
  })

  it("heredadas del servidor no inventan una fecha ni ofrecen quitar lo guardado", () => {
    const fromEnv: AramcoAdminStatus = {
      syncEnabled: true,
      fields: { documentNumber: { configured: true, source: "environment" }, password: { configured: true, source: "environment" } },
      hasStoredSettings: false,
      canStoreSecrets: true,
    }
    render(<AramcoCredentials status={fromEnv} configuredAt={null} />)
    expect(screen.getAllByText(/heredada del servidor/)).toHaveLength(2)
    expect(screen.queryByText(/Credenciales guardadas el/)).toBeNull()
    expect(screen.queryByRole("button", { name: "Quitar las guardadas" })).toBeNull()
  })

  it("reemplazar abre campos vacíos (la clave es de tipo contraseña) y guarda sólo lo escrito", async () => {
    save.mockResolvedValue({ ok: true, message: "Configuración de Aramco guardada." })
    render(<AramcoCredentials status={configured} configuredAt="2026-10-28T13:45:00.000Z" />)
    fireEvent.click(screen.getByRole("button", { name: "Reemplazar credenciales" }))

    const password = screen.getByLabelText("Clave")
    expect(password).toHaveAttribute("type", "password")
    expect(password).toHaveValue("")
    expect(screen.getByLabelText("RUT de la cuenta")).toHaveValue("")
    expect(screen.getByRole("button", { name: "Guardar credenciales" })).toBeDisabled()

    fireEvent.change(password, { target: { value: " 12345678 " } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar credenciales" }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ documentNumber: undefined, password: "12345678", syncEnabled: true }))
    // Guardada, la clave no se queda en el DOM.
    await waitFor(() => expect(screen.queryByLabelText("Clave")).toBeNull())
  })

  it("sin credenciales el formulario se muestra de entrada y avisa si la actualización está activa", () => {
    render(<AramcoCredentials status={{ ...missing, syncEnabled: true }} configuredAt={null} />)
    expect(screen.getByLabelText("RUT de la cuenta")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull()
    expect(screen.getByText(/faltan las credenciales/)).toBeInTheDocument()
  })

  it("sin llave de cifrado en el servidor no deja guardar y lo explica", () => {
    render(<AramcoCredentials status={{ ...missing, canStoreSecrets: false }} configuredAt={null} />)
    expect(screen.getByText(/no tiene la llave de cifrado configurada/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Clave"), { target: { value: "1234" } })
    expect(screen.getByRole("button", { name: "Guardar credenciales" })).toBeDisabled()
  })

  it("el interruptor de la actualización diaria guarda sólo ese valor, sin tocar las credenciales", async () => {
    save.mockResolvedValue({ ok: true, message: "Configuración de Aramco guardada." })
    render(<AramcoCredentials status={configured} configuredAt={null} />)
    fireEvent.click(screen.getByRole("checkbox", { name: "Actualizar sola cada día" }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ syncEnabled: false }))
  })

  it("quitar las guardadas pide confirmación antes de borrar", async () => {
    clear.mockResolvedValue({ ok: true })
    render(<AramcoCredentials status={configured} configuredAt={null} />)
    fireEvent.click(screen.getByRole("button", { name: "Quitar las guardadas" }))
    const dialog = await screen.findByRole("dialog", { name: "Quitar las credenciales guardadas" })
    expect(clear).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Quitar credenciales" }))
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1))
  })
})
