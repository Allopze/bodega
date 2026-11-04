// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useMediaQuery } from "./use-media-query"

const original = window.matchMedia

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>()
  const state = { matches }
  const media = {
    get matches() { return state.matches },
    media: "",
    addEventListener: vi.fn((_: string, cb: () => void) => listeners.add(cb)),
    removeEventListener: vi.fn((_: string, cb: () => void) => listeners.delete(cb)),
  }
  Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: vi.fn(() => media) })
  return {
    listeners,
    media,
    set(next: boolean) {
      state.matches = next
      listeners.forEach((cb) => cb())
    },
  }
}

afterEach(() => {
  Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: original })
})

describe("useMediaQuery", () => {
  it("responde si la consulta coincide y la consulta tal cual", () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useMediaQuery("(max-width: 359.98px)"))
    expect(result.current).toBe(true)
    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 359.98px)")
  })

  it("sigue el cambio de la consulta (girar el teléfono, redimensionar)", () => {
    const mock = mockMatchMedia(false)
    const { result } = renderHook(() => useMediaQuery("(max-width: 359.98px)"))
    expect(result.current).toBe(false)
    act(() => mock.set(true))
    expect(result.current).toBe(true)
    act(() => mock.set(false))
    expect(result.current).toBe(false)
  })

  it("se da de baja al desmontar", () => {
    const mock = mockMatchMedia(false)
    const { unmount } = renderHook(() => useMediaQuery("(max-width: 359.98px)"))
    expect(mock.listeners.size).toBe(1)
    unmount()
    expect(mock.listeners.size).toBe(0)
  })

  it("sin matchMedia (servidor, jsdom desnudo) responde false", () => {
    Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: undefined })
    const { result } = renderHook(() => useMediaQuery("(max-width: 359.98px)"))
    expect(result.current).toBe(false)
  })
})
