import { describe, it, expect } from "vitest"
import { computeDocumentHash } from "../sync"
import type { DteDocumentRow } from "../types"

describe("computeDocumentHash", () => {
  it("generates deterministic SHA-256 hash for document row", () => {
    const doc1: DteDocumentRow = {
      rowId: "12715",
      estadoSii: "aceptado",
      fecha: "2026-01-15",
      tipoDoc: "33",
      folio: 12715,
      razonSocial: "Proveedor SpA",
      estado: "Emitido",
      montoNeto: 100000,
      montoTotal: 119000,
      pdfUrl: null,
      xmlUrl: null,
      rutEmisor: "78023530-6",
      codEmp: "433",
    }

    const doc2: DteDocumentRow = { ...doc1 }

    const hash1 = computeDocumentHash(doc1)
    const hash2 = computeDocumentHash(doc2)

    expect(hash1).toHaveLength(64) // SHA-256 hex
    expect(hash1).toBe(hash2)
  })

  it("produces different hash when document attributes change", () => {
    const base: DteDocumentRow = {
      rowId: "12715",
      estadoSii: "pendiente_envio",
      fecha: "2026-01-15",
      tipoDoc: "33",
      folio: 12715,
      razonSocial: "Proveedor SpA",
      estado: "Emitido",
      montoNeto: 100000,
      montoTotal: 119000,
      pdfUrl: null,
      xmlUrl: null,
      rutEmisor: null,
      codEmp: "433",
    }

    const updated: DteDocumentRow = {
      ...base,
      estadoSii: "aceptado", // Estado cambió
    }

    expect(computeDocumentHash(base)).not.toBe(computeDocumentHash(updated))
  })
})
