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

const session = { user: { id: "user-1", email: "reviewer@example.com", worksiteIds: ["ws-1"], permissions: [], roles: [] } }
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
    const res = await updateAnomalyStatusAction({ caseId: "c-1", expectedStatus: "open", status: "in_review" })
    expect(mockGuardPermission).toHaveBeenCalledWith("combustibles:review_anomalies", "/combustibles")
    expect(res).toEqual(denied.error)
    expect(mockUpdateStatus).not.toHaveBeenCalled()
  })

  it("resolved pide combustibles:resolve_anomalies, no review_anomalies", async () => {
    mockGuardPermission.mockResolvedValueOnce(denied)
    const res = await updateAnomalyStatusAction({ caseId: "c-1", expectedStatus: "in_review", status: "resolved", resolution: "motivo" })
    expect(mockGuardPermission).toHaveBeenCalledWith("combustibles:resolve_anomalies", "/combustibles")
    expect(res).toEqual(denied.error)
    expect(mockUpdateStatus).not.toHaveBeenCalled()
  })

  it("dismissed también pide combustibles:resolve_anomalies", async () => {
    mockGuardPermission.mockResolvedValueOnce(denied)
    await updateAnomalyStatusAction({ caseId: "c-1", expectedStatus: "open", status: "dismissed", resolution: "motivo" })
    expect(mockGuardPermission).toHaveBeenCalledWith("combustibles:resolve_anomalies", "/combustibles")
  })

  it("con el permiso correcto, actualiza y no bloquea", async () => {
    mockGuardPermission.mockResolvedValueOnce(granted)
    mockUpdateStatus.mockResolvedValueOnce({})
    const res = await updateAnomalyStatusAction({ caseId: "c-1", expectedStatus: "in_review", status: "resolved", resolution: "motivo" })
    expect(res.ok).toBe(true)
    expect(mockUpdateStatus).toHaveBeenCalledWith(session, "c-1", "in_review", "resolved", "motivo", undefined)
  })

  it("rechaza estado actual o destino fuera del contrato antes de consultar permisos", async () => {
    await expect(updateAnomalyStatusAction({ caseId: "c-1", expectedStatus: "open", status: "inventado" })).resolves.toMatchObject({ ok: false })
    await expect(updateAnomalyStatusAction({ caseId: "c-1", expectedStatus: "inventado" as never, status: "in_review" })).resolves.toMatchObject({ ok: false })
    expect(mockGuardPermission).not.toHaveBeenCalled()
    expect(mockUpdateStatus).not.toHaveBeenCalled()
  })
})

describe("assignAnomalyAction / commentAnomalyAction — combustibles:review_anomalies", () => {
  beforeEach(() => vi.clearAllMocks())

  it("assignAnomalyAction bloquea sin el permiso", async () => {
    mockGuardPermission.mockResolvedValueOnce(denied)
    const res = await assignAnomalyAction({ caseId: "c-1", expectedAssigneeId: null, assigneeId: "user-2" })
    expect(mockGuardPermission).toHaveBeenCalledWith("combustibles:review_anomalies", "/combustibles")
    expect(res).toEqual(denied.error)
    expect(mockAssign).not.toHaveBeenCalled()
  })

  it("assignAnomalyAction permite con el permiso", async () => {
    mockGuardPermission.mockResolvedValueOnce(granted)
    mockAssign.mockResolvedValueOnce({})
    const res = await assignAnomalyAction({ caseId: "c-1", expectedAssigneeId: null, assigneeId: "user-2" })
    expect(res.ok).toBe(true)
    expect(mockAssign).toHaveBeenCalledWith(session, "c-1", null, "user-2")
  })

  it("commentAnomalyAction bloquea sin el permiso", async () => {
    mockGuardPermission.mockResolvedValueOnce(denied)
    const res = await commentAnomalyAction({ caseId: "c-1", body: "texto" })
    expect(res).toEqual(denied.error)
    expect(mockComment).not.toHaveBeenCalled()
  })

  it("commentAnomalyAction pasa la sesión al servicio scoped", async () => {
    mockGuardPermission.mockResolvedValueOnce(granted)
    mockComment.mockResolvedValueOnce({})
    const res = await commentAnomalyAction({ caseId: "c-1", body: "  hallazgo revisado  " })
    expect(res.ok).toBe(true)
    expect(mockComment).toHaveBeenCalledWith(session, "c-1", "  hallazgo revisado  ")
  })
})
