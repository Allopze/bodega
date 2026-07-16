import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGetPpa = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockInsert = vi.hoisted(() => vi.fn())
const mockTransaction = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({
  db: { transaction: mockTransaction },
}))

vi.mock("@/lib/services/ppa-module/calculos", () => ({
  getPpa: mockGetPpa,
  listPpa: vi.fn(),
}))

import { reviewPpa } from "@/lib/services/ppa-module/reportes"

const currentPpa = {
  id: "ppa-1",
  worksiteId: "faena-1",
  estado: "detenido",
}

function mockTransactionResult(updated: Record<string, unknown>) {
  const returning = vi.fn().mockResolvedValue([updated])
  const where = vi.fn().mockReturnValue({ returning })
  const set = vi.fn().mockReturnValue({ where })
  mockUpdate.mockReturnValue({ set })
  const values = vi.fn().mockResolvedValue(undefined)
  mockInsert.mockReturnValue({ values })
  mockTransaction.mockImplementation(async (callback) => callback({ update: mockUpdate, insert: mockInsert }))
  return { values }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockGetPpa.mockResolvedValue(currentPpa)
})

describe("reviewPpa", () => {
  it("crea una acción estructurada al autorizar un PPA detenido", async () => {
    const { values } = mockTransactionResult({ ...currentPpa, estado: "autorizado" })

    await reviewPpa({
      ppaId: "ppa-1", fuiAlLugar: true, decision: "autorizado",
      accionCorrectiva: "Bloquear el equipo y reforzar el procedimiento.",
      responsibleRole: "admin_contrato", responsible: "Juan Soto",
      dueDate: "2026-07-22", priority: "alta",
    }, "user-1", ["faena-1"])

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      ppaId: "ppa-1",
      worksiteId: "faena-1",
      description: "Bloquear el equipo y reforzar el procedimiento.",
      responsibleRole: "admin_contrato",
      responsible: "Juan Soto",
      dueDate: "2026-07-22",
      priority: "alta",
      status: "pendiente",
    }))
  })

  it("no crea una acción cuando el PPA se rechaza", async () => {
    mockTransactionResult({ ...currentPpa, estado: "rechazado" })

    await reviewPpa({
      ppaId: "ppa-1", fuiAlLugar: false, decision: "rechazado",
    }, "user-1", ["faena-1"])

    expect(mockInsert).not.toHaveBeenCalled()
  })
})
