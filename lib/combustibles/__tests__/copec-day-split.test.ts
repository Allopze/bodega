import { describe, expect, it } from "vitest"
import { splitAggregateByDay } from "../copec-day-split"

// KA-1 estuvo en la faena W1 hasta el 14-feb y en W2 desde el 15-feb.
const resolveOnDay = (day: string) => (day < "2026-02-15" ? { id: "v-ka1", worksiteId: "W1" } : day <= "2026-02-28" ? { id: "v-ka1", worksiteId: "W2" } : undefined)

describe("splitAggregateByDay", () => {
  it("atribuye cada carga a la faena que la patente tenía ese día", () => {
    const result = splitAggregateByDay({
      aggregate: { cantidadUnidad: 100, monto: 120_000 },
      transactions: [
        { sourceDate: "2026-02-20", liters: 35, amount: 42_000 },
        { sourceDate: "2026-02-05", liters: 40, amount: 48_000 },
        { sourceDate: "2026-02-25", liters: 25, amount: 30_000 },
      ],
      resolveOnDay,
    })
    expect(result).toEqual({
      ok: true,
      parts: [
        { worksiteId: "W1", vehicleId: "v-ka1", liters: 40, amount: 48_000, transactions: 1, from: "2026-02-05", to: "2026-02-05" },
        { worksiteId: "W2", vehicleId: "v-ka1", liters: 60, amount: 72_000, transactions: 2, from: "2026-02-20", to: "2026-02-25" },
      ],
    })
  })

  it("tolera el redondeo del proveedor entre el detalle y el total", () => {
    const result = splitAggregateByDay({
      aggregate: { cantidadUnidad: 100.2, monto: 120_001 },
      transactions: [{ sourceDate: "2026-02-05", liters: 40.1, amount: 48_000 }, { sourceDate: "2026-02-20", liters: 60, amount: 72_000 }],
      resolveOnDay,
    })
    expect(result.ok).toBe(true)
  })

  it("no reparte sin detalle por transacción: prorratear por calendario inventaría el consumo", () => {
    expect(splitAggregateByDay({ aggregate: { cantidadUnidad: 100, monto: 1 }, transactions: [], resolveOnDay }))
      .toEqual({ ok: false, reason: expect.stringContaining("detalle por transacción") })
  })

  it("no reparte si un día de carga no tiene faena asignada", () => {
    const result = splitAggregateByDay({
      aggregate: { cantidadUnidad: 100, monto: 120_000 },
      transactions: [{ sourceDate: "2026-02-05", liters: 40, amount: 48_000 }, { sourceDate: "2026-03-01", liters: 60, amount: 72_000 }],
      resolveOnDay,
    })
    expect(result).toEqual({ ok: false, reason: "el 2026-03-01 la patente no tiene faena asignada" })
  })

  it("no reparte si el detalle no suma el total del mes", () => {
    const result = splitAggregateByDay({
      aggregate: { cantidadUnidad: 150, monto: 120_000 },
      transactions: [{ sourceDate: "2026-02-05", liters: 40, amount: 48_000 }, { sourceDate: "2026-02-20", liters: 60, amount: 72_000 }],
      resolveOnDay,
    })
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("el detalle suma 100 L") })
  })

  it("separa por vehículo si la misma patente cambió de ficha", () => {
    const result = splitAggregateByDay({
      aggregate: { cantidadUnidad: 100, monto: 0 },
      transactions: [{ sourceDate: "2026-02-05", liters: 40, amount: 0 }, { sourceDate: "2026-02-06", liters: 60, amount: 0 }],
      resolveOnDay: (day) => (day === "2026-02-05" ? { id: "v-old", worksiteId: "W1" } : { id: "v-new", worksiteId: "W1" }),
    })
    expect(result.ok && result.parts.map((part) => part.vehicleId)).toEqual(["v-old", "v-new"])
  })
})
