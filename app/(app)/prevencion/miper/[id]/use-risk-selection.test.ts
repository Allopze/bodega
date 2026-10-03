// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { useRiskSelection } from "./use-risk-selection"

const e = (id: string) => ({ id, rowNumber: Number(id.slice(1)) }) as MiperEntrySnapshot
const all = [e("r1"), e("r2"), e("r3")]

describe("useRiskSelection (Fase D)", () => {
  it("es un modo: empieza apagado y «Terminar» vacía la selección", () => {
    const { result } = renderHook(() => useRiskSelection(all))
    expect(result.current.selecting).toBe(false)
    act(() => { result.current.start() })
    act(() => { result.current.toggle("r2") })
    expect(result.current.selected.map((entry) => entry.id)).toEqual(["r2"])
    act(() => { result.current.stop() })
    expect(result.current.selecting).toBe(false)
    expect(result.current.selected).toEqual([])
  })

  it("sólo cuenta lo que se ve: un filtro que esconde un riesgo lo saca de la selección, y vuelve si se ve otra vez", () => {
    const { result, rerender } = renderHook(({ visible }) => useRiskSelection(visible), { initialProps: { visible: all } })
    act(() => { result.current.start() })
    act(() => { result.current.toggle("r3"); result.current.toggle("r1") })
    // En el orden de la vista, no en el de los clics.
    expect(result.current.selected.map((entry) => entry.id)).toEqual(["r1", "r3"])
    rerender({ visible: [all[0]!, all[1]!] })
    expect(result.current.selected.map((entry) => entry.id)).toEqual(["r1"])
    rerender({ visible: all })
    expect(result.current.selected.map((entry) => entry.id)).toEqual(["r1", "r3"])
  })

  it("«Seleccionar los N» marca todo lo visible y «Quitar selección» lo desmarca sin salir del modo", () => {
    const { result } = renderHook(() => useRiskSelection(all))
    act(() => { result.current.start() })
    act(() => { result.current.selectAll() })
    expect(result.current.selected).toHaveLength(3)
    expect(result.current.isSelected("r2")).toBe(true)
    act(() => { result.current.clear() })
    expect(result.current.selected).toEqual([])
    expect(result.current.selecting).toBe(true)
  })
})
