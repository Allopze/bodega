/**
 * Unit tests for SST service — DB-backed functions with proper mock chains.
 * Tests cover: getEvaluation, listEvaluations, getDashboardStats,
 * deleteEvaluation, markFollowup, getFollowups, saveActionPlanItem,
 * deleteActionPlanItem with happy paths and edge cases.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mock DB ──────────────────────────────────────────────────────────────────
const mockSelectFn = vi.fn()
const mockInsertFn = vi.fn()
const mockUpdateFn = vi.fn()
const mockDeleteFn = vi.fn()
const mockTransactionFn = vi.fn()

vi.mock("@/db", () => ({
  db: {
    select: (...args: unknown[]) => mockSelectFn(...args),
    insert: (...args: unknown[]) => mockInsertFn(...args),
    update: (...args: unknown[]) => mockUpdateFn(...args),
    delete: (...args: unknown[]) => mockDeleteFn(...args),
    transaction: (...args: unknown[]) => mockTransactionFn(...args),
  },
}))
vi.mock("@/lib/id", () => ({ nanoid: vi.fn(() => "sst-nanoid-123") }))
vi.mock("@/lib/sst/date", () => ({ addDays: vi.fn((_d: string, n: number) => `2026-02-${1 + n}`) }))
vi.mock("@/lib/sst/definitions/index", () => ({
  getDefinition: vi.fn(() => ({ version: "1.0", sections: [] })),
}))
vi.mock("@/lib/sst/checklist", () => ({
  getApplicableItems: vi.fn(() => []),
}))

import {
  getEvaluation,
  listEvaluations,
  getDashboardStats,
  deleteEvaluation,
  markFollowup,
  getFollowups,
  saveActionPlanItem,
  deleteActionPlanItem,
} from "@/lib/services/sst"

// ── Helper: build a drizzle query chain mock ─────────────────────────────────

function chainResult(result: unknown) {
  const chain: Record<string, unknown> = {}
  const methods = ["from", "where", "limit", "offset", "orderBy", "innerJoin", "leftJoin", "for", "set"]
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  // Terminal methods return promises
  chain.limit = vi.fn().mockResolvedValue(result)
  chain.offset = vi.fn().mockResolvedValue(result)
  chain.then = undefined // not a thenable
  return chain
}

function chainResultFirst(row: unknown) {
  return chainResult(row ? [row] : [])
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("getEvaluation", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns null for empty worksiteIds", async () => {
    const result = await getEvaluation("e1", [])
    expect(result).toBeNull()
  })

  it("returns evaluation when found (scope all)", async () => {
    mockSelectFn.mockReturnValue(chainResultFirst({ id: "e1", worksiteId: "ws-1", estado: "borrador" }))
    const result = await getEvaluation("e1", "all")
    expect(result).toEqual(expect.objectContaining({ id: "e1" }))
  })

  it("returns null when not found", async () => {
    mockSelectFn.mockReturnValue(chainResultFirst(null))
    const result = await getEvaluation("missing", "all")
    expect(result).toBeNull()
  })

  it("returns null when out of scope", async () => {
    mockSelectFn.mockReturnValue(chainResultFirst({ id: "e1", worksiteId: "ws-2", estado: "borrador" }))
    const result = await getEvaluation("e1", ["ws-1"])
    expect(result).toBeNull()
  })
})

describe("listEvaluations", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns empty for empty worksiteIds", async () => {
    const result = await listEvaluations({ worksiteIds: [] })
    expect(result).toEqual([])
  })

  it("returns mapped results", async () => {
    mockSelectFn.mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  offset: vi.fn().mockResolvedValue([{
                    id: "e1", worksiteId: "ws-1", workerId: "w-1", createdBy: "u-1",
                    definicionCode: "trabajador_nuevo", definicionVersion: "1.0",
                    tipo: "ingreso", motivo: null, motivoOtro: null, descripcionEvento: null,
                    equipoPatente: null, fechaEvaluacion: "2026-01-15", estado: "borrador",
                    cargosJson: [], resultadoFinal: null, porcentajeCumplimiento: null,
                    resultadoEficacia: null, restricciones: null, observacionesGenerales: null,
                    schemaJson: null, createdAt: "2026-01-15", updatedAt: "2026-01-15",
                    workerFirstName: "Pedro", workerLastName: "Rojas", worksiteName: "Faena Sur",
                  }]),
                }),
              }),
            }),
          }),
        }),
      }),
    })
    const result = await listEvaluations({ worksiteIds: "all" })
    expect(result).toHaveLength(1)
    expect(result[0]!.workerName).toBe("Pedro Rojas")
    expect(result[0]!.worksiteName).toBe("Faena Sur")
  })
})

describe("getDashboardStats", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns zero stats for empty worksiteIds", async () => {
    const result = await getDashboardStats([])
    expect(result).toEqual({ total: 0, borrador: 0, cerrado: 0, habilitados: 0, noHabilitados: 0, pendingFollowups: 0 })
  })

  it("returns stats for scope all", async () => {
    // Stats query
    mockSelectFn.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{
          total: 10, borrador: 3, cerrado: 7, habilitados: 6, noHabilitados: 4,
        }]),
      }),
    })
    // Followups query
    mockSelectFn.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ pending: 2 }]),
        }),
      }),
    })
    const result = await getDashboardStats("all")
    expect(result.total).toBe(10)
    expect(result.pendingFollowups).toBe(2)
  })
})

describe("deleteEvaluation", () => {
  beforeEach(() => vi.clearAllMocks())

  it("throws if evaluation not found", async () => {
    mockSelectFn.mockReturnValue(chainResultFirst(null))
    await expect(deleteEvaluation("missing", "all")).rejects.toThrow("no encontrada")
  })

  it("deletes in transaction", async () => {
    mockSelectFn.mockReturnValue(chainResultFirst({ id: "e1", worksiteId: "ws-1", estado: "borrador" }))
    mockTransactionFn.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn({
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    } as unknown as Record<string, unknown>))
    await deleteEvaluation("e1", "all")
    expect(mockTransactionFn).toHaveBeenCalled()
  })
})

describe("markFollowup", () => {
  beforeEach(() => vi.clearAllMocks())

  it("throws if followup not found", async () => {
    mockSelectFn.mockReturnValue(chainResultFirst(null))
    await expect(markFollowup("f1", { realizado: true, cumple: true, observaciones: "ok" }, "all")).rejects.toThrow("Seguimiento no encontrado")
  })
})

describe("getFollowups", () => {
  beforeEach(() => vi.clearAllMocks())

  it("throws if evaluation not found", async () => {
    mockSelectFn.mockReturnValue(chainResultFirst(null))
    await expect(getFollowups("missing", "all")).rejects.toThrow("no encontrada")
  })
})

describe("saveActionPlanItem", () => {
  beforeEach(() => vi.clearAllMocks())

  it("throws if evaluation is cerrado", async () => {
    mockSelectFn.mockReturnValue(chainResultFirst({ estado: "cerrado" }))
    await expect(saveActionPlanItem({
      evaluationId: "e1", n: 1, hallazgo: "h", accion: "a",
      responsable: "admin", plazo: "2026-06-01", estado: "pendiente",
    }, "all")).rejects.toThrow("cerrada")
  })

  it("inserts new item when not existing", async () => {
    // assertEditable → evaluation is borrador
    mockSelectFn.mockReturnValueOnce(chainResultFirst({ estado: "borrador" }))
    // getEvaluation → evaluation exists
    mockSelectFn.mockReturnValueOnce(chainResultFirst({ id: "e1", worksiteId: "ws-1", estado: "borrador" }))
    // existing plan item → none
    mockSelectFn.mockReturnValueOnce(chainResultFirst(null))
    // insert
    mockInsertFn.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })
    // select after insert
    mockSelectFn.mockReturnValueOnce(chainResultFirst({ id: "plan-1", evaluationId: "e1", n: 1 }))

    const result = await saveActionPlanItem({
      evaluationId: "e1", n: 1, hallazgo: "Hallazgo", accion: "Acción",
      responsable: "Admin", plazo: "2026-06-01", estado: "pendiente",
    }, "all")
    expect(result.id).toBe("plan-1")
  })
})

describe("deleteActionPlanItem", () => {
  beforeEach(() => vi.clearAllMocks())

  it("throws if item not found", async () => {
    mockSelectFn.mockReturnValue(chainResultFirst(null))
    await expect(deleteActionPlanItem("missing", "all")).rejects.toThrow("no encontrado")
  })

  it("deletes when item found", async () => {
    // select item → found
    mockSelectFn.mockReturnValueOnce(chainResultFirst({ evaluationId: "e1" }))
    // assertEditable → borrador
    mockSelectFn.mockReturnValueOnce(chainResultFirst({ estado: "borrador" }))
    // getEvaluation → found
    mockSelectFn.mockReturnValueOnce(chainResultFirst({ id: "e1", worksiteId: "ws-1", estado: "borrador" }))
    // delete
    mockDeleteFn.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })

    await deleteActionPlanItem("plan-1", "all")
    expect(mockDeleteFn).toHaveBeenCalled()
  })
})
