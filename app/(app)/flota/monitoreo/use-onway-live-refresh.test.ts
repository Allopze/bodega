// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const router = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router }))

const { useOnwayLiveRefresh } = await import("./use-onway-live-refresh")

const MINUTE = 60_000
let visibility: DocumentVisibilityState = "visible"
const fetchMock = vi.fn()

function reply(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }))
}

function setVisibility(next: DocumentVisibilityState) {
  visibility = next
  document.dispatchEvent(new Event("visibilitychange"))
}

beforeEach(() => {
  vi.useFakeTimers()
  visibility = "visible"
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility })
  fetchMock.mockReset()
  fetchMock.mockImplementation(() => reply({ outcome: "synced", observedAt: "2026-11-09T12:00:00.000Z" }))
  vi.stubGlobal("fetch", fetchMock)
  router.refresh.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("useOnwayLiveRefresh", () => {
  it("pide una lectura al abrir la página y otra cada minuto, y recarga los datos tras cada una", async () => {
    renderHook(() => useOnwayLiveRefresh())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith("/api/flota/monitoreo/refresco", expect.objectContaining({ method: "POST" }))
    expect(router.refresh).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(MINUTE) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(router.refresh).toHaveBeenCalledTimes(2)
  })

  it("con la pestaña oculta no pide nada; al volver pide al tiro si ya pasó el minuto", async () => {
    renderHook(() => useOnwayLiveRefresh())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    setVisibility("hidden")
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * MINUTE) })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => { setVisibility("visible"); await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("no apila pedidos si una lectura tarda más de un minuto", async () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined))
    renderHook(() => useOnwayLiveRefresh())
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * MINUTE) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("al salir de la página cancela la lectura en curso y deja de pedir", async () => {
    let signal: AbortSignal | undefined
    fetchMock.mockImplementation((_url: string, init: RequestInit) => { signal = init.signal ?? undefined; return new Promise(() => undefined) })
    const { unmount } = renderHook(() => useOnwayLiveRefresh())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    unmount()
    expect(signal?.aborted).toBe(true)

    fetchMock.mockImplementation(() => reply({ outcome: "synced", observedAt: "x" }))
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * MINUTE) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("expone la falla del portal y la sincronización desactivada", async () => {
    fetchMock.mockImplementationOnce(() => reply({ outcome: "failed", code: "ONWAY_PORTAL_TIMEOUT" }))
    const { result } = renderHook(() => useOnwayLiveRefresh())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.status).toEqual({ kind: "failed", code: "ONWAY_PORTAL_TIMEOUT" })

    fetchMock.mockImplementationOnce(() => reply({ outcome: "disabled", reason: "sync_disabled" }))
    await act(async () => { await vi.advanceTimersByTimeAsync(MINUTE) })
    expect(result.current.status).toEqual({ kind: "disabled" })

    await act(async () => { await vi.advanceTimersByTimeAsync(MINUTE) })
    expect(result.current.status).toEqual({ kind: "ok" })
  })
})
