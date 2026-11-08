// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  saveAction: vi.fn(),
  clearAction: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("../actions", () => ({
  saveSalesSyncSettingsAction: (...args: unknown[]) => mocks.saveAction(...args),
  clearSalesSyncSettingsAction: (...args: unknown[]) => mocks.clearAction(...args),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }) }))
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError, warning: vi.fn(), info: vi.fn() },
}))

import { SalesSyncSettingsDialog } from "./sales-sync-settings-dialog"

type Status = Parameters<typeof SalesSyncSettingsDialog>[0]["status"]

function renderDialog(overrides: {
  status?: Partial<Status>
  credentialsConfigured?: boolean
  canManageCredentials?: boolean
} = {}) {
  const status: Status = { enabled: false, source: "environment", hasStoredSettings: false, ...overrides.status }
  render(
    <SalesSyncSettingsDialog
      status={status}
      credentialsConfigured={overrides.credentialsConfigured ?? true}
      canManageCredentials={overrides.canManageCredentials ?? true}
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "Automatización" }))
  return screen.getByRole("dialog")
}

const SWITCH = "Sincronización automática de facturas de venta"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.saveAction.mockResolvedValue({ ok: true, message: "Sincronización automática de facturas de venta activada." })
  mocks.clearAction.mockResolvedValue({ ok: true, message: "Se restauró la configuración del servidor" })
})

describe("SalesSyncSettingsDialog", () => {
  it("el interruptor parte como está hoy y explica qué hace y de dónde viene el valor", () => {
    const dialog = renderDialog({ status: { enabled: true, source: "system_settings", hasStoredSettings: true } })

    expect(screen.getByRole("checkbox", { name: SWITCH })).toBeChecked()
    expect(dialog).toHaveTextContent("Corre todos los días y trae el mes actual y el anterior")
    expect(dialog).toHaveTextContent("Origen del valor actual: Guardado en la plataforma")
  })

  it("dice cuándo el valor viene del .env y cuándo no hay ninguno", () => {
    const env = renderDialog({ status: { source: "environment" } })
    expect(env).toHaveTextContent("Del servidor (.env)")
    expect(env).toHaveTextContent("Guardar lo deja fijo en la plataforma")
  })

  it("sin valor en ninguna parte avisa que queda apagada", () => {
    const dialog = renderDialog({ status: { source: "missing" } })
    expect(dialog).toHaveTextContent("Sin configurar")
    expect(dialog).toHaveTextContent("la automatización queda apagada")
  })

  it("no nombra variables de entorno como forma de configurarlo", () => {
    const dialog = renderDialog()
    expect(dialog.textContent).not.toMatch(/BILLING_/)
  })

  it("enlaza a /admin/dte sólo a quien puede entrar", () => {
    const conAcceso = renderDialog({ canManageCredentials: true })
    expect(conAcceso.querySelector("a[href='/admin/dte']")).not.toBeNull()
  })

  it("sin acceso a /admin/dte nombra la pantalla pero no la enlaza", () => {
    const dialog = renderDialog({ canManageCredentials: false })
    expect(dialog.querySelector("a[href='/admin/dte']")).toBeNull()
    expect(dialog).toHaveTextContent("Administración › Sincronización DTE")
  })

  it("avisa que faltan credenciales sólo si se deja encendida sin ellas", () => {
    renderDialog({ status: { enabled: false }, credentialsConfigured: false })
    expect(screen.queryByRole("status")).toBeNull()

    fireEvent.click(screen.getByRole("checkbox", { name: SWITCH }))
    expect(screen.getByRole("status")).toHaveTextContent("Faltan las credenciales del portal")
  })

  it("no avisa nada si las credenciales están cargadas", () => {
    renderDialog({ status: { enabled: true }, credentialsConfigured: true })
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("guarda lo que muestra el interruptor", async () => {
    renderDialog({ status: { enabled: false } })

    fireEvent.click(screen.getByRole("checkbox", { name: SWITCH }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))

    await waitFor(() => expect(mocks.saveAction).toHaveBeenCalledTimes(1))
    const formData = mocks.saveAction.mock.calls[0]![1] as FormData
    expect(formData.get("syncEnabled")).toBe("on")
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Sincronización automática de facturas de venta activada.",
    ))
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it("apagarlo manda un valor vacío, que el servidor guarda como «false»", async () => {
    renderDialog({ status: { enabled: true, source: "system_settings", hasStoredSettings: true } })

    fireEvent.click(screen.getByRole("checkbox", { name: SWITCH }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))

    await waitFor(() => expect(mocks.saveAction).toHaveBeenCalledTimes(1))
    expect((mocks.saveAction.mock.calls[0]![1] as FormData).get("syncEnabled")).toBe("")
  })

  it("muestra el error del servidor y no cierra el diálogo", async () => {
    mocks.saveAction.mockResolvedValue({ ok: false, message: "No se pudo guardar la configuración de la sincronización de ventas" })
    renderDialog()

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      "No se pudo guardar la configuración de la sincronización de ventas",
    ))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it("«Restaurar» sólo aparece si hay algo guardado", () => {
    renderDialog({ status: { hasStoredSettings: false } })
    expect(screen.queryByRole("button", { name: "Restaurar la del servidor" })).toBeNull()
  })

  it("restaurar pide confirmación y recién entonces llama a la acción", async () => {
    renderDialog({ status: { enabled: true, source: "system_settings", hasStoredSettings: true } })

    fireEvent.click(screen.getByRole("button", { name: "Restaurar la del servidor" }))
    expect(mocks.clearAction).not.toHaveBeenCalled()
    expect(screen.getByText("¿Restaurar la configuración del servidor?")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Restaurar" }))

    await waitFor(() => expect(mocks.clearAction).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Se restauró la configuración del servidor"))
    expect(mocks.refresh).toHaveBeenCalled()
  })
})
