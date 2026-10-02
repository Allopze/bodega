// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

const saveMiperEntryAction = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({ saveMiperEntryAction }))

import { useEntryAutosave } from "./use-entry-autosave"

const entry = { id: "e1", rowNumber: 1, probability: 2, consequence: 2, magnitude: 4, classification: "moderate", riskFactorId: null, riskFactor: null } as MiperEntrySnapshot

function setup() {
  let rows: MiperEntrySnapshot[] = [entry]
  const setRows = (updater: (current: MiperEntrySnapshot[]) => MiperEntrySnapshot[]) => { rows = updater(rows) }
  const initial = [entry]
  const hook = renderHook(({ serverRows }: { serverRows: MiperEntrySnapshot[] }) => useEntryAutosave({ matrixId: "m1", entryVersions: { e1: 1 }, serverRows, setRows, riskFactors: [] }), { initialProps: { serverRows: initial } })
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
    expect(hook.result.current.status.state).toBe("saved")
    expect(hook.result.current.versionOf("e1")).toBe(2)
  })

  it("si el servidor rechaza, revierte el campo y deja el mensaje en ese campo", async () => {
    saveMiperEntryAction.mockResolvedValueOnce({ ok: false, message: "La fila cambió mientras la editabas. Recarga la matriz." })
    const { hook, rows } = setup()
    await act(async () => { await hook.result.current.commit(entry, { probability: 4 }) })
    expect(rows()[0]).toMatchObject({ probability: 2, classification: "moderate" })
    expect(hook.result.current.fieldError("e1", "probability")).toMatch(/cambió mientras la editabas/)
    expect(hook.result.current.status).toMatchObject({ state: "error" })
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
    expect(hook.result.current.status.state).toBe("error")
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
    expect(hook.result.current.status.state).toBe("saved")
  })

  it("sigue en error mientras otro campo conserve su error", async () => {
    saveMiperEntryAction
      .mockResolvedValueOnce({ ok: false, message: "rechazado" })
      .mockResolvedValueOnce({ ok: true, data: { version: 2, magnitude: 4, classification: "moderate" } })
    const { hook } = setup()
    await act(async () => { await hook.result.current.commit(entry, { probability: 4 }) })
    await act(async () => { await hook.result.current.commit(entry, { consequence: 4 }) })
    expect(hook.result.current.fieldError("e1", "probability")).toBe("rechazado")
    expect(hook.result.current.status.state).toBe("error")
  })

  it("«Recargar riesgo» descarta el conflicto: el campo pierde el mensaje y el guardado siguiente anuncia «guardado»", async () => {
    saveMiperEntryAction
      .mockResolvedValueOnce({ ok: false, message: "La fila cambió mientras la editabas. Recarga la matriz." })
      .mockResolvedValueOnce({ ok: true, data: { version: 3, magnitude: 4, classification: "moderate" } })
    const { hook } = setup()
    await act(async () => { await hook.result.current.commit(entry, { probability: 4 }) })
    expect(hook.result.current.status.state).toBe("error")
    act(() => { hook.result.current.clearErrors("e1") })
    expect(hook.result.current.fieldError("e1", "probability")).toBeUndefined()
    expect(hook.result.current.status.state).toBe("idle")
    await act(async () => { await hook.result.current.commit(entry, { consequence: 4 }) })
    expect(hook.result.current.status.state).toBe("saved")
  })

  it("tras un refresh del servidor, revierte al valor del servidor y no al guardado antes", async () => {
    saveMiperEntryAction
      .mockResolvedValueOnce({ ok: true, data: { version: 2, magnitude: 6, classification: "moderate" } })
      .mockResolvedValueOnce({ ok: false, message: "rechazado" })
    const { hook, rows } = setup()
    await act(async () => { await hook.result.current.commit(entry, { probability: 4 }) })
    hook.rerender({ serverRows: [{ ...entry, probability: 1, magnitude: 2, classification: "tolerable" } as MiperEntrySnapshot] })
    await act(async () => { await hook.result.current.commit({ ...entry, probability: 1 }, { probability: 2 }) })
    expect(rows()[0]).toMatchObject({ probability: 1 })
  })
})
