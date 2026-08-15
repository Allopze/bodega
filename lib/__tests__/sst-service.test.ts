/**
 * Unit tests for SST service functions (DB-backed).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockSelect = vi.hoisted(() => vi.fn())
const mockInsert = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockDelete = vi.hoisted(() => vi.fn())
const mockTransaction = vi.hoisted(() => vi.fn())
const mockGetDefinition = vi.hoisted(() => vi.fn())
const mockGetApplicableItems = vi.hoisted(() => vi.fn())
const mockCreateCapa = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    transaction: mockTransaction,
  },
}))
vi.mock("@/lib/sst/definitions/index", () => ({
  getDefinition: mockGetDefinition,
}))
vi.mock("@/lib/sst/checklist", () => ({
  getApplicableItems: mockGetApplicableItems,
}))
vi.mock("@/lib/services/prevention-capa", () => ({
  createCapaActionWithClient: mockCreateCapa,
  updateCapaActionWithClient: vi.fn(),
  transitionCapaActionWithClient: vi.fn(),
}))
vi.mock("@/lib/id", () => ({ nanoid: vi.fn(() => "sst-nanoid-123") }))
vi.mock("@/lib/sst/date", () => ({ addDays: vi.fn((_d: string, n: number) => `2026-02-${1 + n}`) }))

import {
  getEvaluation,
  listEvaluations,
  markFollowup,
  getFollowups,
  getDashboardStats,
  deleteEvaluation,
  saveActionPlanItem,
  deleteActionPlanItem,
} from "@/lib/services/sst"

function setupSelectChain() {
  mockSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            offset: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      innerJoin: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      }),
    }),
  })
}

function transactionQuery(result: unknown) {
  const chain: Record<string, unknown> = {}
  for (const method of ["from", "where", "for"]) {
    chain[method] = vi.fn().mockReturnValue(chain)
  }
  chain.limit = vi.fn().mockResolvedValue(result)
  chain.then = (onfulfilled?: (value: unknown) => unknown) => Promise.resolve(result).then(onfulfilled)
  return chain
}

describe("getEvaluation", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns null if worksiteIds is empty array", async () => {
    const result = await getEvaluation("eval-1", [])
    expect(result).toBeNull()
  })

  it("returns evaluation if found with scope='all'", async () => {
    const evalRow = { id: "eval-1", worksiteId: "ws-1", estado: "borrador" }
    setupSelectChain()
    // Override the chain to return the eval
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([evalRow]),
        }),
      }),
    })
    const result = await getEvaluation("eval-1", "all")
    expect(result).toEqual(evalRow)
  })

  it("returns null if evaluation not found", async () => {
    setupSelectChain()
    const result = await getEvaluation("nonexistent", "all")
    expect(result).toBeNull()
  })

  it("returns null if evaluation not in scope", async () => {
    const evalRow = { id: "eval-1", worksiteId: "ws-other", estado: "borrador" }
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([evalRow]),
        }),
      }),
    })
    const result = await getEvaluation("eval-1", ["ws-1"])
    expect(result).toBeNull()
  })
})

describe("listEvaluations", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns empty array if worksiteIds is empty", async () => {
    const result = await listEvaluations({ worksiteIds: [] })
    expect(result).toEqual([])
  })

  it("returns empty array for empty filters", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  offset: vi.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        }),
      }),
    })
    const result = await listEvaluations({ worksiteIds: "all" })
    expect(result).toEqual([])
  })

  it("applies tipo filter", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  offset: vi.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        }),
      }),
    })
    const result = await listEvaluations({ worksiteIds: "all", tipo: "seguimiento" })
    expect(result).toEqual([])
  })
})

describe("getDashboardStats", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns zero stats for empty worksiteIds", async () => {
    const result = await getDashboardStats([])
    expect(result).toEqual({ total: 0, borrador: 0, cerrado: 0, habilitados: 0, noHabilitados: 0, pendingFollowups: 0 })
  })

  it("queries stats for scope='all'", async () => {
    // Mock the chain for stats query
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{
          total: 5, borrador: 2, cerrado: 3, habilitados: 4, noHabilitados: 1,
        }]),
      }),
    })
    // Mock the chain for followups query
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ pending: 2 }]),
        }),
      }),
    })
    const result = await getDashboardStats("all")
    expect(result.total).toBe(5)
    expect(result.borrador).toBe(2)
    expect(result.cerrado).toBe(3)
    expect(result.pendingFollowups).toBe(2)
  })
})

describe("deleteEvaluation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReset()
    mockTransaction.mockReset()
  })

  it("throws if evaluation not found", async () => {
    mockSelect.mockReturnValue(transactionQuery([]))
    mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn({
      select: mockSelect,
    }))
    await expect(deleteEvaluation("nonexistent", "all", "actor-1")).rejects.toThrow("Evaluación no encontrada")
  })

  it("deletes evaluation and related data in transaction", async () => {
    const evalRow = { id: "eval-1", worksiteId: "ws-1", estado: "borrador" }
    mockSelect
      .mockReturnValueOnce(transactionQuery([evalRow]))
      .mockReturnValueOnce(transactionQuery([]))

    mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        select: mockSelect,
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      }
      return fn(tx as unknown as Record<string, unknown>)
    })

    await deleteEvaluation("eval-1", "all", "actor-1")
    expect(mockTransaction).toHaveBeenCalled()
  })
})

describe("markFollowup", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReset()
  })

  it("throws if followup not found", async () => {
    // db.select().from().where().limit() returns empty
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    })
    await expect(markFollowup("followup-1", { realizado: true, cumple: true, observaciones: "ok" }, "all")).rejects.toThrow("Seguimiento no encontrado")
  })
})

describe("getFollowups", () => {
  beforeEach(() => vi.clearAllMocks())

  it("throws if evaluation not found", async () => {
    setupSelectChain()
    await expect(getFollowups("nonexistent", "all")).rejects.toThrow("Evaluación no encontrada")
  })
})

describe("saveActionPlanItem", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateCapa.mockResolvedValue({ id: "capa-test", version: 1, status: "pending" })
    mockTransaction.mockImplementation(async (callback) => callback({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
    }))
  })

  it("allows adding an action-plan item if evaluation is closed", async () => {
    // getEvaluation finds a closed evaluation in scope
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: "eval-1", worksiteId: "ws-1", estado: "cerrado" }]),
        }),
      }),
    })
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    })
    const result = await saveActionPlanItem({
      evaluationId: "eval-1", n: 1, hallazgo: "test", accion: "fix",
      responsable: "admin", plazo: "2026-01-01", estado: "pendiente",
    }, "all", "user-1")

    // D11: el ítem es su CAPA; ya no hay fila espejo con id propio.
    expect(result.id).toBe("capa-test")
  })
})

describe("deleteActionPlanItem", () => {
  beforeEach(() => vi.clearAllMocks())

  it("throws if item not found", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    })
    await expect(deleteActionPlanItem("nonexistent", "all", "user-1")).rejects.toThrow("Ítem del plan de acción no encontrado")
  })
})
