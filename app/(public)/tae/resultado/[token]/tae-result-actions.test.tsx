// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  clearTaeAccessToken: vi.fn(),
  clearTaeAccessConfig: vi.fn(),
  countPendingTaeSubmissions: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }))
vi.mock("@/lib/pwa/tae-offline-queue", () => ({
  clearTaeAccessToken: mocks.clearTaeAccessToken,
  clearTaeAccessConfig: mocks.clearTaeAccessConfig,
  countPendingTaeSubmissions: mocks.countPendingTaeSubmissions,
}))

import { TaeResultActions } from "./tae-result-actions"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.clearTaeAccessToken.mockResolvedValue(undefined)
  mocks.clearTaeAccessConfig.mockResolvedValue(undefined)
  mocks.countPendingTaeSubmissions.mockResolvedValue(0)
})

describe("TaeResultActions", () => {
  it("starts a new, server-validated form instead of reusing the previous submission", () => {
    render(<TaeResultActions />)

    expect(screen.getByRole("link", { name: "Registrar otra carga con el acceso guardado" })).toHaveAttribute("href", "/tae")
    expect(screen.getByText(/abre un formulario nuevo/i)).toBeVisible()
  })

  it("clears the device access before finishing on a shared device", async () => {
    mocks.countPendingTaeSubmissions.mockResolvedValue(0)
    render(<TaeResultActions />)
    await waitFor(() => expect(screen.getByRole("button", { name: /finalizar en este dispositivo/i })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: /finalizar en este dispositivo/i }))

    await waitFor(() => expect(mocks.clearTaeAccessToken).toHaveBeenCalledOnce())
    expect(mocks.clearTaeAccessConfig).toHaveBeenCalledOnce()
    expect(mocks.replace).toHaveBeenCalledWith("/tae")
  })
})

/**
 * Cargas sin enviar en un dispositivo compartido (decisión de 2026-08-04).
 *
 * "Finalizar" nunca borró la cola —sólo el acceso—, así que las cargas
 * encoladas sin red sobrevivían al cambio de turno: el trabajador que las
 * registró perdía toda forma de saber si llegaron. Se elige esperar antes que
 * arriesgar el registro.
 */
describe("TaeResultActions — cargas pendientes", () => {
  it("bloquea finalizar y dice cuántas cargas retienen el dispositivo", async () => {
    mocks.countPendingTaeSubmissions.mockResolvedValue(2)
    render(<TaeResultActions />)

    await waitFor(() => expect(screen.getByRole("button", { name: /finalizar en este dispositivo/i })).toBeDisabled())
    // La cifra importa: un botón deshabilitado sin explicación es
    // indistinguible de uno roto.
    expect(screen.getByText(/2 cargas sin enviar/i)).toBeVisible()
    expect(mocks.clearTaeAccessToken).not.toHaveBeenCalled()
  })

  it("no borra el acceso si aparece una carga entre el último refresco y el clic", async () => {
    mocks.countPendingTaeSubmissions.mockResolvedValue(0)
    render(<TaeResultActions />)
    await waitFor(() => expect(screen.getByRole("button", { name: /finalizar en este dispositivo/i })).toBeEnabled())

    // La cola se llena justo antes de pulsar: por eso se vuelve a consultar
    // dentro del propio manejador y no se confía en el estado ya pintado.
    mocks.countPendingTaeSubmissions.mockResolvedValue(1)
    fireEvent.click(screen.getByRole("button", { name: /finalizar en este dispositivo/i }))

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/cargas sin enviar/i))
    expect(mocks.clearTaeAccessToken).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  // No poder leer la cola no es lo mismo que la cola esté vacía.
  it("ante un fallo al consultar la cola, se comporta como si hubiera pendientes", async () => {
    mocks.countPendingTaeSubmissions.mockRejectedValue(new Error("IndexedDB no disponible"))
    render(<TaeResultActions />)

    await waitFor(() => expect(screen.getByRole("button", { name: /finalizar en este dispositivo/i })).toBeDisabled())
  })
})
