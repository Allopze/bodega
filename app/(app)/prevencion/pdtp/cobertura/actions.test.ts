import { beforeEach, describe, expect, it, vi } from "vitest"

const guardPermission = vi.hoisted(() => vi.fn())
const resolveWorksiteScope = vi.hoisted(() => vi.fn())
const linkPdtpActivitySource = vi.hoisted(() => vi.fn())
const resolvePdtpUpdateObligation = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/services/prevention-risk-legal", () => ({
  linkPdtpActivitySource,
  resolvePdtpUpdateObligation,
}))

import { linkPdtpActivitySourceAction, resolvePdtpUpdateObligationAction } from "./actions"

const denied = { session: null, error: { ok: false, message: "No tienes permisos" } }
const session = {
  user: {
    id: "trusted-pdtp-user",
    permissions: ["prevention:pdtp:program:manage"],
  },
}

describe("PDTP coverage server actions are authorization boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveWorksiteScope.mockReturnValue({ mode: "some", ids: ["ws-own"] })
  })

  it("blocks source links without program management permission", async () => {
    guardPermission.mockResolvedValue(denied)

    await expect(linkPdtpActivitySourceAction({ activityId: "activity-1" })).resolves.toEqual(denied.error)

    expect(guardPermission).toHaveBeenCalledWith("prevention:pdtp:program:manage")
    expect(linkPdtpActivitySource).not.toHaveBeenCalled()
  })

  it("derives identity and scope when closing a regulatory clock", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    resolvePdtpUpdateObligation.mockResolvedValue({})
    const forged = { obligationId: "clock-1", programId: "program-1", userId: "forged" }

    await expect(resolvePdtpUpdateObligationAction(forged)).resolves.toEqual({ ok: true })

    expect(resolvePdtpUpdateObligation).toHaveBeenCalledWith(forged, {
      userId: "trusted-pdtp-user",
      scope: { mode: "some", ids: ["ws-own"] },
      permissions: session.user.permissions,
    })
  })
})
