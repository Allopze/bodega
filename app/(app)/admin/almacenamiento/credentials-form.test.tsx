// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { CloudreveAdminStatus } from "@/lib/services/cloudreve/settings"
import { CloudreveStorageForm } from "./credentials-form"

vi.mock("./actions", () => ({
  saveCloudreveStorageAction: vi.fn(async () => ({ ok: true, message: "ok" })),
  clearCloudreveStorageAction: vi.fn(async () => ({ ok: true, message: "ok" })),
  testCloudreveConnectionAction: vi.fn(async () => ({ ok: true, message: "ok" })),
}))

const baseStatus: CloudreveAdminStatus = {
  fields: {
    username: { configured: true, source: "system_settings" },
    password: { configured: true, source: "system_settings" },
  },
  baseUrl: { configured: true, source: "system_settings" },
  sstPath: { configured: true, source: "system_settings", value: "storage/sst-documents" },
  backend: { value: "cloudreve", source: "system_settings" },
  fallbackBackend: "filesystem",
  hasStoredSettings: true,
  canStoreSecrets: true,
}

describe("CloudreveStorageForm", () => {
  it("renders a safe status DTO without serializing effective credential values", () => {
    const { container } = render(<CloudreveStorageForm status={baseStatus} />)

    expect(screen.getByLabelText(/URL base de Cloudreve/)).toHaveValue("")
    expect(screen.getByLabelText(/Contraseña/)).toHaveValue("")
    expect(container.innerHTML).not.toContain("CLOUDREVE_PASSWORD")
  })

  it("offers to clear the values that were persisted from this screen", () => {
    render(<CloudreveStorageForm status={baseStatus} />)

    expect(screen.getByLabelText("Borrar el usuario persistido")).toBeInTheDocument()
    expect(screen.getByLabelText("Borrar la contraseña persistida")).toBeInTheDocument()
    expect(screen.getByLabelText("Borrar la carpeta persistida (volver al default)")).toBeInTheDocument()
  })

  // El checkbox borra la fila de `system_settings`: con el valor heredado del
  // `.env` no hay nada que borrar y ofrecerlo era mentir sobre el efecto.
  it("hides the clear checkboxes for values inherited from the server env", () => {
    render(<CloudreveStorageForm status={{
      ...baseStatus,
      fields: {
        username: { configured: true, source: "environment" },
        password: { configured: true, source: "environment" },
      },
      sstPath: { configured: true, source: "environment", value: "storage/sst-documents" },
    }} />)

    expect(screen.queryByLabelText("Borrar el usuario persistido")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Borrar la contraseña persistida")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Borrar la carpeta persistida (volver al default)")).not.toBeInTheDocument()
  })

  it("warns when the cloudreve backend is active without complete credentials", () => {
    render(<CloudreveStorageForm status={{
      ...baseStatus,
      fields: {
        username: { configured: false, source: "missing" },
        password: { configured: false, source: "missing" },
      },
    }} />)

    expect(screen.getByText(/sin credenciales completas/i)).toBeInTheDocument()
  })

  // Borrar la configuración también borra la key del backend, así que manda el
  // `.env`: prometer «vuelve a filesystem» es falso en un servidor con
  // SST_STORAGE_BACKEND=cloudreve, y ahí el borrado deja la biblioteca rota.
  it("says the truth about the rollback when the server env forces cloudreve", () => {
    render(<CloudreveStorageForm status={{ ...baseStatus, fallbackBackend: "cloudreve" }} />)

    fireEvent.click(screen.getByRole("button", { name: "Restaurar configuración del servidor" }))
    expect(screen.getByText(/seguirá apuntando a Cloudreve, pero sin credenciales/i)).toBeInTheDocument()
  })

  it("promises a filesystem rollback only when that is what will happen", () => {
    render(<CloudreveStorageForm status={baseStatus} />)

    fireEvent.click(screen.getByRole("button", { name: "Restaurar configuración del servidor" }))
    expect(screen.getByText(/backend volverá al filesystem local/i)).toBeInTheDocument()
  })

  it("says that the connection test uses the saved configuration, not the typed one", () => {
    render(<CloudreveStorageForm status={baseStatus} />)
    expect(screen.getByText(/Prueba la configuración/i)).toHaveTextContent(/guardada/i)
  })
})
