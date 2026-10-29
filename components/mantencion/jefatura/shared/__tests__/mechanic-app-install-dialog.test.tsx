// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MechanicAppInstallDialog } from "../mechanic-app-install-dialog"

const toDataURL = vi.fn().mockResolvedValue("data:image/png;base64,qr")

vi.mock("qrcode", () => ({ default: { toDataURL } }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

describe("MechanicAppInstallDialog", () => {
  it("muestra el QR y el enlace de la app con los pasos para instalarla, sin selector", async () => {
    render(<MechanicAppInstallDialog />)
    fireEvent.click(screen.getByRole("button", { name: "Instalar app del mecánico" }))

    const url = `${window.location.origin}/m/mantencion`
    await waitFor(() => expect(toDataURL).toHaveBeenCalledWith(url, { width: 320, margin: 2 }))
    expect(screen.getByText(url)).toBeInTheDocument()
    expect(screen.getByAltText("Código QR para abrir la app de mantención en el teléfono")).toBeInTheDocument()
    expect(screen.getByText(/Agregar a inicio/)).toBeInTheDocument()
    expect(screen.getByText(/Agregar a la pantalla principal/)).toBeInTheDocument()
    // Con una sola opción el selector no decide nada y no se muestra.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
  })
})
