// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { act, renderHook, waitFor } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { account, freshDb, UUID } from "@/lib/mantencion/client/__tests__/fixtures"
import { STORE, idbPut } from "@/lib/mantencion/client/db"
import { emit } from "@/lib/mantencion/client/events"
import { resetHistoryStatusForTests } from "@/lib/mantencion/client/history-sync"
import { reportReachable } from "@/lib/mantencion/client/signal"
import type { AppData } from "../app-context"
import { AppDataProvider } from "../app-context"
import { useFleetHistory, useHistoryPhoto } from "../use-history"

const data = (userId: string) => ({ account: account(userId) }) as unknown as AppData
function wrapper(userId: string) {
  return function Wrapper({ children }: { children: ReactNode }) { return createElement(AppDataProvider, { value: data(userId) }, children) }
}
const stored = (userId: string, fetchedAt: string) => ({ userId, etag: '"h1"', fetchedAt, data: { version: "h1", generatedAt: fetchedAt, byVehicle: { "veh-1": [] } } })

beforeEach(async () => { await freshDb(); resetHistoryStatusForTests() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("useFleetHistory", () => {
  it("lee la copia guardada de la cuenta activa y se actualiza cuando el refresco avisa", async () => {
    const { result } = renderHook(() => useFleetHistory(), { wrapper: wrapper("u-1") })
    expect(result.current).toEqual({ byVehicle: null, updatedAt: null, refreshing: false, failed: false })
    await act(async () => {
      await idbPut(STORE.history, stored("u-1", "2026-11-02T12:00:00.000Z"))
      emit("history")
    })
    await waitFor(() => expect(result.current.updatedAt).toBe("2026-11-02T12:00:00.000Z"))
    expect(result.current.byVehicle).toEqual({ "veh-1": [] })
  })

  it("no mezcla el historial de otra cuenta", async () => {
    await idbPut(STORE.history, stored("u-2", "2026-11-02T12:00:00.000Z"))
    const { result } = renderHook(() => useFleetHistory(), { wrapper: wrapper("u-3") })
    await act(async () => { emit("history") })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(result.current.byVehicle).toBeNull()
  })
})

describe("useHistoryPhoto", () => {
  it("baja la foto, entrega un object URL y lo revoca al salir", async () => {
    const create = vi.fn(() => "blob:foto")
    const revoke = vi.fn()
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["jpeg"], { type: "image/jpeg" }), { status: 200 })))
    const { result, unmount } = renderHook(() => useHistoryPhoto(UUID(50)), { wrapper: wrapper("u-1") })
    expect(result.current).toEqual({ status: "loading" })
    await waitFor(() => expect(result.current).toEqual({ status: "ready", url: "blob:foto" }))
    unmount()
    expect(revoke).toHaveBeenCalledWith("blob:foto")
  })

  it("sin señal y sin copia queda «offline»; con señal y un fallo, «error»", async () => {
    reportReachable(false)
    const offline = renderHook(() => useHistoryPhoto(UUID(51)), { wrapper: wrapper("u-1") })
    await waitFor(() => expect(offline.result.current).toEqual({ status: "offline" }))
    reportReachable(true)
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })))
    const failed = renderHook(() => useHistoryPhoto(UUID(52)), { wrapper: wrapper("u-1") })
    await waitFor(() => expect(failed.result.current).toEqual({ status: "error" }))
  })
})
