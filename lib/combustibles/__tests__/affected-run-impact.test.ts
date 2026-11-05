import { describe, expect, it, vi } from "vitest"

vi.mock("@/db", () => ({ db: {} }))

const { affectedRunImpact } = await import("../fuel-provider-ledger")

type Row = Parameters<typeof affectedRunImpact>[0][number]

function row(overrides: Partial<Row> = {}): Row {
  return {
    sourceAccount: "tae:diesel", sourcePlate: "KA-1", occurredAt: "2026-10-05T12:00:00.000Z",
    quantity: 100, amount: 120_000, identityKey: "row:copec:tae:diesel:g-1", granularity: "transaction",
    ...overrides,
  }
}

describe("affectedRunImpact (4.10)", () => {
  it("la tarjeta TAE sin estanque deja dos filas (`row:` y `external:`) y cuenta una vez", () => {
    expect(affectedRunImpact([row(), row({ identityKey: "external:g-1" })])).toEqual({ affectedQuantity: 100, affectedAmount: 120_000 })
  })

  it("dos cargas idénticas de verdad, en el mismo espacio de identidad, son dos", () => {
    const rows = [
      row({ identityKey: "row:copec:tae:diesel:g-1:1" }),
      row({ identityKey: "row:copec:tae:diesel:g-1:2" }),
      row({ identityKey: "external:g-1:1" }),
      row({ identityKey: "external:g-1:2" }),
    ]
    expect(affectedRunImpact(rows).affectedQuantity).toBe(200)
  })

  it("con detalle TCT el agregado mensual de la patente no se suma encima de sus transacciones", () => {
    const rows = [
      row({ sourceAccount: "tct:diesel", identityKey: "row:copec:tct:diesel:agg", granularity: "period_aggregate", occurredAt: "2026-10-01", quantity: 300, amount: 0 }),
      row({ sourceAccount: "tct:diesel", identityKey: "row:copec:tct:diesel:t-1", quantity: 100, amount: 0 }),
      row({ sourceAccount: "tct:diesel", identityKey: "row:copec:tct:diesel:t-2", occurredAt: "2026-10-09T12:00:00.000Z", quantity: 200, amount: 0 }),
    ]
    expect(affectedRunImpact(rows).affectedQuantity).toBe(300)
  })

  it("sin transacciones de esa patente, el agregado sí cuenta", () => {
    const rows = [
      row({ sourceAccount: "tct:diesel", sourcePlate: "KA-2", identityKey: "row:copec:tct:diesel:agg-2", granularity: "period_aggregate", quantity: 300, amount: 0 }),
      row({ sourceAccount: "tct:diesel", sourcePlate: "KA-3", identityKey: "row:copec:tct:diesel:t-9", quantity: 50, amount: 0 }),
    ]
    expect(affectedRunImpact(rows).affectedQuantity).toBe(350)
  })
})
