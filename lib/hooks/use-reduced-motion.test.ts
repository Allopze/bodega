// @vitest-environment jsdom
import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useReducedMotion } from "./use-reduced-motion"

const original = window.matchMedia

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>()
  const media = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn((_: string, cb: () => void) => listeners.add(cb)),
    removeEventListener: vi.fn((_: string, cb: () => void) => listeners.delete(cb)),
  }
  Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: vi.fn(() => media) })
  return { media, listeners }
}

afterEach(() => {
  Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: original })
})

describe("useReducedMotion", () => {
  it("es false cuando la preferencia no coincide", () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
  })

  it("es true cuando el usuario pidió reducir el movimiento", () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(true)
  })

  it("consulta la media query correcta", () => {
    mockMatchMedia(false)
    renderHook(() => useReducedMotion())
    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)")
  })

  it("sin matchMedia (jsdom desnudo, servidor) responde false en vez de romper", () => {
    Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: undefined })
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
  })

  it("se suscribe al cambio y se da de baja al desmontar", () => {
    const { media, listeners } = mockMatchMedia(false)
    const { unmount } = renderHook(() => useReducedMotion())
    expect(media.addEventListener).toHaveBeenCalledWith("change", expect.any(Function))
    expect(listeners.size).toBe(1)
    unmount()
    expect(listeners.size).toBe(0)
  })
})
