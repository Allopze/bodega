import { beforeEach, describe, expect, it, vi } from "vitest"

const guardPermission = vi.hoisted(() => vi.fn())
const resolveWorksiteScope = vi.hoisted(() => vi.fn())
const createPdtpObligation = vi.hoisted(() => vi.fn())
const reportPdtpObligation = vi.hoisted(() => vi.fn())
const cancelPdtpObligation = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/services/prevention-pdtp", () => ({ createPdtpObligation, reportPdtpObligation, cancelPdtpObligation }))

import { cancelPdtpObligationAction, createPdtpObligationAction, reportPdtpObligationAction } from "./actions"

const session = { user: { id: "trusted-user", permissions: ["prevention:pdtp:execute"] } }

describe("PDTP obligation actions are authorization boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guardPermission.mockResolvedValue({ session, error: null })
    resolveWorksiteScope.mockReturnValue({ mode: "some", ids: ["ws-own"] })
    createPdtpObligation.mockResolvedValue({})
    reportPdtpObligation.mockResolvedValue({})
    cancelPdtpObligation.mockResolvedValue({})
  })

  it("fails closed without execute permission", async () => {
    const error = { ok: false, message: "No tienes permisos" }
    guardPermission.mockResolvedValue({ session: null, error })
    await expect(createPdtpObligationAction({})).resolves.toEqual(error)
    expect(createPdtpObligation).not.toHaveBeenCalled()
  })

  it("derives actor and worksite scope when creating a manual obligation", async () => {
    await expect(createPdtpObligationAction({
      activityId: "activity-1",
      worksiteId: "ws-own",
      origin: "manual",
      clientRequestId: "request-1234",
      plannedQuantity: 1,
      manualReason: "Necesidad real registrada por operación",
      sourceMetadata: {},
      userId: "forged",
      scope: "all",
    })).resolves.toEqual({ ok: true })
    expect(createPdtpObligation).toHaveBeenCalledWith(expect.objectContaining({
      activityId: "activity-1",
      userId: "trusted-user",
      scope: ["ws-own"],
    }))
  })

  it("derives actor and scope for reporting and cancellation", async () => {
    await reportPdtpObligationAction({ obligationId: "ob-1", executedQuantity: 1, evidenceText: "Registro verificable", evidencePhotos: [] })
    await cancelPdtpObligationAction({ obligationId: "ob-2", reason: "Caso duplicado y formalmente fusionado" })
    expect(reportPdtpObligation).toHaveBeenCalledWith(expect.objectContaining({ userId: "trusted-user", scope: ["ws-own"] }))
    expect(cancelPdtpObligation).toHaveBeenCalledWith(expect.objectContaining({ userId: "trusted-user", scope: ["ws-own"] }))
  })
})
