// @vitest-environment jsdom
import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const saveMiperEntryAction = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({ saveMiperEntryAction }))

import { useRowSaver } from "./use-row-saver"

describe("useRowSaver", () => {
  beforeEach(() => {
    saveMiperEntryAction.mockReset()
  })

  it("serializa los guardados de una fila y usa la versión devuelta por el anterior", async () => {
    let release!: () => void
    saveMiperEntryAction
      .mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ ok: true, data: { version: 2, magnitude: null, classification: null } }) }))
      .mockResolvedValueOnce({ ok: true, data: { version: 3, magnitude: 8, classification: "important" } })
    const { result } = renderHook(() => useRowSaver("m1", { e1: 1 }))
    const first = result.current.save("e1", { hazard: "A" })
    const second = result.current.save("e1", { probability: 2 })
    // `save` encadena microtareas antes de llamar a la acción: la segunda
    // edición no puede dispararse mientras la primera sigue en vuelo.
    await vi.waitFor(() => expect(saveMiperEntryAction).toHaveBeenCalledTimes(1))
    expect(saveMiperEntryAction.mock.calls[0]?.[0]).toMatchObject({ entryId: "e1", expectedVersion: 1 })
    release()
    await first
    await expect(second).resolves.toEqual({ ok: true, version: 3, magnitude: 8, classification: "important" })
    expect(saveMiperEntryAction.mock.calls.map(([input]) => input.expectedVersion)).toEqual([1, 2])
  })

  it("devuelve el motivo del rechazo sin romper la cola", async () => {
    saveMiperEntryAction.mockResolvedValueOnce({ ok: false, message: "La fila cambió mientras la editabas." }).mockResolvedValueOnce({ ok: true, data: { version: 2, magnitude: null, classification: null } })
    const { result } = renderHook(() => useRowSaver("m1", { e9: 1 }))
    await expect(result.current.save("e9", { hazard: "x" })).resolves.toEqual({ ok: false, message: "La fila cambió mientras la editabas." })
    await expect(result.current.save("e9", { hazard: "y" })).resolves.toMatchObject({ ok: true })
    // El rechazo no movió la versión conocida: la fila reintenta con la misma.
    expect(saveMiperEntryAction.mock.calls.map(([input]) => input.expectedVersion)).toEqual([1, 1])
  })

  it("guarda filas distintas en paralelo", async () => {
    const pending: Array<() => void> = []
    saveMiperEntryAction.mockImplementation((input: { entryId: string }) => new Promise((resolve) => {
      pending.push(() => resolve({ ok: true, data: { version: 2, magnitude: null, classification: null, id: input.entryId } }))
    }))
    const { result } = renderHook(() => useRowSaver("m1", { e1: 1, e2: 1 }))
    const first = result.current.save("e1", { hazard: "A" })
    const second = result.current.save("e2", { hazard: "B" })
    await vi.waitFor(() => expect(saveMiperEntryAction).toHaveBeenCalledTimes(2))
    pending.forEach((resolve) => resolve())
    await expect(Promise.all([first, second])).resolves.toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })])
  })

  it("sync nunca baja una versión pero acepta una más nueva", async () => {
    saveMiperEntryAction.mockResolvedValue({ ok: true, data: { version: 3, magnitude: null, classification: null } })
    const { result } = renderHook(() => useRowSaver("m1", { a: 2, b: 1 }))
    result.current.sync({ a: 1, b: 5 })
    await result.current.save("a", { hazard: "x" })
    await result.current.save("b", { hazard: "y" })
    expect(saveMiperEntryAction.mock.calls.map(([input]) => input.expectedVersion)).toEqual([2, 5])
  })

  it("whenIdle espera los guardados en curso de esas filas, también el que entra mientras espera (Fase D)", async () => {
    const releases: Array<() => void> = []
    saveMiperEntryAction.mockImplementation(() => new Promise((resolve) => {
      const version = releases.length + 2
      releases.push(() => resolve({ ok: true, data: { version, magnitude: null, classification: null } }))
    }))
    const { result } = renderHook(() => useRowSaver("m1", { e1: 1, e2: 1 }))
    // Sin guardados en curso no espera nada.
    await expect(result.current.whenIdle(["e1", "e2"])).resolves.toBeUndefined()
    void result.current.save("e1", { hazard: "A" })
    let idle = false
    const waiting = result.current.whenIdle(["e1", "e2"]).then(() => { idle = true })
    // Un segundo guardado de la misma fila entra a la cola mientras se espera.
    void result.current.save("e1", { risk: "B" })
    await vi.waitFor(() => expect(saveMiperEntryAction).toHaveBeenCalledTimes(1))
    releases[0]!()
    await vi.waitFor(() => expect(saveMiperEntryAction).toHaveBeenCalledTimes(2))
    expect(idle).toBe(false)
    releases[1]!()
    await waiting
    expect(result.current.versionOf("e1")).toBe(3)
  })
})
