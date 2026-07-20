import { beforeEach, describe, expect, it, vi } from "vitest"

const guardPermission = vi.hoisted(() => vi.fn())
const resolveWorksiteScope = vi.hoisted(() => vi.fn())
const approveDenominator = vi.hoisted(() => vi.fn())
const saveDenominator = vi.hoisted(() => vi.fn())
const closePeriod = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/services/prevention-indicadores", () => ({
  approveSafetyIndicatorDenominator: approveDenominator,
  upsertSafetyIndicatorDenominator: saveDenominator,
  upsertSafetyIndicatorMonth: vi.fn(),
  closeSafetyIndicatorPeriod: closePeriod,
}))

import {
  approveSafetyIndicatorDenominatorAction,
  closeSafetyIndicatorPeriodAction,
  saveSafetyIndicatorDenominatorAction,
} from "./actions"

const denied = { session: null, error: { ok: false, message: "No tienes permisos" } }
const session = {
  user: {
    id: "trusted-user",
    permissions: ["prevention:indicadores:manage", "prevention:indicadores:close"],
  },
}

describe("indicator server actions are authorization boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveWorksiteScope.mockReturnValue({ mode: "some", ids: ["ws-own"] })
  })

  it("blocks denominator writes without manage permission", async () => {
    guardPermission.mockResolvedValue(denied)
    await expect(saveSafetyIndicatorDenominatorAction({ worksiteId: "ws-foreign" })).resolves.toEqual(denied.error)
    expect(guardPermission).toHaveBeenCalledWith("prevention:indicadores:manage")
    expect(saveDenominator).not.toHaveBeenCalled()
  })

  it("derives actor, scope and permissions from the authenticated session", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    saveDenominator.mockResolvedValue({})
    const forged = { worksiteId: "ws-own", actorUserId: "forged-user" }
    await expect(saveSafetyIndicatorDenominatorAction(forged)).resolves.toEqual({ ok: true })
    expect(saveDenominator).toHaveBeenCalledWith(forged, {
      userId: "trusted-user",
      scope: { mode: "some", ids: ["ws-own"] },
      permissions: session.user.permissions,
    })
  })

  it("requires close permission for denominator approval and period close", async () => {
    guardPermission.mockResolvedValue(denied)
    await approveSafetyIndicatorDenominatorAction({ denominatorId: "den-1" })
    await closeSafetyIndicatorPeriodAction({
      worksiteId: "ws-own",
      year: 2026,
      month: 7,
      reason: "Conciliación mensual aprobada y documentada.",
    })
    expect(guardPermission).toHaveBeenNthCalledWith(1, "prevention:indicadores:close")
    expect(guardPermission).toHaveBeenNthCalledWith(2, "prevention:indicadores:close")
    expect(approveDenominator).not.toHaveBeenCalled()
    expect(closePeriod).not.toHaveBeenCalled()
  })
})
