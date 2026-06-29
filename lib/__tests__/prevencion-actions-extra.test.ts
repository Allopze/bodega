/**
 * Additional unit tests for prevencion Server Actions (coverage 25.82% → now covered).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockGuardAuth = vi.hoisted(() => vi.fn())
const mockGuardPermission = vi.hoisted(() => vi.fn())
const mockCan = vi.hoisted(() => vi.fn(() => true))
const mockCanAny = vi.hoisted(() => vi.fn(() => true))
const mockResolveWorksiteScope = vi.hoisted(() => vi.fn(() => ({ mode: "all" as const, ids: [] })))
const mockGetEvaluation = vi.hoisted(() => vi.fn())
const mockSaveResponses = vi.hoisted(() => vi.fn())
const mockCloseEvaluation = vi.hoisted(() => vi.fn())
const mockMarkFollowup = vi.hoisted(() => vi.fn())
const mockDeleteEvaluation = vi.hoisted(() => vi.fn())
const mockMarkWeekCompleted = vi.hoisted(() => vi.fn())
const mockDashboardStats = vi.hoisted(() => vi.fn(() => ({ total: 5, borrador: 1, cerrado: 2, habilitados: 3, noHabilitados: 0, pendingFollowups: 1 })))

vi.mock("@/lib/auth/can", () => ({
  guardAuth: mockGuardAuth,
  guardPermission: mockGuardPermission,
  can: mockCan,
  canAny: mockCanAny,
}))
vi.mock("@/lib/auth/scope", () => ({
  resolveWorksiteScope: mockResolveWorksiteScope,
}))
vi.mock("@/lib/services/sst", () => ({
  getEvaluation: mockGetEvaluation,
  saveResponses: mockSaveResponses,
  closeEvaluation: mockCloseEvaluation,
  markFollowup: mockMarkFollowup,
  deleteEvaluation: mockDeleteEvaluation,
  markWeekCompleted: mockMarkWeekCompleted,
  getDashboardStats: mockDashboardStats,
  listEvaluations: vi.fn(() => []),
  listEvaluationsGroupedByWorker: vi.fn(() => []),
  createEvaluation: vi.fn(() => ({ id: "eval-1" })),
  getFollowups: vi.fn(() => []),
  getWeeklyEvaluations: vi.fn(() => []),
  saveActionPlanItem: vi.fn(() => ({ id: "ap-1" })),
  deleteActionPlanItem: vi.fn(),
}))
vi.mock("@/lib/sst/definitions/index", () => ({
  getDefinition: vi.fn(() => ({ sections: [] })),
}))
vi.mock("@/lib/sst/checklist", () => ({
  writableSectionIds: vi.fn(() => new Set(["sst-1", "sst-2"])),
}))
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ then: vi.fn((cb: (rows: unknown[]) => unknown) => cb([{ worksiteId: "ws-1" }])) })) })) })),
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import {
  saveResponsesAction,
  closeEvaluationAction,
  markFollowupAction,
  deleteEvaluationAction,
  markWeekCompletedAction,
  getDashboardStatsAction,
} from "@/app/(app)/prevencion/actions"

function makeSession() {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1", email: "admin@test.cl", name: "Admin",
      roles: ["administrador"],
      permissions: ["sst:view", "sst:create", "sst:close", "sst:manage", "sst:evaluate_acompanamiento"],
      worksiteIds: ["ws-1"], primaryWorksiteId: "ws-1",
      avatarColor: "#000", isActive: true,
    },
  }
}

describe("saveResponsesAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGuardAuth.mockResolvedValue({ session: makeSession(), error: null })
    mockCanAny.mockReturnValue(true)
  })

  it("returns error if not authenticated", async () => {
    mockGuardAuth.mockResolvedValueOnce({ session: null, error: { ok: false, message: "No autenticado" } })
    const res = await saveResponsesAction("eval-1", [])
    expect(res.ok).toBe(false)
    expect(res.message).toContain("No autenticado")
  })

  it("returns error if no permissions", async () => {
    mockCanAny.mockReturnValueOnce(false)
    const res = await saveResponsesAction("eval-1", [])
    expect(res.ok).toBe(false)
    expect(res.message).toContain("No tienes permisos")
  })

  it("blocks conductor_lider from editing non-allowed sections", async () => {
    mockCan.mockReturnValueOnce(false) // sst:create is false
    mockCanAny.mockReturnValueOnce(true)
    mockGetEvaluation.mockResolvedValueOnce({ id: "eval-1", definicionCode: "sst_v3", definicionVersion: 1, worksiteId: "ws-1" })
    const res = await saveResponsesAction("eval-1", [
      { evaluationId: "eval-1", seccionId: "sst-3", itemId: "q1", estado: "si", observacion: "" },
    ])
    expect(res.ok).toBe(false)
    expect(res.message).toContain("No tienes permisos")
  })

  it("saves responses successfully", async () => {
    const res = await saveResponsesAction("eval-1", [])
    expect(res.ok).toBe(true)
  })
})

describe("closeEvaluationAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGuardPermission.mockResolvedValue({ session: makeSession(), error: null })
    mockCloseEvaluation.mockResolvedValueOnce({ id: "eval-1", status: "closed" })
  })

  it("returns error if permission denied", async () => {
    mockGuardPermission.mockResolvedValueOnce({ session: null, error: { ok: false, message: "Sin permisos" } })
    const res = await closeEvaluationAction("eval-1", { evaluationId: "eval-1", restricciones: "", observacionesGenerales: "" })
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("closes evaluation successfully", async () => {
    const res = await closeEvaluationAction("eval-1", { evaluationId: "eval-1", restricciones: "ninguna", observacionesGenerales: "" })
    expect(res.ok).toBe(true)
    expect(res.message).toContain("Evaluación cerrada exitosamente")
  })
})

describe("markFollowupAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGuardPermission.mockResolvedValue({ session: makeSession(), error: null })
  })

  it("returns error if permission denied", async () => {
    mockGuardPermission.mockResolvedValueOnce({ session: null, error: { ok: false, message: "No" } })
    const res = await markFollowupAction("fup-1", { realizado: true, cumple: true, observaciones: "" })
    expect(res.ok).toBe(false)
  })

  it("marks followup successfully", async () => {
    const res = await markFollowupAction("fup-1", { realizado: true, cumple: true, observaciones: "" })
    expect(res.ok).toBe(true)
    expect(res.message).toContain("Seguimiento actualizado")
  })
})

describe("deleteEvaluationAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGuardPermission.mockResolvedValue({ session: makeSession(), error: null })
  })

  it("returns error if permission denied", async () => {
    mockGuardPermission.mockResolvedValueOnce({ session: null, error: { ok: false, message: "No" } })
    const fd = new FormData()
    fd.set("evaluationId", "eval-1")
    const res = await deleteEvaluationAction({ ok: false, message: "" }, fd)
    expect(res.ok).toBe(false)
  })

  it("returns error if evaluation id missing", async () => {
    const fd = new FormData()
    const res = await deleteEvaluationAction({ ok: false, message: "" }, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Evaluación requerida")
  })

  it("deletes evaluation successfully", async () => {
    const fd = new FormData()
    fd.set("evaluationId", "eval-1")
    const res = await deleteEvaluationAction({ ok: false, message: "" }, fd)
    expect(res.ok).toBe(true)
  })
})

describe("markWeekCompletedAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGuardAuth.mockResolvedValue({ session: makeSession(), error: null })
    mockCanAny.mockReturnValue(true)
  })

  it("returns error if not authenticated", async () => {
    mockGuardAuth.mockResolvedValueOnce({ session: null, error: { ok: false, message: "No" } })
    const res = await markWeekCompletedAction("we-1")
    expect(res.ok).toBe(false)
  })

  it("returns error if no permissions", async () => {
    mockCanAny.mockReturnValueOnce(false)
    const res = await markWeekCompletedAction("we-1")
    expect(res.ok).toBe(false)
    expect(res.message).toContain("No tienes permisos")
  })

  it("marks week as completed successfully", async () => {
    const res = await markWeekCompletedAction("we-1")
    expect(res.ok).toBe(true)
    expect(res.message).toContain("Semana marcada como completada")
  })
})

describe("getDashboardStatsAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGuardPermission.mockResolvedValue({ session: makeSession(), error: null })
  })

  it("returns error if permission denied", async () => {
    mockGuardPermission.mockResolvedValueOnce({ session: null, error: { ok: false, message: "No" } })
    const res = await getDashboardStatsAction()
    expect(res.ok).toBe(false)
  })

  it("returns dashboard stats", async () => {
    const res = await getDashboardStatsAction()
    expect(res.ok).toBe(true)
    expect(res.data?.total).toBe(5)
    expect(res.data?.cerrado).toBe(2)
  })
})
