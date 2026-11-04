// @vitest-environment jsdom

/**
 * `useChartMotion`: la entrada de las series dura a lo sumo 200 ms y se apaga con
 * «reducir movimiento» (DESIGN.md § Gráficos › Movimiento). Antes duraba 900 ms:
 * el gráfico tardaba casi un segundo en decir lo que ya sabía la tabla de al lado.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { CHART_ENTRY_MS, useChartMotion } from "@/components/ui/chart-interactions"

const original = window.matchMedia

function mockReducedMotion(reduced: boolean) {
  const media = {
    matches: reduced,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: vi.fn(() => media) })
}

afterEach(() => {
  Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: original })
})

describe("useChartMotion", () => {
  it("la entrada dura 200 ms o menos", () => {
    mockReducedMotion(false)
    const { result } = renderHook(() => useChartMotion())
    expect(result.current.isAnimationActive).toBe(true)
    expect(result.current.animationDuration).toBeLessThanOrEqual(200)
    expect(CHART_ENTRY_MS).toBeLessThanOrEqual(200)
    expect(result.current.animationDuration).toBe(CHART_ENTRY_MS)
  })

  it("con «reducir movimiento» no anima", () => {
    mockReducedMotion(true)
    const { result } = renderHook(() => useChartMotion())
    expect(result.current.isAnimationActive).toBe(false)
  })
})
