import { describe, expect, it, vi } from "vitest"

// El módulo importa `db` y el esquema para las consultas del resumen; aquí solo se
// ejercita la función pura de atípicos, así que se aíslan.
vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/db/schema", () => ({
  fuelOperationRecords: {}, fuelVehicles: {}, fuelEquipmentTypes: {}, worksites: {},
}))
vi.mock("@/lib/auth/scope", () => ({ worksiteScopeSql: () => undefined }))

const { flagRendimientoPorUnidad } = await import("../operations-dashboard")

describe("flagRendimientoPorUnidad", () => {
  it("does not flag normal equipment when km/L and L/h share the filtered set", () => {
    const rows = [
      ...Array.from({ length: 12 }, (_, i) => ({ patente: `CAM-${i}`, rendimiento: 2.5, cantidad: 100, unidad: "km_lt" })),
      ...Array.from({ length: 4 }, (_, i) => ({ patente: `CARG-${i}`, rendimiento: 18, cantidad: 100, unidad: "lt_hr" })),
    ]

    // Mezcladas, la media (6,38) y σ (6,71) marcaban atípicos a los 4 cargadores
    // por comparar L/h contra km/L.
    expect(flagRendimientoPorUnidad(rows).filter((r) => r.atipico)).toEqual([])
  })

  it("still flags an outlier inside its own unit", () => {
    const rows = [
      ...Array.from({ length: 12 }, (_, i) => ({ patente: `CAM-${i}`, rendimiento: 2.5, cantidad: 100, unidad: "km_lt" })),
      { patente: "CAM-FUGA", rendimiento: 0.2, cantidad: 100, unidad: "km_lt" },
      ...Array.from({ length: 4 }, (_, i) => ({ patente: `CARG-${i}`, rendimiento: 18, cantidad: 100, unidad: "lt_hr" })),
    ]

    expect(flagRendimientoPorUnidad(rows).filter((r) => r.atipico).map((r) => r.patente)).toEqual(["CAM-FUGA"])
  })

  it("only flags missing readings for rows without a unit", () => {
    const rows = [
      { patente: "SIN-1", rendimiento: 0, cantidad: 50, unidad: null },
      { patente: "SIN-2", rendimiento: 40, cantidad: 50, unidad: null },
      { patente: "SIN-3", rendimiento: 2, cantidad: 50, unidad: null },
    ]

    expect(flagRendimientoPorUnidad(rows).filter((r) => r.atipico).map((r) => r.patente)).toEqual(["SIN-1"])
  })
})
