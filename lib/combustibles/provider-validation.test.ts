import { describe, expect, it } from "vitest"
import {
  fingerprintProviderRow,
  validateProviderRows,
  type ProviderRowInput,
} from "./provider-validation"

const window = { from: "2026-08-01", to: "2026-08-31" }

function row(overrides: Partial<ProviderRowInput> = {}): ProviderRowInput {
  return {
    provider: "copec",
    accountKey: "copec-tct",
    sourceRowKey: "row-1",
    externalId: null,
    occurredAt: "2026-08-10T10:30:00",
    plate: "AB-CD12",
    product: "Petróleo Diesel",
    quantity: 100,
    amount: 120_000,
    payload: { source: "fixture" },
    ...overrides,
  }
}

describe("provider validation", () => {
  it("accepts a valid row and creates a stable fallback identity without a native id", () => {
    const result = validateProviderRows([row()], window)

    expect(result.accepted).toHaveLength(1)
    expect(result.accepted[0]).toMatchObject({
      identityKey: "row:copec:copec-tct:row-1",
      product: "diesel",
      plate: "ABCD12",
    })
    expect(result.rejected).toHaveLength(0)
    expect(result.pending).toHaveLength(0)
  })

  it("rejects dates outside the requested period instead of stamping the requested month", () => {
    const result = validateProviderRows([row({ occurredAt: "2026-07-31T23:59:59" })], window)

    expect(result.accepted).toHaveLength(0)
    expect(result.rejected[0]).toMatchObject({ code: "date_out_of_range" })
  })

  it("rejects negative and non-finite quantities", () => {
    const result = validateProviderRows([
      row({ sourceRowKey: "negative", quantity: -1 }),
      row({ sourceRowKey: "nan", quantity: Number.NaN }),
    ], window)

    expect(result.rejected.map((item) => item.code)).toEqual(["negative_quantity", "invalid_quantity"])
  })

  it("sends unknown products and missing plates to durable pending work", () => {
    const result = validateProviderRows([
      row({ sourceRowKey: "product", product: "Combustible inventado" }),
      row({ sourceRowKey: "plate", plate: null }),
    ], window)

    expect(result.pending.map((item) => item.code)).toEqual(["unknown_product", "missing_plate"])
  })

  it("rejects duplicate identities inside one provider response", () => {
    const result = validateProviderRows([row(), row()], window)

    expect(result.accepted).toHaveLength(1)
    expect(result.rejected[0]).toMatchObject({ code: "duplicate_identity" })
  })

  it("uses the native external id when available and keeps the payload fingerprint separate", () => {
    const input = row({ externalId: "aramco-123", provider: "aramco", accountKey: "operator-9" })
    const result = validateProviderRows([input], window)

    expect(result.accepted[0]).toMatchObject({ identityKey: "external:aramco-123", externalId: "aramco-123" })
    expect(result.accepted[0]?.fingerprint).toBe(fingerprintProviderRow(input))
  })

  it("conserva la patente cruda además de la clave de comparación", () => {
    // `source_plate` guardaba la forma compacta para las aceptadas y la cruda
    // para las rechazadas: dos representaciones en la misma columna. La columna
    // significa "lo que mandó el proveedor" —así la lee la exportación de
    // calidad, donde el operador va a buscarla al portal—; `plate` es la clave
    // de matching. Mismo par que `sourceProduct`/`product`.
    const result = validateProviderRows([row({ plate: "RW YH 93" })], window)

    expect(result.accepted[0]).toMatchObject({ plate: "RWYH93", sourcePlate: "RW YH 93" })
  })

  it("acepta gasolina y kerosene en vez de dejarlos sin mapping", () => {
    // Caían en `pending` por "producto sin mapping canónico" y sus litros nunca
    // llegaban a un lote, con lo que la fuente `Aramco Fleet Otros` —creada
    // justamente para recogerlos— era inalcanzable.
    const result = validateProviderRows([
      row({ sourceRowKey: "g", product: "Aramco Gasolina 93" }),
      row({ sourceRowKey: "k", product: "Kerosene" }),
    ], window)

    expect(result.accepted.map((accepted) => accepted.product)).toEqual(["gasolina", "kerosene"])
    expect(result.pending).toEqual([])
  })
})
