import { describe, expect, it } from "vitest"
import { rankingItems, rankingLeaderSummary } from "./analytics-rankings"

const money = (value: number) => `$${value}`

describe("rankingItems", () => {
  it("ordena de mayor a menor, descarta lo que no tiene valor y redondea a pesos", () => {
    const items = rankingItems([
      { key: "b", label: "B", value: 200.4 },
      { key: "z", label: "Z", value: 0 },
      { key: "a", label: "A", value: 500.6 },
    ])

    expect(items.map((item) => [item.key, item.value])).toEqual([["a", 501], ["b", 200]])
  })

  it("conserva el detalle y el enlace de cada fila", () => {
    const [item] = rankingItems([{ key: "a", label: "A", value: 1, detail: "3 cargas", href: "/x" }])

    expect(item).toMatchObject({ detail: "3 cargas", href: "/x" })
  })
})

describe("rankingLeaderSummary", () => {
  it("nombra al primero y su parte de lo listado, calculada de los datos", () => {
    const items = rankingItems([{ key: "a", label: "Faena Norte", value: 600 }, { key: "b", label: "Faena Sur", value: 400 }])

    expect(rankingLeaderSummary(items, money)).toBe("Faena Norte lidera con $600: 60% de lo listado.")
  })

  it("con una sola fila no compara", () => {
    const items = rankingItems([{ key: "a", label: "Faena Norte", value: 600 }])

    expect(rankingLeaderSummary(items, money)).toBe("Faena Norte es la única con gasto: $600.")
  })

  it("sin filas no afirma nada", () => {
    expect(rankingLeaderSummary([], money)).toBe("")
  })

  it("cuando la lista es el total, la base lo dice", () => {
    const items = rankingItems([{ key: "a", label: "EPP", value: 750 }, { key: "b", label: "Repuestos", value: 250 }])

    expect(rankingLeaderSummary(items, money, { of: "del gasto" })).toBe("EPP lidera con $750: 75% del gasto.")
  })

  it("concuerda el género de «único»", () => {
    const one = rankingItems([{ key: "a", label: "AA-BB-11", value: 600 }])

    expect(rankingLeaderSummary(one, money, { gender: "o" })).toBe("AA-BB-11 es el único con gasto: $600.")
  })
})
