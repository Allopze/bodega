import { beforeEach, describe, expect, it, vi } from "vitest"

const mockSelect = vi.hoisted(() => vi.fn())
const mockExecute = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({ db: { select: mockSelect, execute: mockExecute } }))

describe("nextCodeTx", () => {
  it("normalizes driver result shapes and reserves SOL independently of the requested year", async () => {
    const { nextCodeTx } = await import("@/lib/code-sequences")
    const execute = vi.fn()
      .mockResolvedValueOnce([{ next_document_code: 42 }])
      .mockResolvedValueOnce({ rows: [{ next_document_code: 7 }] })
    const tx = { execute }

    await expect(nextCodeTx(tx as never, "SOL", 2027)).resolves.toBe("SOL-0042")
    await expect(nextCodeTx(tx as never, "OC", 2027)).resolves.toBe("OC-2027-0007")
  })

  it("fails closed when the database does not reserve a sequence value", async () => {
    const { nextCodeTx } = await import("@/lib/code-sequences")
    await expect(nextCodeTx({ execute: vi.fn().mockResolvedValue({ rows: [] }) } as never, "AJU", 2026))
      .rejects.toThrow("Failed to reserve next code for AJU-2026")
  })

  it("lists persisted folios in deterministic prefix/year order", async () => {
    mockExecute.mockResolvedValueOnce([
      { prefix: "AJU", year: "2026", next_value: "4" },
    ])
    const { listCodeSequences } = await import("@/lib/code-sequences")

    await expect(listCodeSequences()).resolves.toEqual([
      { prefix: "AJU", year: 2026, nextValue: 4, updatedAt: "" },
    ])
    expect(mockExecute).toHaveBeenCalledOnce()
  })
})

/**
 * FOL-001 (auditoría 2026-09-14): la corrección administrativa de folios sólo
 * validaba `nextValue >= 1`. Fijar la serie de OC 2026 en 5 con la OC-2026-0017
 * ya emitida era aceptado, y el índice único de `code` convertía eso en fallos
 * de emisión diferidos, lejos de su causa. La guardia lee el piso real de la
 * serie en los documentos emitidos, no en la secuencia —que es justamente lo
 * que se está corrigiendo—.
 */
describe("setCodeSequenceNextValue — FOL-001", () => {
  beforeEach(() => vi.resetAllMocks())

  it("rechaza retroceder la serie por debajo del último folio ya emitido", async () => {
    // Único execute esperado: el que calcula el piso. El setval no debe correr.
    mockExecute.mockResolvedValueOnce([{ max_seq: "17" }])
    const { setCodeSequenceNextValue } = await import("@/lib/code-sequences")

    await expect(setCodeSequenceNextValue({ prefix: "OC", year: 2026, nextValue: 5 }))
      .rejects.toThrow("La serie OC-2026 ya emitió el folio 17: el siguiente folio debe ser 18 o mayor")
    expect(mockExecute).toHaveBeenCalledOnce()
  })

  it("rechaza también reemitir exactamente el último folio emitido", async () => {
    mockExecute.mockResolvedValueOnce([{ max_seq: 17 }])
    const { setCodeSequenceNextValue } = await import("@/lib/code-sequences")

    await expect(setCodeSequenceNextValue({ prefix: "OC", year: 2026, nextValue: 17 }))
      .rejects.toThrow("debe ser 18 o mayor")
  })

  it("permite adelantar la serie por encima de lo emitido, que es el caso legítimo de desincronización", async () => {
    mockExecute
      .mockResolvedValueOnce([{ max_seq: 17 }])            // piso emitido
      .mockResolvedValueOnce([{ next_value: 3 }])          // valor previo de la secuencia
      .mockResolvedValueOnce([{ next_document_code: 3 }])  // crea la secuencia si falta
      .mockResolvedValueOnce([{ setval: 24 }])             // setval
    const { setCodeSequenceNextValue } = await import("@/lib/code-sequences")

    await expect(setCodeSequenceNextValue({ prefix: "OC", year: 2026, nextValue: 25 }))
      .resolves.toEqual({ before: 3, after: 25 })
    expect(mockExecute).toHaveBeenCalledTimes(4)
  })

  it("no toca una serie cuyo prefijo no está registrado, porque no puede verificar el piso", async () => {
    const { setCodeSequenceNextValue } = await import("@/lib/code-sequences")

    await expect(setCodeSequenceNextValue({ prefix: "XYZ", year: 2026, nextValue: 5 }))
      .rejects.toThrow("No hay una serie de documentos registrada para el prefijo XYZ")
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
