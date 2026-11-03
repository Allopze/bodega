import { describe, expect, it } from "vitest"
import { buildFuelVariationCandidates, candidateTouchesCutoff, formatFuelVariationReconciliationReport, reconcileLegacyVariationCases } from "../fuel-variation"

const record = (input: {
  id: string
  vehicleId: string
  periodoDesde: string
  cantidad: number
  fuente: string
}) => ({
  ...input,
  worksiteId: "worksite-1",
  equipmentTypeSlug: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
})

describe("serie y conciliación histórica de variaciones de combustible", () => {
  it("compara cada producto por separado y cuenta las fuentes sin producto", () => {
    const result = buildFuelVariationCandidates([
      record({ id: "diesel-jun", vehicleId: "vehicle-1", periodoDesde: "2026-06-01", cantidad: 100, fuente: "Copec TCT Diesel" }),
      record({ id: "bluemax-jun", vehicleId: "vehicle-1", periodoDesde: "2026-06-01", cantidad: 1000, fuente: "Copec TCT BlueMax" }),
      record({ id: "diesel-jul", vehicleId: "vehicle-1", periodoDesde: "2026-07-01", cantidad: 150, fuente: "Copec TCT Diesel" }),
      record({ id: "bluemax-jul", vehicleId: "vehicle-1", periodoDesde: "2026-07-01", cantidad: 1100, fuente: "Copec TCT BlueMax" }),
      record({ id: "unknown", vehicleId: "vehicle-2", periodoDesde: "2026-07-01", cantidad: 10, fuente: "Proveedor desconocido" }),
    ], () => 50)

    expect(result.unclassifiedRecords).toBe(1)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({ product: "diesel", previous: { id: "diesel-jun" }, current: { id: "diesel-jul" }, changePct: 50 })
  })

  it("compara el producto aunque cambie la etiqueta de la fuente", () => {
    const result = buildFuelVariationCandidates([
      record({ id: "diesel-jun", vehicleId: "vehicle-1", periodoDesde: "2026-06-01", cantidad: 100, fuente: "TCT Diesel" }),
      record({ id: "diesel-jul", vehicleId: "vehicle-1", periodoDesde: "2026-07-01", cantidad: 150, fuente: "Copec TCT Diesel" }),
    ], () => 50)

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.product).toBe("diesel")
  })

  it("omite y reporta períodos duplicados sin escoger una fila por id", () => {
    const result = buildFuelVariationCandidates([
      record({ id: "diesel-jun", vehicleId: "vehicle-1", periodoDesde: "2026-06-01", cantidad: 100, fuente: "Copec TCT Diesel" }),
      record({ id: "diesel-jul-a", vehicleId: "vehicle-1", periodoDesde: "2026-07-01", cantidad: 1_000, fuente: "Copec TCT Diesel" }),
      record({ id: "diesel-jul-b", vehicleId: "vehicle-1", periodoDesde: "2026-07-01", cantidad: 110, fuente: "Copec TCT Diesel" }),
      record({ id: "diesel-aug", vehicleId: "vehicle-1", periodoDesde: "2026-08-01", cantidad: 100, fuente: "Copec TCT Diesel" }),
    ], () => 50)

    expect(result.candidates).toEqual([])
    expect(result.ambiguousPeriods).toEqual([{ vehicleId: "vehicle-1", periodoDesde: "2026-07-01" }])
  })

  it("incluye el borde si cualquiera de sus filas fue creada o actualizada desde el corte", () => {
    const previous = record({ id: "diesel-jun", vehicleId: "vehicle-1", periodoDesde: "2026-06-01", cantidad: 100, fuente: "Copec TCT Diesel" })
    const current = record({ id: "diesel-jul", vehicleId: "vehicle-1", periodoDesde: "2026-07-01", cantidad: 150, fuente: "Copec TCT Diesel" })
    const candidate = buildFuelVariationCandidates([previous, current], () => 50).candidates[0]!
    const cutoff = Date.parse("2026-07-01T00:00:00.000Z")

    expect(candidateTouchesCutoff(candidate, cutoff)).toBe(false)
    previous.updatedAt = "2026-07-02T00:00:00.000Z"
    expect(candidateTouchesCutoff(candidate, cutoff)).toBe(true)
    previous.updatedAt = "2026-01-01T00:00:00.000Z"
    current.createdAt = "2026-07-01T00:00:00.000Z"
    expect(candidateTouchesCutoff(candidate, cutoff)).toBe(true)
  })

  it("clasifica coincidencias por producto, posibles cruces Diesel/BlueMax y casos no concluyentes", () => {
    const records = [
      record({ id: "a-d-jun", vehicleId: "vehicle-a", periodoDesde: "2026-06-01", cantidad: 100, fuente: "Copec TCT Diesel" }),
      record({ id: "a-d-jul", vehicleId: "vehicle-a", periodoDesde: "2026-07-01", cantidad: 150, fuente: "Copec TCT Diesel" }),
      record({ id: "b-d-jul", vehicleId: "vehicle-b", periodoDesde: "2026-07-01", cantidad: 100, fuente: "Copec TCT Diesel" }),
      record({ id: "b-b-jul", vehicleId: "vehicle-b", periodoDesde: "2026-07-01", cantidad: 50, fuente: "Copec TCT BlueMax" }),
      record({ id: "c-d-jun", vehicleId: "vehicle-c", periodoDesde: "2026-06-01", cantidad: 100, fuente: "Copec TCT Diesel" }),
      record({ id: "c-d-jul", vehicleId: "vehicle-c", periodoDesde: "2026-07-01", cantidad: 150, fuente: "Copec TCT Diesel" }),
      record({ id: "c-b-jul", vehicleId: "vehicle-c", periodoDesde: "2026-07-01", cantidad: 75, fuente: "Copec TCT BlueMax" }),
      record({ id: "d-d-jun", vehicleId: "vehicle-d", periodoDesde: "2026-06-01", cantidad: 100, fuente: "Copec TCT Diesel" }),
      record({ id: "d-d-jul", vehicleId: "vehicle-d", periodoDesde: "2026-07-01", cantidad: 120, fuente: "Copec TCT Diesel" }),
    ]
    const summary = reconcileLegacyVariationCases([
      { vehicleId: "vehicle-a", referenceEntityId: "vehicle-a:2026-07-01", observedValue: "+50%" },
      { vehicleId: "vehicle-b", referenceEntityId: "vehicle-b:2026-07-01", observedValue: "+50%" },
      { vehicleId: "vehicle-c", referenceEntityId: "vehicle-c:2026-07-01", observedValue: "+50%" },
      { vehicleId: "vehicle-d", referenceEntityId: "vehicle-d:2026-07-01", observedValue: "+70%" },
    ], records, () => 50)

    expect(summary).toEqual({ sameProductMatch: 1, crossProductCandidate: 1, ambiguous: 1, noCorrectedCandidate: 1, total: 4 })
  })

  it("emite clasificación agregada, incluye el snapshot conocido y omite identificadores", () => {
    const report = formatFuelVariationReconciliationReport({
      generatedAt: "2026-11-02T12:00:00.000Z",
      recordCount: 1200,
      legacyCaseCount: 149,
      legacyStatusCounts: { open: 149 },
      openQueueCounts: { kilometraje_regresivo: 114, salto_medidor_implausible: 83, variacion_brusca_consumo: 149 },
      unclassifiedRecords: 8,
      reconciliation: { sameProductMatch: 42, crossProductCandidate: 46, ambiguous: 16, noCorrectedCandidate: 45, total: 149 },
    })

    expect(report).toContain("El porcentaje coincide con la relación Diesel/BlueMax | 46")
    expect(report).toContain("| Abierto | 149 |")
    expect(report).toContain("| Total activo | 346 |")
    expect(report).toContain("75 referencias legadas")
    expect(report).toContain("no modifica casos, estados ni registros")
    expect(report).not.toContain("ABC123")
    expect(report).not.toContain("fuel-consumption-row-id")
  })
})
