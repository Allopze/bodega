import { describe, it, expect } from "vitest"
import { selectDteCandidates } from "./dte-candidates"

const doc = (id: string, rutEmisor: string, fechaEmision: string) => ({ id, rutEmisor, fechaEmision })

describe("selectDteCandidates", () => {
  // Regresión del caso real: OC de APRO creada el 2026-08-07 ofrecía las 10
  // facturas de julio del proveedor, todas anteriores a la orden.
  it("descarta los DTE emitidos antes de que la orden existiera", () => {
    const docs = [
      doc("jul-31", "86887200-4", "2026-07-31"),
      doc("jul-01", "86887200-4", "2026-07-01"),
    ]

    const result = selectDteCandidates(docs, { supplierRut: "86887200-4", createdOn: "2026-08-07" })

    expect(result).toEqual([])
  })

  it("acepta el DTE emitido el mismo día en que se creó la orden", () => {
    const docs = [doc("mismo-dia", "86887200-4", "2026-08-07")]

    const result = selectDteCandidates(docs, { supplierRut: "86887200-4", createdOn: "2026-08-07" })

    expect(result.map((d) => d.id)).toEqual(["mismo-dia"])
  })

  it("descarta los DTE de otro proveedor aunque la fecha calce", () => {
    const docs = [
      doc("propio", "86887200-4", "2026-08-10"),
      doc("ajeno", "96542490-3", "2026-08-10"),
    ]

    const result = selectDteCandidates(docs, { supplierRut: "86887200-4", createdOn: "2026-08-01" })

    expect(result.map((d) => d.id)).toEqual(["propio"])
  })

  it("normaliza el RUT antes de comparar: suppliers.rut se ingresa a mano", () => {
    const docs = [doc("con-puntos", "86887200-4", "2026-08-10")]

    const result = selectDteCandidates(docs, { supplierRut: "86.887.200-4", createdOn: "2026-08-01" })

    expect(result.map((d) => d.id)).toEqual(["con-puntos"])
  })

  it("no ofrece nada cuando el proveedor de la OC no tiene RUT cargado", () => {
    const docs = [doc("cualquiera", "86887200-4", "2026-08-10")]

    expect(selectDteCandidates(docs, { supplierRut: null, createdOn: "2026-08-01" })).toEqual([])
    expect(selectDteCandidates(docs, { supplierRut: "", createdOn: "2026-08-01" })).toEqual([])
  })

  it("recorta la lista y conserva el orden recibido", () => {
    const docs = Array.from({ length: 30 }, (_, i) =>
      doc(`d${i}`, "86887200-4", "2026-08-10"),
    )

    const result = selectDteCandidates(docs, { supplierRut: "86887200-4", createdOn: "2026-08-01", limit: 5 })

    expect(result.map((d) => d.id)).toEqual(["d0", "d1", "d2", "d3", "d4"])
  })
})
