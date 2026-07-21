import { beforeEach, describe, expect, it, vi } from "vitest"

const guardPermission = vi.hoisted(() => vi.fn())
const resolveWorksiteScope = vi.hoisted(() => vi.fn())
const createRiskMatrixDraft = vi.hoisted(() => vi.fn())
const transitionRiskMatrix = vi.hoisted(() => vi.fn())
const approveRiskImportBatch = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/services/prevention-risk-legal", () => ({
  addRiskEntry: vi.fn(),
  createRiskMatrixDraft,
  createRiskMethodology: vi.fn(),
  createRiskReviewTrigger: vi.fn(),
  ensureIspRiskMethodology: vi.fn(),
  resolveRiskReviewTrigger: vi.fn(),
  transitionRiskMatrix,
}))
vi.mock("@/lib/services/prevention-risk-import", () => ({
  activateRiskImportBatch: vi.fn(),
  approveRiskImportBatch,
  resolveRiskImportRow: vi.fn(),
  stageRiskImport: vi.fn(),
}))

import {
  approveRiskImportBatchAction,
  createRiskMatrixDraftAction,
  transitionRiskMatrixAction,
} from "./actions"

const denied = { session: null, error: { ok: false, message: "No tienes permisos" } }
const session = {
  user: {
    id: "trusted-risk-user",
    permissions: ["prevention:risk:edit", "prevention:risk:review", "prevention:risk:approve", "prevention:risk:publish"],
  },
}

describe("MIPER server actions are authorization boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveWorksiteScope.mockReturnValue({ mode: "some", ids: ["ws-own"] })
  })

  it("blocks writes before invoking the domain service", async () => {
    guardPermission.mockResolvedValue(denied)

    await expect(createRiskMatrixDraftAction({ worksiteId: "ws-foreign" })).resolves.toEqual(denied.error)

    expect(guardPermission).toHaveBeenCalledWith("prevention:risk:edit")
    expect(createRiskMatrixDraft).not.toHaveBeenCalled()
  })

  it("derives actor, scope and permissions from the authenticated session", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    createRiskMatrixDraft.mockResolvedValue({})
    const forged = { worksiteId: "ws-own", userId: "forged-user", permissions: ["*"] }

    await expect(createRiskMatrixDraftAction(forged)).resolves.toEqual({ ok: true })

    expect(createRiskMatrixDraft).toHaveBeenCalledWith(forged, {
      userId: "trusted-risk-user",
      scope: { mode: "some", ids: ["ws-own"] },
      permissions: session.user.permissions,
    })
  })

  it.each([
    ["reviewed", "prevention:risk:review"],
    ["approved", "prevention:risk:approve"],
    ["published", "prevention:risk:publish"],
  ])("requires the specific %s workflow permission", async (toStatus, permission) => {
    guardPermission.mockResolvedValue(denied)

    await transitionRiskMatrixAction({ matrixId: "matrix-1", toStatus })

    expect(guardPermission).toHaveBeenCalledWith(permission)
    expect(transitionRiskMatrix).not.toHaveBeenCalled()
  })

  it("requires approval permission for an import batch", async () => {
    guardPermission.mockResolvedValue(denied)

    await approveRiskImportBatchAction("batch-1")

    expect(guardPermission).toHaveBeenCalledWith("prevention:risk:approve")
    expect(approveRiskImportBatch).not.toHaveBeenCalled()
  })
})
