// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  clearTaeAccessToken: vi.fn(),
  clearTaeAccessConfig: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }))
vi.mock("@/lib/pwa/tae-offline-queue", () => ({ clearTaeAccessToken: mocks.clearTaeAccessToken, clearTaeAccessConfig: mocks.clearTaeAccessConfig }))

import { TaeResultActions } from "./tae-result-actions"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.clearTaeAccessToken.mockResolvedValue(undefined)
  mocks.clearTaeAccessConfig.mockResolvedValue(undefined)
})

describe("TaeResultActions", () => {
  it("starts a new, server-validated form instead of reusing the previous submission", () => {
    render(<TaeResultActions />)

    expect(screen.getByRole("link", { name: "Registrar otra carga con el acceso guardado" })).toHaveAttribute("href", "/tae")
    expect(screen.getByText(/abre un formulario nuevo/i)).toBeVisible()
  })

  it("clears the device access before finishing on a shared device", async () => {
    render(<TaeResultActions />)
    fireEvent.click(screen.getByRole("button", { name: /finalizar en este dispositivo/i }))

    await waitFor(() => expect(mocks.clearTaeAccessToken).toHaveBeenCalledOnce())
    expect(mocks.clearTaeAccessConfig).toHaveBeenCalledOnce()
    expect(mocks.replace).toHaveBeenCalledWith("/tae")
  })
})
