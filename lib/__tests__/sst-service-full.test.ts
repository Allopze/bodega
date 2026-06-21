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
vi.mock("@/lib/sst/compliance", () => ({
  calculateCompliance: vi.fn(() => ({ percentage: 100 })),
  getAutomaticResultadoFinal: vi.fn(() => "habilitado_autonomo"),
  classifyEfficacy: vi.fn(() => ({ classification: "destacado" })),
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
  createEvaluation,
  saveResponses,
  closeEvaluation,
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
  chain.then = (onfulfilled?: (value: unknown) => unknown) => Promise.resolve(result).then(onfulfilled)
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

  it("returns followups if evaluation found", async () => {
    // getEvaluation (outside tx)
    mockSelectFn.mockReturnValueOnce(chainResultFirst({ id: "e1", worksiteId: "ws-1" }))
    // select from sstScheduledFollowups
    mockSelectFn.mockReturnValueOnce(chainResult([{ id: "f1", evaluationId: "e1", instancia: "dia_7" }]))

    const result = await getFollowups("e1", "all")
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe("f1")
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

  it("updates existing item when it exists", async () => {
    // assertEditable -> borrador
    mockSelectFn.mockReturnValueOnce(chainResultFirst({ estado: "borrador" }))
    // getEvaluation -> found
    mockSelectFn.mockReturnValueOnce(chainResultFirst({ id: "e1", worksiteId: "ws-1", estado: "borrador" }))
    // existing check -> found
    mockSelectFn.mockReturnValueOnce(chainResultFirst({ id: "plan-1", evaluationId: "e1", n: 1 }))
    // update
    mockUpdateFn.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) })
    // select after update
    mockSelectFn.mockReturnValueOnce(chainResultFirst({ id: "plan-1", evaluationId: "e1", n: 1, hallazgo: "New hallazgo" }))

    const result = await saveActionPlanItem({
      evaluationId: "e1", n: 1, hallazgo: "New hallazgo", accion: "Acción",
      responsable: "Admin", plazo: "2026-06-01", estado: "pendiente",
    }, "all")
    expect(result.hallazgo).toBe("New hallazgo")
  })

  it("throws if evaluation not found inside assertEditable", async () => {
    // assertEditable select returns null
    mockSelectFn.mockReturnValueOnce(chainResultFirst(null))
    await expect(saveActionPlanItem({
      evaluationId: "nonexistent", n: 1, hallazgo: "h", accion: "a",
      responsable: "admin", plazo: "2026-06-01", estado: "pendiente",
    }, "all")).rejects.toThrow("no encontrada")
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

describe("createEvaluation", () => {
  beforeEach(() => vi.clearAllMocks())

  it("creates a new draft evaluation", async () => {
    const mockTx = {
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    }
    mockTransactionFn.mockImplementation(async (fn) => fn(mockTx))
    mockSelectFn.mockReturnValue(chainResultFirst({ id: "sst-nanoid-123", worksiteId: "ws-1", definicionCode: "trabajador_nuevo" }))

    const result = await createEvaluation({
      worksiteId: "ws-1",
      workerId: "worker-123",
      definicionCode: "trabajador_nuevo",
      tipo: "nuevo",
      fechaEvaluacion: "2026-06-20",
      cargos: ["Conductor"],
    }, "usr-1")

    expect(result.id).toBe("sst-nanoid-123")
    expect(mockTransactionFn).toHaveBeenCalled()
    expect(mockTx.insert).toHaveBeenCalled()
  })

  it("creates scheduled followups for seguimiento type", async () => {
    const mockTx = {
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    }
    mockTransactionFn.mockImplementation(async (fn) => fn(mockTx))
    mockSelectFn.mockReturnValue(chainResultFirst({ id: "sst-nanoid-123", worksiteId: "ws-1", definicionCode: "trabajador_nuevo" }))

    const result = await createEvaluation({
      worksiteId: "ws-1",
      workerId: "worker-123",
      definicionCode: "trabajador_nuevo",
      tipo: "seguimiento",
      fechaEvaluacion: "2026-06-20",
      cargos: ["Conductor"],
    }, "usr-1")

    expect(result.id).toBe("sst-nanoid-123")
    expect(mockTx.insert).toHaveBeenCalledTimes(5) // 1 evaluation + 4 followups
  })
})

describe("saveResponses", () => {
  beforeEach(() => vi.clearAllMocks())

  it("throws if worksiteIds has no access to worksite", async () => {
    mockSelectFn.mockReturnValue(chainResultFirst({ id: "eval-1", worksiteId: "ws-2" }))
    await expect(saveResponses("eval-1", [], ["ws-1"])).rejects.toThrow("sin acceso")
  })

  it("inserts new response inside transaction", async () => {
    // getEvaluation (outside transaction) returns evaluation
    mockSelectFn.mockReturnValueOnce(chainResultFirst({ id: "eval-1", worksiteId: "ws-1", estado: "borrador" }))

    const mockTxSelect = vi.fn()
    const mockTxInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })
    const mockTx = {
      select: mockTxSelect,
      insert: mockTxInsert,
    }
    mockTransactionFn.mockImplementation(async (fn) => fn(mockTx))

    // inside tx: assertEditable select -> [{ estado: "borrador" }]
    mockTxSelect.mockReturnValueOnce(chainResultFirst({ estado: "borrador" }))
    // inside tx loop: select existing response -> empty []
    mockTxSelect.mockReturnValueOnce(chainResultFirst(null))

    await saveResponses("eval-1", [{
      evaluationId: "eval-1", seccionId: "sec1", itemId: "item1", estado: "cumple",
    }], "all")

    expect(mockTransactionFn).toHaveBeenCalled()
    expect(mockTxInsert).toHaveBeenCalled()
  })

  it("updates existing response inside transaction", async () => {
    mockSelectFn.mockReturnValueOnce(chainResultFirst({ id: "eval-1", worksiteId: "ws-1", estado: "borrador" }))

    const mockTxSelect = vi.fn()
    const mockTxUpdate = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) })
    const mockTx = {
      select: mockTxSelect,
      update: mockTxUpdate,
    }
    mockTransactionFn.mockImplementation(async (fn) => fn(mockTx))

    // assertEditable select
    mockTxSelect.mockReturnValueOnce(chainResultFirst({ estado: "borrador" }))
    // select existing response -> returns existing response row
    mockTxSelect.mockReturnValueOnce(chainResultFirst({ id: "resp-123" }))

    await saveResponses("eval-1", [{
      evaluationId: "eval-1", seccionId: "sec1", itemId: "item1", estado: "cumple",
    }], "all")

    expect(mockTransactionFn).toHaveBeenCalled()
    expect(mockTxUpdate).toHaveBeenCalled()
  })
})

describe("closeEvaluation", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns evaluation as-is if already cerrado", async () => {
    // getEvaluation returns closed eval
    mockSelectFn.mockReturnValue(chainResultFirst({ id: "eval-1", worksiteId: "ws-1", estado: "cerrado" }))

    const result = await closeEvaluation("eval-1", {
      evaluationId: "eval-1",
      hasCriticalDeviation: false,
      hasReincidence: false,
    }, "all")

    expect(result.estado).toBe("cerrado")
    expect(mockTransactionFn).not.toHaveBeenCalled()
  })

  it("closes evaluation, computes compliance / results for trabajador_nuevo", async () => {
    // getEvaluation (outside tx)
    mockSelectFn.mockReturnValueOnce(chainResultFirst({
      id: "eval-1", worksiteId: "ws-1", estado: "borrador", definicionCode: "trabajador_nuevo", definicionVersion: "1.0", cargosJson: ["Conductor"]
    }))

    const mockTxSelect = vi.fn()
    const mockTxUpdate = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) })
    const mockTx = {
      select: mockTxSelect,
      update: mockTxUpdate,
    }
    mockTransactionFn.mockImplementation(async (fn) => fn(mockTx))

    // inside tx: assertEditable
    mockTxSelect.mockReturnValueOnce(chainResultFirst({ estado: "borrador" }))
    // inside tx: allResponses select
    mockTxSelect.mockReturnValueOnce(chainResult([{ seccionId: "sec1", itemId: "item1", estado: "cumple" }]))
    // inside tx: select after update (returns updated eval)
    mockTxSelect.mockReturnValueOnce(chainResultFirst({ id: "eval-1", estado: "cerrado", resultadoFinal: "habilitado_autonomo" }))

    const result = await closeEvaluation("eval-1", {
      evaluationId: "eval-1",
      hasCriticalDeviation: false,
      hasReincidence: false,
      restricciones: "Ninguna",
      observacionesGenerales: "Todo ok",
    }, "all")

    expect(result.estado).toBe("cerrado")
    expect(result.resultadoFinal).toBe("habilitado_autonomo")
    expect(mockTransactionFn).toHaveBeenCalled()
    expect(mockTxUpdate).toHaveBeenCalled()
  })

  it("closes evaluation and computes efficacy for trabajador_antiguo", async () => {
    // getEvaluation (outside tx)
    mockSelectFn.mockReturnValueOnce(chainResultFirst({
      id: "eval-1", worksiteId: "ws-1", estado: "borrador", definicionCode: "trabajador_antiguo", definicionVersion: "1.0", cargosJson: ["Conductor"]
    }))

    const mockTxSelect = vi.fn()
    const mockTxUpdate = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) })
    const mockTx = {
      select: mockTxSelect,
      update: mockTxUpdate,
    }
    mockTransactionFn.mockImplementation(async (fn) => fn(mockTx))

    // inside tx: assertEditable
    mockTxSelect.mockReturnValueOnce(chainResultFirst({ estado: "borrador" }))
    // inside tx: allResponses select
    mockTxSelect.mockReturnValueOnce(chainResult([
      { seccionId: "procedimientos_criticos", itemId: "c1", estado: "no_cumple" }
    ]))
    // inside tx: select after update (returns updated eval with resultadoEficacia)
    mockTxSelect.mockReturnValueOnce(chainResultFirst({ id: "eval-1", estado: "cerrado", resultadoEficacia: "destacado" }))

    const result = await closeEvaluation("eval-1", {
      evaluationId: "eval-1",
      hasCriticalDeviation: false,
      hasReincidence: false,
    }, "all")

    expect(result.resultadoEficacia).toBe("destacado")
    expect(mockTxUpdate).toHaveBeenCalled()
  })
})
