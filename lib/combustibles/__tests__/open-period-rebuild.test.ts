import { describe, expect, it, vi } from "vitest"
import { emptyUnbackedProviderBatches, providerBatchKey, replaceBatchRecords } from "../open-period"

function makeTx(existing: Array<{ id: string; patente: string; vehicleId: string | null }>) {
  const updates: Array<Record<string, unknown>> = []
  const inserts: Array<Record<string, unknown>> = []
  const deletes: unknown[] = []
  return {
    updates,
    inserts,
    deletes,
    query: { fuelConsumptionRecords: { findMany: vi.fn().mockResolvedValue(existing) } },
    delete: vi.fn((table: unknown) => ({ where: vi.fn(async (where: unknown) => { deletes.push({ table, where }) }) })),
    update: vi.fn(() => ({ set: (value: Record<string, unknown>) => ({ where: vi.fn(async () => { updates.push(value) }) }) })),
    insert: vi.fn(() => ({ values: async (values: Record<string, unknown>[]) => { inserts.push(...values) } })),
  }
}

const row = (patente: string, quantity: number, vehicleId: string | null = "vehicle-new") => ({
  id: `new-${patente}`,
  batchId: "batch-1",
  worksiteId: "worksite-1",
  vehicleId,
  patente,
  numeroTarjetas: 1,
  numeroTransacciones: 1,
  cantidadUnidad: quantity,
  monto: quantity * 100,
  rendimientoPromedio: 0,
  precioPromedioUnidad: 100,
  periodoDesde: "2026-08-01",
  periodoHasta: "2026-08-31",
  fuente: "Copec TCT Diesel",
  rawRow: { quantity },
})

describe("replaceBatchRecords", () => {
  it("removes disappeared plates and updates a composition change with the same total", async () => {
    const tx = makeTx([
      { id: "old-a", patente: "AAA111", vehicleId: "manual-vehicle" },
      { id: "old-b", patente: "BBB222", vehicleId: null },
    ])

    const result = await replaceBatchRecords(tx as never, "batch-1", [row("AAA111", 40), row("CCC333", 60)])

    expect(result).toMatchObject({ inserted: 1, updated: 1, removed: 1 })
    expect(tx.deletes).toHaveLength(1)
    // El vínculo manual ya vive en la fila existente; el reemplazo no envía
    // `vehicleId` en el UPDATE y por eso no puede pisarlo.
    expect(tx.updates[0]).toMatchObject({ cantidadUnidad: 40 })
    expect(tx.updates[0]).not.toHaveProperty("vehicleId")
    expect(tx.inserts[0]).toMatchObject({ patente: "CCC333", cantidadUnidad: 60 })
  })

  it("no borra la fila cuando la fuente cambia el formato de la patente", async () => {
    // Aramco entrega "SZ GB 72" y el canon del módulo es "SZGB72". Con la clave
    // exacta la fila guardada no calzaba con la entrante: se borraba y se
    // reinsertaba, perdiendo el `vehicle_id` que un operador fijó a mano — que
    // es justo lo que este módulo existe para no perder.
    const tx = makeTx([{ id: "old-a", patente: "SZ GB 72", vehicleId: "manual-vehicle" }])

    const result = await replaceBatchRecords(tx as never, "batch-1", [row("SZGB72", 40)])

    expect(result).toMatchObject({ inserted: 0, updated: 1, removed: 0 })
    expect(tx.deletes).toHaveLength(0)
    expect(tx.inserts).toHaveLength(0)
    // El texto guardado se alinea con el canon, y el vínculo manual sobrevive.
    expect(tx.updates[0]).toMatchObject({ patente: "SZGB72", cantidadUnidad: 40 })
    expect(tx.updates[0]).not.toHaveProperty("vehicleId")
  })

  it("clears the projection when the provider returns no rows", async () => {
    const tx = makeTx([{ id: "old-a", patente: "AAA111", vehicleId: "manual-vehicle" }])

    const result = await replaceBatchRecords(tx as never, "batch-1", [])

    expect(result).toMatchObject({ inserted: 0, updated: 0, removed: 1 })
    expect(tx.deletes).toHaveLength(1)
  })
})

describe("emptyUnbackedProviderBatches", () => {
  const batch = (over: Record<string, unknown> = {}) => ({
    id: "batch-viejo", worksiteId: "ws-1", periodoDesde: "2026-08-01", periodoHasta: "2026-08-31",
    fuente: "Aramco Fleet Diesel", totalFilas: 3, ...over,
  })

  function makeDb(candidates: Record<string, unknown>[]) {
    const tx = makeTx([{ id: "rec-1", patente: "AAA11", vehicleId: null }])
    return {
      tx,
      db: {
        query: { fuelImportBatches: { findMany: vi.fn().mockResolvedValue(candidates) } },
        transaction: (callback: (inner: unknown) => unknown) => callback({ ...tx, execute: vi.fn() }),
      },
    }
  }

  it("vacía el lote que la fuente dejó de respaldar", async () => {
    // Un vehículo que cambia de faena saca su grupo de la respuesta: la
    // reconstrucción por hash sólo visita los grupos presentes, así que sin
    // este barrido el lote conservaba litros y monto para siempre.
    const { db, tx } = makeDb([batch()])

    const result = await emptyUnbackedProviderBatches(db as never, {
      sources: ["Aramco Fleet Diesel"], from: "2026-08-01", to: "2026-08-31",
      keep: new Set<string>(), lockNamespace: "fuel_aramco",
    })

    expect(result).toEqual({ emptied: 1, records: 1 })
    expect(tx.updates[0]).toMatchObject({ totalFilas: 0, totalCantidad: 0, totalMonto: 0, hashArchivo: "" })
  })

  it("no toca un lote que la respuesta sí respalda", async () => {
    const { db, tx } = makeDb([batch()])

    const result = await emptyUnbackedProviderBatches(db as never, {
      sources: ["Aramco Fleet Diesel"], from: "2026-08-01", to: "2026-08-31",
      keep: new Set([providerBatchKey("ws-1", "2026-08-01", "2026-08-31", "Aramco Fleet Diesel")]),
      lockNamespace: "fuel_aramco",
    })

    expect(result).toEqual({ emptied: 0, records: 0 })
    expect(tx.updates).toEqual([])
  })

  it("no consulta nada cuando la corrida no leyó ninguna fuente completa", async () => {
    // El llamador pasa sólo las fuentes que sí pudo leer: barrer con una
    // descarga incompleta borraría datos buenos.
    const { db } = makeDb([batch()])

    const result = await emptyUnbackedProviderBatches(db as never, {
      sources: [], from: "2026-08-01", to: "2026-08-31", keep: new Set<string>(), lockNamespace: "fuel_aramco",
    })

    expect(result).toEqual({ emptied: 0, records: 0 })
    expect(db.query.fuelImportBatches.findMany).not.toHaveBeenCalled()
  })
})
