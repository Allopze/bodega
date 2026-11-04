import { describe, expect, it } from "vitest"
import { niceAxisMax } from "../chart-scale"

describe("niceAxisMax", () => {
  it("redondea hacia arriba a un tope legible", () => {
    expect(niceAxisMax(38)).toBe(40)
    expect(niceAxisMax(41)).toBe(50)
    expect(niceAxisMax(7.2)).toBe(8)
    expect(niceAxisMax(940)).toBe(1_000)
    expect(niceAxisMax(0.31)).toBeCloseTo(0.4, 10)
  })

  it("un valor que ya es un tope redondo no sube de nivel", () => {
    expect(niceAxisMax(40)).toBe(40)
    expect(niceAxisMax(1_000)).toBe(1_000)
  })

  it("sin nada que cubrir da un tope por defecto, no NaN ni 0", () => {
    expect(niceAxisMax(0)).toBe(10)
    expect(niceAxisMax(-3)).toBe(10)
    expect(niceAxisMax(Number.NaN)).toBe(10)
  })
})
