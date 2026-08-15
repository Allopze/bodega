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
import { preventionCapaActions } from "@/db/schema"

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
  const values = vi.fn().mockReturnValue({
    returning: vi.fn().mockResolvedValue([{
      id: "capa-1",
      status: "pending",
      version: 1,
    }]),
  })
  mockInsert.mockReturnValue({ values })
  mockTransaction.mockImplementation(async (callback) => callback({ update: mockUpdate, insert: mockInsert }))
  return { values, set }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockGetPpa.mockResolvedValue(currentPpa)
})

describe("reviewPpa", () => {
  it("crea una acción estructurada al autorizar un PPA detenido", async () => {
    const { values, set } = mockTransactionResult({ ...currentPpa, estado: "en_correccion" })

    await reviewPpa({
      ppaId: "ppa-1", fuiAlLugar: true, decision: "autorizado",
      accionCorrectiva: "Bloquear el equipo y reforzar el procedimiento.",
      responsibleRole: "admin_contrato", responsible: "Juan Soto",
      dueDate: "2026-07-22", priority: "alta",
    }, "user-1", ["faena-1"])

    // D11: la acción se escribe en `prevention_capa_actions`, con su
    // vocabulario. Antes esto asertaba la fila espejo `ppa_corrective_actions`.
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: "ppa",
      sourceId: "ppa-1",
      worksiteId: "faena-1",
      actionDescription: "Bloquear el equipo y reforzar el procedimiento.",
      responsibleRole: "admin_contrato",
      responsibleSnapshot: "Juan Soto",
      targetDate: "2026-07-22",
      priority: "high",
      status: "pending",
    }))
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      decision: "autorizado",
      estado: "en_correccion",
    }))
  })

  it("no crea una acción cuando el PPA se rechaza", async () => {
    mockTransactionResult({ ...currentPpa, estado: "rechazado" })

    await reviewPpa({
      ppaId: "ppa-1", fuiAlLugar: false, decision: "rechazado",
    }, "user-1", ["faena-1"])

    expect(mockInsert).not.toHaveBeenCalledWith(preventionCapaActions)
    // Sólo el historial del PPA. D11: ya no hay fila espejo que insertar.
    expect(mockInsert).toHaveBeenCalledTimes(1)
  })
})
