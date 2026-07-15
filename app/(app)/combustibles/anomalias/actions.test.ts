import { describe, it, expect, vi, beforeEach } from "vitest"

const mockGuardPermission = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth/can", () => ({ guardPermission: mockGuardPermission }))

const mockUpdateStatus = vi.hoisted(() => vi.fn())
const mockAssign = vi.hoisted(() => vi.fn())
const mockComment = vi.hoisted(() => vi.fn())
vi.mock("@/lib/combustibles/anomaly-cases", () => ({
  updateAnomalyCaseStatus: mockUpdateStatus,
  assignAnomalyCase: mockAssign,
  addAnomalyComment: mockComment,
}))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const { updateAnomalyStatusAction, assignAnomalyAction, commentAnomalyAction } = await import("./actions")

const session = { user: { id: "user-1" } }
const denied = { session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } }
const granted = { session, error: null }

/**
 * Sección 19 — "Permisos granulares positivos y negativos": ningún caso nuevo
 * de esta sesión (review_anomalies/resolve_anomalies) tenía prueba de que
 * efectivamente bloquearan sin el permiso y permitieran con él.
 */
describe("updateAnomalyStatusAction — permiso según el estado destino", () => {
  beforeEach(() => vi.clearAllMocks())

  it("in_review pide combustibles:review_anomalies, no resolve_anomalies", async () => {
    mockGuardPermission.mockResolvedValueOnce(denied)
    const res = await updateAnomalyStatusAction({ caseId: "c-1", status: "in_review" })
    expect(mockGuardPermission).toHaveBeenCalledWith("combustibles:review_anomalies")
    expect(res).toEqual(denied.error)
    expect(mockUpdateStatus).not.toHaveBeenCalled()
  })

  it("resolved pide combustibles:resolve_anomalies, no review_anomalies", async () => {
    mockGuardPermission.mockResolvedValueOnce(denied)
    const res = await updateAnomalyStatusAction({ caseId: "c-1", status: "resolved", resolution: "motivo" })
    expect(mockGuardPermission).toHaveBeenCalledWith("combustibles:resolve_anomalies")
    expect(res).toEqual(denied.error)
    expect(mockUpdateStatus).not.toHaveBeenCalled()
  })

  it("dismissed también pide combustibles:resolve_anomalies", async () => {
    mockGuardPermission.mockResolvedValueOnce(denied)
    await updateAnomalyStatusAction({ caseId: "c-1", status: "dismissed", resolution: "motivo" })
    expect(mockGuardPermission).toHaveBeenCalledWith("combustibles:resolve_anomalies")
  })

  it("con el permiso correcto, actualiza y no bloquea", async () => {
    mockGuardPermission.mockResolvedValueOnce(granted)
    mockUpdateStatus.mockResolvedValueOnce({})
    const res = await updateAnomalyStatusAction({ caseId: "c-1", status: "resolved", resolution: "motivo" })
    expect(res.ok).toBe(true)
    expect(mockUpdateStatus).toHaveBeenCalledWith("c-1", "resolved", "user-1", "motivo")
  })
})

describe("assignAnomalyAction / commentAnomalyAction — combustibles:review_anomalies", () => {
  beforeEach(() => vi.clearAllMocks())

  it("assignAnomalyAction bloquea sin el permiso", async () => {
    mockGuardPermission.mockResolvedValueOnce(denied)
    const res = await assignAnomalyAction({ caseId: "c-1", assigneeId: "user-2" })
    expect(mockGuardPermission).toHaveBeenCalledWith("combustibles:review_anomalies")
    expect(res).toEqual(denied.error)
    expect(mockAssign).not.toHaveBeenCalled()
  })

  it("assignAnomalyAction permite con el permiso", async () => {
    mockGuardPermission.mockResolvedValueOnce(granted)
    mockAssign.mockResolvedValueOnce({})
    const res = await assignAnomalyAction({ caseId: "c-1", assigneeId: "user-2" })
    expect(res.ok).toBe(true)
  })

  it("commentAnomalyAction bloquea sin el permiso", async () => {
    mockGuardPermission.mockResolvedValueOnce(denied)
    const res = await commentAnomalyAction({ caseId: "c-1", body: "texto" })
    expect(res).toEqual(denied.error)
    expect(mockComment).not.toHaveBeenCalled()
  })
})
