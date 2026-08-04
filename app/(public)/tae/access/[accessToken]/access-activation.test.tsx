// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  saveTaeAccessToken: vi.fn(),
  saveTaeAccessConfig: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }))
vi.mock("@/lib/pwa/tae-offline-queue", () => ({ saveTaeAccessToken: mocks.saveTaeAccessToken, saveTaeAccessConfig: mocks.saveTaeAccessConfig }))

import { TaeAccessActivation } from "./access-activation"

const accessConfig = { worksite: { id: "ws-1", name: "Faena Norte" } }

function mockAccess(status: number, body: unknown = { ok: false }) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  mocks.saveTaeAccessToken.mockResolvedValue(undefined)
  mocks.saveTaeAccessConfig.mockResolvedValue(undefined)
})

describe("TaeAccessActivation", () => {
  it("explains an expired access, focuses recovery, and retries without a manual reload", async () => {
    mockAccess(404)
    render(<TaeAccessActivation accessToken="expired-qr" />)

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Este enlace TAE ya no está disponible")
    expect(alert).toHaveTextContent("TAE-ACCESS-404")
    const retry = screen.getByRole("button", { name: "Reintentar" })
    await waitFor(() => expect(retry).toHaveFocus())

    mockAccess(200, { ok: true, data: accessConfig })
    fireEvent.click(retry)

    await waitFor(() => expect(mocks.saveTaeAccessToken).toHaveBeenCalledWith("expired-qr"))
    expect(mocks.saveTaeAccessConfig).toHaveBeenCalledWith(accessConfig)
    expect(mocks.replace).toHaveBeenCalledWith("/tae")
  })

  it("separates local-storage failure from an unavailable QR", async () => {
    mockAccess(200, { ok: true, data: accessConfig })
    mocks.saveTaeAccessToken.mockRejectedValueOnce(new DOMException("blocked", "SecurityError"))
    render(<TaeAccessActivation accessToken="storage-qr" />)

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Este navegador no pudo guardar el acceso")
    expect(alert).toHaveTextContent("TAE-ACCESS-STORAGE")
    expect(alert).toHaveTextContent("Habilita el almacenamiento")
  })
})
