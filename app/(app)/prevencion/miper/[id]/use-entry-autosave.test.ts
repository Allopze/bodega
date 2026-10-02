// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

const saveMiperEntryAction = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({ saveMiperEntryAction }))

import { useEntryAutosave } from "./use-entry-autosave"

const entry = { id: "e1", rowNumber: 1, probability: 2, consequence: 2, magnitude: 4, classification: "moderate", riskFactorId: null, riskFactor: null } as MiperEntrySnapshot

type Props = { serverRows: MiperEntrySnapshot[]; entryVersions: Record<string, number> }

function setup(initial: MiperEntrySnapshot[] = [entry], entryVersions: Record<string, number> = { e1: 1 }) {
  let rows: MiperEntrySnapshot[] = initial
  const setRows = (updater: (current: MiperEntrySnapshot[]) => MiperEntrySnapshot[]) => { rows = updater(rows) }
  const hook = renderHook(({ serverRows, entryVersions: versions }: Props) => useEntryAutosave({ matrixId: "m1", entryVersions: versions, serverRows, setRows, riskFactors: [] }), { initialProps: { serverRows: initial, entryVersions } })
  return { hook, rows: () => rows }
}

describe("useEntryAutosave", () => {
  beforeEach(() => saveMiperEntryAction.mockReset())

  it("guarda de forma optimista y queda en «guardado» con la versión nueva", async () => {
    saveMiperEntryAction.mockResolvedValueOnce({ ok: true, data: { version: 2, magnitude: 8, classification: "important" } })
    const { hook, rows } = setup()
    let ok = false
    await act(async () => { ok = await hook.result.current.commit(entry, { probability: 4 }) })
    expect(ok).toBe(true)
    expect(rows()[0]).toMatchObject({ probability: 4, classification: "important" })
    expect(hook.result.current.statusOf("e1").state).toBe("saved")
    expect(hook.result.current.versionOf("e1")).toBe(2)
  })

  it("si el servidor rechaza, revierte el campo y deja el mensaje en ese campo", async () => {
    saveMiperEntryAction.mockResolvedValueOnce({ ok: false, message: "La fila cambió mientras la editabas. Recarga la matriz." })
    const { hook, rows } = setup()
    await act(async () => { await hook.result.current.commit(entry, { probability: 4 }) })
    expect(rows()[0]).toMatchObject({ probability: 2, classification: "moderate" })
    expect(hook.result.current.fieldError("e1", "probability")).toMatch(/cambió mientras la editabas/)
    expect(hook.result.current.statusOf("e1")).toMatchObject({ state: "error" })
  })

  it("dos guardados superpuestos que fallan dejan el último valor guardado", async () => {
    saveMiperEntryAction.mockResolvedValue({ ok: false, message: "rechazado" })
    const { hook, rows } = setup()
    await act(async () => {
      const a = hook.result.current.commit(entry, { probability: 4 })
      const b = hook.result.current.commit({ ...entry, probability: 4, magnitude: 8, classification: "important" }, { probability: 1 })
      await Promise.all([a, b])
    })
    expect(rows()[0]).toMatchObject({ probability: 2 })
    expect(hook.result.current.statusOf("e1").state).toBe("error")
  })

  it("si A falla y B guarda, queda el valor de B y ningún error en ese campo", async () => {
    saveMiperEntryAction
      .mockResolvedValueOnce({ ok: false, message: "rechazado" })
      .mockResolvedValueOnce({ ok: true, data: { version: 2, magnitude: 4, classification: "moderate" } })
    const { hook, rows } = setup()
    await act(async () => {
      const a = hook.result.current.commit(entry, { probability: 4 })
      const b = hook.result.current.commit({ ...entry, probability: 4 }, { probability: 1 })
      await Promise.all([a, b])
    })
    expect(rows()[0]).toMatchObject({ probability: 1 })
    expect(hook.result.current.fieldError("e1", "probability")).toBeUndefined()
    expect(hook.result.current.statusOf("e1").state).toBe("saved")
  })

  it("sigue en error mientras otro campo conserve su error", async () => {
    saveMiperEntryAction
      .mockResolvedValueOnce({ ok: false, message: "rechazado" })
      .mockResolvedValueOnce({ ok: true, data: { version: 2, magnitude: 4, classification: "moderate" } })
    const { hook } = setup()
    await act(async () => { await hook.result.current.commit(entry, { probability: 4 }) })
    await act(async () => { await hook.result.current.commit(entry, { consequence: 4 }) })
    expect(hook.result.current.fieldError("e1", "probability")).toBe("rechazado")
    expect(hook.result.current.statusOf("e1").state).toBe("error")
  })

  it("«Recargar riesgo» descarta el conflicto: el campo pierde el mensaje y el guardado siguiente anuncia «guardado»", async () => {
    saveMiperEntryAction
      .mockResolvedValueOnce({ ok: false, message: "La fila cambió mientras la editabas. Recarga la matriz." })
      .mockResolvedValueOnce({ ok: true, data: { version: 3, magnitude: 4, classification: "moderate" } })
    const { hook } = setup()
    await act(async () => { await hook.result.current.commit(entry, { probability: 4 }) })
    expect(hook.result.current.statusOf("e1").state).toBe("error")
    act(() => { hook.result.current.clearErrors("e1") })
    expect(hook.result.current.fieldError("e1", "probability")).toBeUndefined()
    expect(hook.result.current.statusOf("e1").state).toBe("idle")
    await act(async () => { await hook.result.current.commit(entry, { consequence: 4 }) })
    expect(hook.result.current.statusOf("e1").state).toBe("saved")
  })

  it("tras un refresh del servidor, revierte al valor del servidor y no al guardado antes", async () => {
    saveMiperEntryAction
      .mockResolvedValueOnce({ ok: true, data: { version: 2, magnitude: 6, classification: "moderate" } })
      .mockResolvedValueOnce({ ok: false, message: "rechazado" })
    const { hook, rows } = setup()
    await act(async () => { await hook.result.current.commit(entry, { probability: 4 }) })
    // Otra persona lo cambió después (v3): la foto nueva es más nueva que lo que el cliente guardó (v2).
    hook.rerender({ serverRows: [{ ...entry, probability: 1, magnitude: 2, classification: "tolerable" } as MiperEntrySnapshot], entryVersions: { e1: 3 } })
    await act(async () => { await hook.result.current.commit({ ...entry, probability: 1 }, { probability: 2 }) })
    expect(rows()[0]).toMatchObject({ probability: 1 })
  })

  it("el estado es por riesgo: si A falla y después B guarda, B dice «guardado» y A sigue en error", async () => {
    const b = { ...entry, id: "e2", rowNumber: 2 } as MiperEntrySnapshot
    saveMiperEntryAction
      .mockResolvedValueOnce({ ok: false, message: "rechazado en A" })
      .mockResolvedValueOnce({ ok: true, data: { version: 2, magnitude: 4, classification: "moderate" } })
    const { hook } = setup([entry, b], { e1: 1, e2: 1 })
    await act(async () => { await hook.result.current.commit(entry, { probability: 4 }) })
    await act(async () => { await hook.result.current.commit(b, { consequence: 1 }) })
    expect(hook.result.current.statusOf("e2")).toMatchObject({ state: "saved", message: null })
    expect(hook.result.current.statusOf("e1")).toMatchObject({ state: "error", message: "rechazado en A" })
    // Un riesgo que nadie tocó no hereda nada de los otros.
    expect(hook.result.current.statusOf("e9")).toEqual({ state: "idle", savedAt: null, message: null })
  })

  it("mientras B guarda, sólo B está «guardando»", async () => {
    const b = { ...entry, id: "e2", rowNumber: 2 } as MiperEntrySnapshot
    let resolve!: (value: unknown) => void
    saveMiperEntryAction.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const { hook } = setup([entry, b], { e1: 1, e2: 1 })
    let pending!: Promise<boolean>
    act(() => { pending = hook.result.current.commit(b, { probability: 1 }) })
    await waitFor(() => expect(hook.result.current.statusOf("e2").state).toBe("saving"))
    expect(hook.result.current.statusOf("e1").state).toBe("idle")
    await act(async () => { resolve({ ok: true, data: { version: 2, magnitude: 2, classification: "tolerable" } }); await pending })
    expect(hook.result.current.statusOf("e2").state).toBe("saved")
  })

  it("una foto nueva en la que el riesgo cambió descarta sus rechazos; los de un riesgo que no cambió quedan", async () => {
    const b = { ...entry, id: "e2", rowNumber: 2 } as MiperEntrySnapshot
    saveMiperEntryAction.mockResolvedValue({ ok: false, message: "rechazado" })
    const { hook } = setup([entry, b], { e1: 1, e2: 1 })
    await act(async () => { await hook.result.current.commit(entry, { probability: 4 }) })
    await act(async () => { await hook.result.current.commit(b, { probability: 4 }) })
    expect(hook.result.current.fieldError("e1", "probability")).toBe("rechazado")
    expect(hook.result.current.fieldError("e2", "probability")).toBe("rechazado")

    // Refresh por otro motivo (p. ej. una medida nueva en e1): e1 llega distinto, e2 igual.
    const e1Changed = { ...entry, controls: [{ id: "c1" }] } as unknown as MiperEntrySnapshot
    hook.rerender({ serverRows: [e1Changed, { ...b }], entryVersions: { e1: 1, e2: 1 } })
    expect(hook.result.current.fieldError("e1", "probability")).toBeUndefined()
    expect(hook.result.current.statusOf("e1").state).toBe("idle")
    expect(hook.result.current.fieldError("e2", "probability")).toBe("rechazado")
    expect(hook.result.current.statusOf("e2").state).toBe("error")
  })

  it("una foto atrasada no reancla el último valor guardado: un rechazo posterior vuelve a lo que el cliente guardó", async () => {
    saveMiperEntryAction
      .mockResolvedValueOnce({ ok: true, data: { version: 2, magnitude: 8, classification: "important" } })
      .mockResolvedValueOnce({ ok: false, message: "rechazado" })
    const { hook, rows } = setup()
    await act(async () => { await hook.result.current.commit(entry, { probability: 4 }) })
    // La foto de «atrás»: la v1, de antes del guardado.
    hook.rerender({ serverRows: [{ ...entry }], entryVersions: { e1: 1 } })
    await act(async () => { await hook.result.current.commit({ ...entry, probability: 4 }, { probability: 1 }) })
    expect(rows()[0]).toMatchObject({ probability: 4 })
  })
})
