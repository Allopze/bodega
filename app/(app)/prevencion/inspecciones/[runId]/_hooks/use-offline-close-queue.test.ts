// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearInspectionSubmissionQueue,
  getQueuedInspectionSubmission,
  queueInspectionSubmission,
  type InspectionSubmissionSendResult,
  type OfflineInspectionSubmission,
} from "../offline-inspection-queue"
import { useOfflineCloseQueue } from "./use-offline-close-queue"

const RUN_ID = "run-1"

function submission(runId: string, overrides: Partial<OfflineInspectionSubmission> = {}): OfflineInspectionSubmission {
  return { runId, expectedVersion: 3, answers: [], ...overrides }
}

function setOnline(value: boolean) {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(value)
}

function goOnline() {
  setOnline(true)
  act(() => { window.dispatchEvent(new Event("online")) })
}

const versionConflict: InspectionSubmissionSendResult = {
  ok: false,
  message: "La inspección cambió en otra sesión.",
  data: { code: "version_conflict" },
}

beforeEach(async () => {
  await clearInspectionSubmissionQueue()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("useOfflineCloseQueue", () => {
  /*
   * El patrón del reporte de incidentes: con la página abierta ya con señal el
   * evento `online` nunca dispara, y un cierre encolado en una sesión anterior
   * quedaba en IndexedDB sin enviarse.
   */
  it("vacía la cola al montar si hay conexión y avisa la entrega", async () => {
    await queueInspectionSubmission(submission(RUN_ID, { expectedVersion: 7 }))
    const send = vi.fn(async () => ({ ok: true, data: { version: 8 } }))
    const onDelivered = vi.fn()

    const { result } = renderHook(() => useOfflineCloseQueue({ runId: RUN_ID, send, onDelivered }))

    await waitFor(() => expect(onDelivered).toHaveBeenCalledTimes(1))
    expect(onDelivered).toHaveBeenCalledWith({ ok: true, data: { version: 8 } })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ runId: RUN_ID, expectedVersion: 7 }))
    expect(result.current.entry).toBeNull()
    expect(await getQueuedInspectionSubmission(RUN_ID)).toBeNull()
    await waitFor(() => expect(result.current.sending).toBe(false))
  })

  it("sin conexión muestra el cierre pendiente y no envía ni gasta reintentos", async () => {
    setOnline(false)
    await queueInspectionSubmission(submission(RUN_ID))
    const send = vi.fn(async () => ({ ok: true }))

    const { result } = renderHook(() => useOfflineCloseQueue({ runId: RUN_ID, send }))

    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.entry).toMatchObject({ attempts: 0, rejected: false })
    expect(result.current.entry?.payload.runId).toBe(RUN_ID)
    expect(send).not.toHaveBeenCalled()

    // «Enviar ahora» sin señal tampoco intenta nada.
    await act(async () => { await result.current.sendNow() })
    expect(send).not.toHaveBeenCalled()
    expect((await getQueuedInspectionSubmission(RUN_ID))?.attempts).toBe(0)
  })

  it("al volver la señal envía solo", async () => {
    setOnline(false)
    await queueInspectionSubmission(submission(RUN_ID))
    const send = vi.fn(async () => ({ ok: true }))
    const onDelivered = vi.fn()
    const { result } = renderHook(() => useOfflineCloseQueue({ runId: RUN_ID, send, onDelivered }))
    await waitFor(() => expect(result.current.entry).not.toBeNull())

    goOnline()

    await waitFor(() => expect(onDelivered).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledTimes(1)
    expect(result.current.entry).toBeNull()
  })

  it("un rechazo con código deja la entrada rechazada, con su motivo, y no se reenvía", async () => {
    await queueInspectionSubmission(submission(RUN_ID))
    const send = vi.fn(async () => versionConflict)
    const onDelivered = vi.fn()

    const { result } = renderHook(() => useOfflineCloseQueue({ runId: RUN_ID, send, onDelivered }))

    await waitFor(() => expect(result.current.entry?.rejected).toBe(true))
    expect(result.current.entry).toMatchObject({ lastError: versionConflict.message, lastCode: "version_conflict" })
    expect(onDelivered).not.toHaveBeenCalled()

    await act(async () => { await result.current.sendNow() })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("un fallo sin código deja el cierre pendiente y «Enviar ahora» lo reintenta", async () => {
    await queueInspectionSubmission(submission(RUN_ID))
    const send = vi.fn()
      .mockResolvedValueOnce({ ok: false, message: "Error del servidor" })
      .mockResolvedValueOnce({ ok: true })
    const onDelivered = vi.fn()
    const { result } = renderHook(() => useOfflineCloseQueue({ runId: RUN_ID, send, onDelivered }))
    await waitFor(() => expect(result.current.entry?.attempts).toBe(1))
    expect(result.current.entry?.rejected).toBe(false)

    await act(async () => { await result.current.sendNow() })

    expect(send).toHaveBeenCalledTimes(2)
    expect(onDelivered).toHaveBeenCalledTimes(1)
    expect(result.current.entry).toBeNull()
  })

  it("una excepción del envío no rompe la pantalla: cuenta como fallo de red", async () => {
    await queueInspectionSubmission(submission(RUN_ID))
    const send = vi.fn(async () => { throw new TypeError("Failed to fetch") })

    const { result } = renderHook(() => useOfflineCloseQueue({ runId: RUN_ID, send }))

    await waitFor(() => expect(result.current.entry?.attempts).toBe(1))
    expect(result.current.entry).toMatchObject({ rejected: false, lastError: "Sin conexión con el servidor" })
  })

  it("los disparadores simultáneos comparten un solo envío", async () => {
    await queueInspectionSubmission(submission(RUN_ID))
    const send = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { ok: true }
    })
    const { result } = renderHook(() => useOfflineCloseQueue({ runId: RUN_ID, send }))

    // El envío del montaje sigue en vuelo.
    await act(async () => { await Promise.all([result.current.sendNow(), result.current.sendNow()]) })

    expect(send).toHaveBeenCalledTimes(1)
    expect(result.current.entry).toBeNull()
  })

  it("`queue` guarda el cierre bajo la inspección del hook y lo deja visible", async () => {
    setOnline(false)
    const send = vi.fn(async () => ({ ok: true }))
    const { result } = renderHook(() => useOfflineCloseQueue({ runId: RUN_ID, send }))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.entry).toBeNull()

    let outcome: Awaited<ReturnType<typeof result.current.queue>> | undefined
    await act(async () => {
      outcome = await result.current.queue({ runId: "otra-inspeccion", expectedVersion: 4, answers: [] })
    })

    expect(outcome).toMatchObject({ ok: true })
    expect(result.current.entry).toMatchObject({ rejected: false, attempts: 0 })
    expect(result.current.entry?.payload).toMatchObject({ runId: RUN_ID, expectedVersion: 4 })
    expect(await getQueuedInspectionSubmission("otra-inspeccion")).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })

  it("`queue` devuelve el aviso de cola llena en vez de lanzar", async () => {
    setOnline(false)
    for (let index = 1; index <= 5; index++) await queueInspectionSubmission(submission(`otra-${index}`))
    const { result } = renderHook(() => useOfflineCloseQueue({ runId: RUN_ID, send: vi.fn() }))
    await waitFor(() => expect(result.current.loaded).toBe(true))

    let outcome: Awaited<ReturnType<typeof result.current.queue>> | undefined
    await act(async () => {
      outcome = await result.current.queue({ expectedVersion: 4, answers: [] })
    })

    expect(outcome).toMatchObject({ ok: false, message: expect.stringMatching(/llena/i) })
    expect(result.current.entry).toBeNull()
  })

  it("`discard` borra el cierre guardado sin enviarlo", async () => {
    setOnline(false)
    await queueInspectionSubmission(submission(RUN_ID))
    const send = vi.fn(async () => ({ ok: true }))
    const { result } = renderHook(() => useOfflineCloseQueue({ runId: RUN_ID, send }))
    await waitFor(() => expect(result.current.entry).not.toBeNull())

    let discarded: boolean | undefined
    await act(async () => { discarded = await result.current.discard() })

    expect(discarded).toBe(true)
    expect(result.current.entry).toBeNull()
    expect(await getQueuedInspectionSubmission(RUN_ID)).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })

  it("envía también lo de otras inspecciones, pero sólo muestra y avisa lo propio", async () => {
    await queueInspectionSubmission(submission("otra-inspeccion"))
    const send = vi.fn(async () => ({ ok: true }))
    const onDelivered = vi.fn()

    const { result } = renderHook(() => useOfflineCloseQueue({ runId: RUN_ID, send, onDelivered }))

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ runId: "otra-inspeccion" }))
    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(onDelivered).not.toHaveBeenCalled()
    expect(result.current.entry).toBeNull()
  })

  it("apagado no lee la cola ni envía", async () => {
    await queueInspectionSubmission(submission(RUN_ID))
    const send = vi.fn(async () => ({ ok: true }))

    const { result } = renderHook(() => useOfflineCloseQueue({ runId: RUN_ID, enabled: false, send }))

    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => { await result.current.sendNow() })
    expect(result.current.entry).toBeNull()
    expect(send).not.toHaveBeenCalled()
    expect(await getQueuedInspectionSubmission(RUN_ID)).not.toBeNull()
  })
})
