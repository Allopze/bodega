import { describe, expect, it, vi } from "vitest"

const mockSelect = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({ db: { select: mockSelect } }))

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
    const rows = [{ prefix: "AJU", year: 2026, nextValue: 4 }]
    const orderBy = vi.fn().mockResolvedValue(rows)
    mockSelect.mockReturnValue({ from: vi.fn(() => ({ orderBy })) })
    const { listCodeSequences } = await import("@/lib/code-sequences")

    await expect(listCodeSequences()).resolves.toEqual(rows)
    expect(orderBy).toHaveBeenCalledOnce()
  })
})
