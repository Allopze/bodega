import { describe, expect, it } from "vitest"
import { ongoingAbovePeak, ongoingPeakClause } from "./peak"

const point = (key: string, value: number | null, partial = false) => ({ key, value, partial })
const valueOf = (item: { value: number | null }) => item.value

describe("el mes en curso que ya supera al mayor de los cerrados (paso 5)", () => {
  it("se dice cuando supera a todos los cerrados", () => {
    const data = [point("2026-09", 12), point("2026-10", 23.8), point("2026-11", 58, true)]
    expect(ongoingAbovePeak(data, valueOf)).toEqual({ point: data[2], value: 58 })
  })

  it("no se dice si no los supera, si iguala, si no hay balde en curso o si no hay cerrados", () => {
    expect(ongoingAbovePeak([point("2026-10", 23.8), point("2026-11", 10, true)], valueOf)).toBeNull()
    expect(ongoingAbovePeak([point("2026-10", 23.8), point("2026-11", 23.8, true)], valueOf)).toBeNull()
    expect(ongoingAbovePeak([point("2026-10", 23.8), point("2026-11", 40)], valueOf)).toBeNull()
    expect(ongoingAbovePeak([point("2026-11", 40, true)], valueOf)).toBeNull()
    expect(ongoingAbovePeak([point("2026-10", 5), point("2026-11", null, true)], valueOf)).toBeNull()
  })

  it("los huecos de los cerrados no cuentan como cero ni como récord", () => {
    expect(ongoingAbovePeak([point("2026-09", null), point("2026-10", 4), point("2026-11", 6, true)], valueOf)?.value).toBe(6)
  })

  it("el cierre del titular nombra el balde en plural", () => {
    expect(ongoingPeakClause("month")).toBe(", que sigue en curso y ya supera a todos los meses anteriores del gráfico")
    expect(ongoingPeakClause("day")).toBe(", que sigue en curso y ya supera a todos los días anteriores del gráfico")
  })
})
