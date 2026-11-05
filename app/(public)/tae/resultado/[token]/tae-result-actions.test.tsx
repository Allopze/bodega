// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  clearTaeAccessToken: vi.fn(),
  clearTaeAccessConfig: vi.fn(),
  countTaeQueue: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }))
vi.mock("@/lib/pwa/tae-offline-queue", () => ({
  clearTaeAccessToken: mocks.clearTaeAccessToken,
  clearTaeAccessConfig: mocks.clearTaeAccessConfig,
  countTaeQueue: mocks.countTaeQueue,
}))

import { TaeResultActions } from "./tae-result-actions"

const vacia = { total: 0, pending: 0, syncing: 0, failed: 0 }
const soloPendientes = (total: number) => ({ total, pending: total, syncing: 0, failed: 0 })

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.clearTaeAccessToken.mockResolvedValue(undefined)
  mocks.clearTaeAccessConfig.mockResolvedValue(undefined)
  mocks.countTaeQueue.mockResolvedValue(vacia)
})

describe("TaeResultActions", () => {
  it("starts a new, server-validated form instead of reusing the previous submission", () => {
    render(<TaeResultActions />)

    expect(screen.getByRole("link", { name: "Registrar otra carga con el acceso guardado" })).toHaveAttribute("href", "/tae")
    expect(screen.getByText(/abre un formulario nuevo/i)).toBeVisible()
  })

  it("clears the device access before finishing on a shared device", async () => {
    mocks.countTaeQueue.mockResolvedValue(vacia)
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
    mocks.countTaeQueue.mockResolvedValue(soloPendientes(2))
    render(<TaeResultActions />)

    await waitFor(() => expect(screen.getByRole("button", { name: /finalizar en este dispositivo/i })).toBeDisabled())
    // La cifra importa: un botón deshabilitado sin explicación es
    // indistinguible de uno roto.
    expect(screen.getByText(/2 cargas sin enviar/i)).toBeVisible()
    expect(mocks.clearTaeAccessToken).not.toHaveBeenCalled()
  })

  /*
   * Auditoría 2026-11-05 (5.3): una carga rechazada sigue en IndexedDB, no se
   * sincroniza sola y su única salida es el formulario que abre el acceso
   * guardado. Si el contador no la ve, «Finalizar» se habilita y borra el
   * acceso: la carga y sus fotos quedan sin pantalla que las muestre.
   */
  it("una carga rechazada también bloquea y no borra el acceso", async () => {
    mocks.countTaeQueue.mockResolvedValue({ total: 1, pending: 0, syncing: 0, failed: 1 })
    render(<TaeResultActions />)

    await waitFor(() => expect(screen.getByRole("button", { name: /finalizar en este dispositivo/i })).toBeDisabled())
    expect(screen.getByRole("status")).toHaveTextContent(/1 carga rechazada/i)
    expect(screen.getByRole("status")).toHaveTextContent(/corrígela/i)
    expect(mocks.clearTaeAccessToken).not.toHaveBeenCalled()
    expect(mocks.clearTaeAccessConfig).not.toHaveBeenCalled()
  })

  it("no borra el acceso si aparece una carga entre el último refresco y el clic", async () => {
    mocks.countTaeQueue.mockResolvedValue(vacia)
    render(<TaeResultActions />)
    await waitFor(() => expect(screen.getByRole("button", { name: /finalizar en este dispositivo/i })).toBeEnabled())

    // La cola se llena justo antes de pulsar: por eso se vuelve a consultar
    // dentro del propio manejador y no se confía en el estado ya pintado.
    mocks.countTaeQueue.mockResolvedValue(soloPendientes(1))
    fireEvent.click(screen.getByRole("button", { name: /finalizar en este dispositivo/i }))

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/cargas sin enviar/i))
    expect(mocks.clearTaeAccessToken).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it("si la carga que aparece en el clic está rechazada, lo dice y no borra nada", async () => {
    mocks.countTaeQueue.mockResolvedValue(vacia)
    render(<TaeResultActions />)
    await waitFor(() => expect(screen.getByRole("button", { name: /finalizar en este dispositivo/i })).toBeEnabled())

    mocks.countTaeQueue.mockResolvedValue({ total: 1, pending: 0, syncing: 0, failed: 1 })
    fireEvent.click(screen.getByRole("button", { name: /finalizar en este dispositivo/i }))

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/rechazadas/i))
    expect(mocks.clearTaeAccessToken).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  // No poder leer la cola no es lo mismo que la cola esté vacía.
  it("ante un fallo al consultar la cola, se comporta como si hubiera pendientes", async () => {
    mocks.countTaeQueue.mockRejectedValue(new Error("IndexedDB no disponible"))
    render(<TaeResultActions />)

    await waitFor(() => expect(screen.getByRole("button", { name: /finalizar en este dispositivo/i })).toBeDisabled())
  })
})
