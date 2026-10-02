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
  const hook = renderHook(() => useEntryAutosave({ matrixId: "m1", entryVersions: { e1: 1 }, setRows, riskFactors: [] }))
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
})
