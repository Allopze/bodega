// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const router = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router }))

const { useGpsLiveRefresh } = await import("./use-gps-live-refresh")

const INTERVAL = 10_000
let visibility: DocumentVisibilityState = "visible"
const fetchMock = vi.fn()

function reply(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }))
}

type Result = Record<string, unknown>
const synced = (observedAt: string): Result => ({ outcome: "synced", observedAt })
const recent = (observedAt?: string): Result => ({ outcome: "skipped", reason: "recent", ...(observedAt ? { observedAt } : {}) })

/** Respuesta del endpoint con el desenlace de cada proveedor. */
function both(onway: Result, wialon: Result) {
  return reply({ onway, wialon })
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
  fetchMock.mockImplementation(() => both(synced("2026-11-09T12:00:00.000Z"), synced("2026-11-09T12:00:00.000Z")))
  vi.stubGlobal("fetch", fetchMock)
  router.refresh.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("useGpsLiveRefresh", () => {
  it("pide una lectura al abrir la página y otra cada 10 s, y recarga los datos cuando un proveedor sincronizó", async () => {
    let n = 0
    fetchMock.mockImplementation(() => { n++; return both(recent(), synced(`2026-11-09T12:00:${String(n).padStart(2, "0")}.000Z`)) })
    renderHook(() => useGpsLiveRefresh())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith("/api/flota/monitoreo/refresco", expect.objectContaining({ method: "POST" }))
    expect(router.refresh).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(router.refresh).toHaveBeenCalledTimes(2)
  })

  it("no recarga cada 10 s si ningún proveedor trajo una captura nueva", async () => {
    fetchMock.mockImplementation(() => both(recent("2026-11-09T12:00:00.000Z"), recent("2026-11-09T12:00:05.000Z")))
    renderHook(() => useGpsLiveRefresh())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    // Primera respuesta: no hay con qué comparar y nada fue una lectura propia.
    expect(router.refresh).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(3 * INTERVAL) })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(router.refresh).not.toHaveBeenCalled()
  })

  it("recarga cuando otra persona o el cron trajeron datos, aunque la lectura propia se haya saltado", async () => {
    fetchMock.mockImplementationOnce(() => both(recent("2026-11-09T12:00:00.000Z"), recent("2026-11-09T12:00:05.000Z")))
    fetchMock.mockImplementationOnce(() => both(recent("2026-11-09T12:00:00.000Z"), recent("2026-11-09T12:00:15.000Z")))
    renderHook(() => useGpsLiveRefresh())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(router.refresh).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL) })
    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  it("con la pestaña oculta no pide nada; al volver pide al tiro si ya pasó el intervalo", async () => {
    renderHook(() => useGpsLiveRefresh())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    setVisibility("hidden")
    await act(async () => { await vi.advanceTimersByTimeAsync(6 * INTERVAL) })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => { setVisibility("visible"); await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("no apila pedidos si una lectura tarda más que el intervalo", async () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined))
    renderHook(() => useGpsLiveRefresh())
    await act(async () => { await vi.advanceTimersByTimeAsync(6 * INTERVAL) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("al salir de la página cancela la lectura en curso y deja de pedir", async () => {
    let signal: AbortSignal | undefined
    fetchMock.mockImplementation((_url: string, init: RequestInit) => { signal = init.signal ?? undefined; return new Promise(() => undefined) })
    const { unmount } = renderHook(() => useGpsLiveRefresh())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    unmount()
    expect(signal?.aborted).toBe(true)

    fetchMock.mockImplementation(() => both(synced("x"), synced("x")))
    await act(async () => { await vi.advanceTimersByTimeAsync(6 * INTERVAL) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("expone por proveedor la falla y la sincronización desactivada", async () => {
    fetchMock.mockImplementationOnce(() => both({ outcome: "failed", code: "ONWAY_PORTAL_TIMEOUT" }, recent()))
    const { result } = renderHook(() => useGpsLiveRefresh())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.status.onway).toEqual({ kind: "failed", code: "ONWAY_PORTAL_TIMEOUT" })
    expect(result.current.status.wialon).toEqual({ kind: "ok" })

    fetchMock.mockImplementationOnce(() => both(recent(), { outcome: "disabled", reason: "sync_disabled" }))
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL) })
    expect(result.current.status.onway).toEqual({ kind: "ok" })
    expect(result.current.status.wialon).toEqual({ kind: "disabled", reason: "sync_disabled" })

    fetchMock.mockImplementationOnce(() => both(recent(), recent()))
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL) })
    expect(result.current.status.wialon).toEqual({ kind: "ok" })
  })

  it("una respuesta de error HTTP se muestra como falla de ambos proveedores", async () => {
    fetchMock.mockImplementationOnce(() => reply({ outcome: "forbidden" }, 403))
    const { result } = renderHook(() => useGpsLiveRefresh())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.status.onway).toEqual({ kind: "failed", code: "HTTP_403" })
    expect(result.current.status.wialon).toEqual({ kind: "failed", code: "HTTP_403" })
    expect(router.refresh).not.toHaveBeenCalled()
  })
})
