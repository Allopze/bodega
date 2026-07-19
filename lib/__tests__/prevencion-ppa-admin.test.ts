/**
 * Unit tests for prevencion (SST) + prevencion/ppa admin actions.
 *
 * Covers:
 *  1. Permission denied (guardPermission pattern)
 *  2. Worksite scope denied
 *  3. Service error propagation
 *  4. Happy paths for list, get, review, close, stats
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockCreateEvaluation = vi.hoisted(() => vi.fn())
const mockListEvaluations = vi.hoisted(() => vi.fn())
const mockGetEvaluation = vi.hoisted(() => vi.fn())
const mockSaveResponses = vi.hoisted(() => vi.fn())
const mockCloseEvaluation = vi.hoisted(() => vi.fn())
const mockListPpa = vi.hoisted(() => vi.fn())
const mockCountPpa = vi.hoisted(() => vi.fn())
const mockGetPpa = vi.hoisted(() => vi.fn())
const mockReviewPpa = vi.hoisted(() => vi.fn())
const mockDeclarePpaCorrection = vi.hoisted(() => vi.fn())
const mockVerifyPpaCorrection = vi.hoisted(() => vi.fn())
const mockAuthorizePpaRestart = vi.hoisted(() => vi.fn())
const mockCancelPpa = vi.hoisted(() => vi.fn())
const mockClosePpa = vi.hoisted(() => vi.fn())
const mockGetPpaStats = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

vi.mock("@/lib/services/sst", () => ({
  createEvaluation: mockCreateEvaluation,
  listEvaluations: mockListEvaluations,
  getEvaluation: mockGetEvaluation,
  saveResponses: mockSaveResponses,
  closeEvaluation: mockCloseEvaluation,
  getDashboardStats: vi.fn().mockResolvedValue({}),
  archiveEvaluationPdf: vi.fn(),
}))

vi.mock("@/lib/services/ppa", () => ({
  listPpa: mockListPpa,
  countPpa: mockCountPpa,
  getPpa: mockGetPpa,
  reviewPpa: mockReviewPpa,
  declarePpaCorrection: mockDeclarePpaCorrection,
  verifyPpaCorrection: mockVerifyPpaCorrection,
  authorizePpaRestart: mockAuthorizePpaRestart,
  cancelPpa: mockCancelPpa,
  closePpa: mockClosePpa,
  getPpaCorrectiveAction: vi.fn(),
  getPpaStats: mockGetPpaStats,
}))

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
      then: (resolve: (v: unknown[]) => void) => Promise.resolve([]).then(resolve),
    })),
  },
}))

function makeSession(perm: string, worksiteIds: string[] = ["ws-1"], isGlobal = false): Session {
  return {
    user: {
      id: "user-1", name: "Prevencionista", email: "prev@chome.cl",
      permissions: [perm], roles: isGlobal ? ["prevencionista"] : ["operador"],
      worksiteIds, isGlobal,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as unknown as Session
}

// ── prevencion (SST) ──────────────────────────────────────────────────────

describe("prevencion SST actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateEvaluation.mockResolvedValue({ id: "eval-1" })
    mockListEvaluations.mockResolvedValue([])
    mockGetEvaluation.mockResolvedValue({ id: "eval-1" })
    mockSaveResponses.mockResolvedValue(undefined)
    mockCloseEvaluation.mockResolvedValue({ id: "eval-1" })
  })

  describe("createEvaluationAction", () => {
    it("denies without sst:create", async () => {
      mockAuthFn.mockResolvedValue(makeSession("other:perm"))
      const { createEvaluationAction } = await import("@/app/(app)/prevencion/actions")
      const r = await createEvaluationAction({ worksiteId: "ws-1", workerId: "w-1" } as Parameters<typeof createEvaluationAction>[0])
      expect(r.ok).toBe(false)
    })

    it("denies scope when worksite not in user scope", async () => {
      mockAuthFn.mockResolvedValue(makeSession("sst:create", ["ws-2"]))
      const { createEvaluationAction } = await import("@/app/(app)/prevencion/actions")
      const r = await createEvaluationAction({ worksiteId: "ws-1", workerId: "w-1", definicionCode: "trabajador_nuevo", tipo: "nuevo", fechaEvaluacion: "2026-07-16", cargos: ["admin_contrato"] } as Parameters<typeof createEvaluationAction>[0])
      expect(r.ok).toBe(false); expect(r.message).toContain("No tienes acceso")
    })

    it("creates evaluation for global user", async () => {
      mockAuthFn.mockResolvedValue(makeSession("sst:create", [], true))
      // Mock the DB select for worker validation
      const mockFrom = vi.fn().mockReturnThis()
      const mockWhere = vi.fn().mockResolvedValue([{ worksiteId: "ws-1" }])
      const { db } = await import("@/db")
      vi.mocked(db.select).mockReturnValue({ from: mockFrom, where: mockWhere, then: (resolve: (v: unknown[]) => void) => Promise.resolve([{ worksiteId: "ws-1" }]).then(resolve) } as unknown as ReturnType<typeof db.select>)
      const { createEvaluationAction } = await import("@/app/(app)/prevencion/actions")
      const r = await createEvaluationAction({ worksiteId: "ws-1", workerId: "w-1", definicionCode: "trabajador_nuevo", tipo: "nuevo", fechaEvaluacion: "2026-07-16", cargos: ["admin_contrato"] } as Parameters<typeof createEvaluationAction>[0])
      expect(r.ok).toBe(true); expect(r.data?.id).toBe("eval-1")
    })
  })

  describe("listEvaluationsAction", () => {
    it("denies without sst:view", async () => {
      mockAuthFn.mockResolvedValue(makeSession("other:perm"))
      const { listEvaluationsAction } = await import("@/app/(app)/prevencion/actions")
      const r = await listEvaluationsAction()
      expect(r.ok).toBe(false)
    })

    it("lists evaluations on happy path", async () => {
      mockAuthFn.mockResolvedValue(makeSession("sst:view", [], true))
      mockListEvaluations.mockResolvedValue([{ id: "eval-1", workerName: "Juan", worksiteName: "Faena" }])
      const { listEvaluationsAction } = await import("@/app/(app)/prevencion/actions")
      const r = await listEvaluationsAction()
      expect(r.ok).toBe(true); expect(r.data?.evaluations).toHaveLength(1)
    })
  })

  describe("closeEvaluationAction", () => {
    it("denies without sst:close", async () => {
      mockAuthFn.mockResolvedValue(makeSession("sst:create"))
      const { closeEvaluationAction } = await import("@/app/(app)/prevencion/actions")
      const r = await closeEvaluationAction("eval-1", {} as Parameters<typeof closeEvaluationAction>[1])
      expect(r.ok).toBe(false)
    })

    it("closes evaluation on happy path", async () => {
      mockAuthFn.mockResolvedValue(makeSession("sst:close", [], true))
      const { closeEvaluationAction } = await import("@/app/(app)/prevencion/actions")
      const r = await closeEvaluationAction("eval-1", {} as Parameters<typeof closeEvaluationAction>[1])
      expect(r.ok).toBe(true); expect(r.message).toContain("cerrada")
    })

    it("propagates service error", async () => {
      mockAuthFn.mockResolvedValue(makeSession("sst:close", [], true))
      mockCloseEvaluation.mockRejectedValue(new Error("Evaluación ya cerrada"))
      const { closeEvaluationAction } = await import("@/app/(app)/prevencion/actions")
      const r = await closeEvaluationAction("eval-1", {} as Parameters<typeof closeEvaluationAction>[1])
      expect(r.ok).toBe(false); expect(r.message).toContain("ya cerrada")
    })
  })
})

// ── prevencion/ppa admin ──────────────────────────────────────────────────

describe("prevencion PPA admin actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListPpa.mockResolvedValue([])
    mockCountPpa.mockResolvedValue(0)
    mockGetPpa.mockResolvedValue({ id: "ppa-1" })
    mockReviewPpa.mockResolvedValue({ id: "ppa-1" })
    mockDeclarePpaCorrection.mockResolvedValue({ id: "ppa-1" })
    mockVerifyPpaCorrection.mockResolvedValue({ id: "ppa-1" })
    mockAuthorizePpaRestart.mockResolvedValue({ id: "ppa-1" })
    mockCancelPpa.mockResolvedValue({ id: "ppa-1" })
    mockClosePpa.mockResolvedValue({ id: "ppa-1" })
    mockGetPpaStats.mockResolvedValue({ total: 10, aprobados: 8, detenidos: 2 })
  })

  describe("listPpaAction", () => {
    it("denies without ppa:view", async () => {
      mockAuthFn.mockResolvedValue(makeSession("other:perm"))
      const { listPpaAction } = await import("@/app/(app)/prevencion/ppa/actions")
      const r = await listPpaAction()
      expect(r.ok).toBe(false)
    })

    it("lists PPA on happy path", async () => {
      mockAuthFn.mockResolvedValue(makeSession("ppa:view", [], true))
      mockListPpa.mockResolvedValue([{ id: "ppa-1" }])
      mockCountPpa.mockResolvedValue(1)
      const { listPpaAction } = await import("@/app/(app)/prevencion/ppa/actions")
      const r = await listPpaAction()
      expect(r.ok).toBe(true); expect(r.data?.total).toBe(1)
    })
  })

  describe("getPpaAction", () => {
    it("gets PPA by id", async () => {
      mockAuthFn.mockResolvedValue(makeSession("ppa:view", [], true))
      const { getPpaAction } = await import("@/app/(app)/prevencion/ppa/actions")
      const r = await getPpaAction("ppa-1")
      expect(r.ok).toBe(true); expect(r.data?.ppa?.id).toBe("ppa-1")
    })
  })

  describe("reviewPpaAction", () => {
    it("denies without ppa:review", async () => {
      mockAuthFn.mockResolvedValue(makeSession("ppa:view"))
      const { reviewPpaAction } = await import("@/app/(app)/prevencion/ppa/actions")
      const r = await reviewPpaAction({ ppaId: "ppa-1", fuiAlLugar: true, decision: "autorizado" })
      expect(r.ok).toBe(false)
    })

    it("reviews PPA on happy path", async () => {
      mockAuthFn.mockResolvedValue(makeSession("ppa:review", [], true))
      mockReviewPpa.mockResolvedValue({ id: "ppa-1" })
      const { reviewPpaAction } = await import("@/app/(app)/prevencion/ppa/actions")
      const r = await reviewPpaAction({ ppaId: "ppa-1", fuiAlLugar: true, decision: "autorizado", accionCorrectiva: "Se verificó EPP completo", responsibleRole: "prevencionista_faena", responsible: "Juan Pérez", dueDate: "2026-08-01", priority: "alta" })
      expect(r.ok).toBe(true)
    })

    it("propagates service error", async () => {
      mockAuthFn.mockResolvedValue(makeSession("ppa:review", [], true))
      mockReviewPpa.mockRejectedValue(new Error("PPA no encontrado"))
      const { reviewPpaAction } = await import("@/app/(app)/prevencion/ppa/actions")
      const r = await reviewPpaAction({
        ppaId: "ppa-1", fuiAlLugar: true, decision: "correccion",
        accionCorrectiva: "Se necesita corrección", responsibleRole: "prevencionista_faena",
        responsible: "Ana Pérez", dueDate: "2026-08-01", priority: "alta",
      })
      expect(r.ok).toBe(false); expect(r.message).toContain("no encontrado")
    })
  })

  describe("closePpaAction", () => {
    it("denies direct closure with the old review permission", async () => {
      mockAuthFn.mockResolvedValue(makeSession("ppa:review", [], true))
      const { closePpaAction } = await import("@/app/(app)/prevencion/ppa/actions")
      const r = await closePpaAction({ ppaId: "ppa-1", expectedPpaVersion: 2, comment: "Cierre verificado" })
      expect(r.ok).toBe(false)
      expect(mockClosePpa).not.toHaveBeenCalled()
    })

    it("closes PPA", async () => {
      mockAuthFn.mockResolvedValue(makeSession("ppa:close", [], true))
      const { closePpaAction } = await import("@/app/(app)/prevencion/ppa/actions")
      const r = await closePpaAction({ ppaId: "ppa-1", expectedPpaVersion: 2, comment: "Cierre verificado" })
      expect(r.ok).toBe(true); expect(r.message).toContain("cerrado")
    })
  })

  describe("PPA segregated workflow actions", () => {
    it("uses a dedicated permission to declare implementation", async () => {
      mockAuthFn.mockResolvedValue(makeSession("ppa:correct", ["ws-1"]))
      const { declarePpaCorrectionAction } = await import("@/app/(app)/prevencion/ppa/actions")
      const input = { ppaId: "ppa-1", expectedPpaVersion: 2, expectedCapaVersion: 3 }
      const result = await declarePpaCorrectionAction(input)
      expect(result.ok).toBe(true)
      expect(mockDeclarePpaCorrection).toHaveBeenCalledWith(input, expect.objectContaining({
        userId: "user-1", worksiteIds: ["ws-1"], permissions: ["ppa:correct"],
      }))
    })

    it.each([
      ["verifyPpaCorrectionAction", { ppaId: "ppa-1", expectedPpaVersion: 2, expectedCapaVersion: 3, accepted: false, comment: "Control insuficiente" }, mockVerifyPpaCorrection],
      ["authorizePpaRestartAction", { ppaId: "ppa-1", expectedPpaVersion: 2 }, mockAuthorizePpaRestart],
      ["cancelPpaAction", { ppaId: "ppa-1", expectedPpaVersion: 2, expectedCapaVersion: 3, reason: "Tarea descartada" }, mockCancelPpa],
    ] as const)("rejects %s without its dedicated permission", async (name, input, service) => {
      mockAuthFn.mockResolvedValue(makeSession("ppa:view", [], true))
      const actions = await import("@/app/(app)/prevencion/ppa/actions")
      const result = await (actions[name] as (value: typeof input) => Promise<{ ok: boolean }>)(input)
      expect(result.ok).toBe(false)
      expect(service).not.toHaveBeenCalled()
    })
  })

  describe("getPpaStatsAction", () => {
    it("returns stats", async () => {
      mockAuthFn.mockResolvedValue(makeSession("ppa:view", [], true))
      const { getPpaStatsAction } = await import("@/app/(app)/prevencion/ppa/actions")
      const r = await getPpaStatsAction()
      expect(r.ok).toBe(true); expect(r.data?.stats.total).toBe(10)
    })
  })
})
