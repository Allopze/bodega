import { beforeEach, describe, expect, it, vi } from "vitest"

const guardPermission = vi.hoisted(() => vi.fn())
const resolveWorksiteScope = vi.hoisted(() => vi.fn())
const getMiperHistory = vi.hoisted(() => vi.fn())
const revalidatePath = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope }))
vi.mock("next/cache", () => ({ revalidatePath }))
vi.mock("@/lib/services/miper/queries", () => ({ getMiperHistory }))

import { loadMiperHistoryPageAction } from "./history-actions"

const denied = { session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } }
const session = { user: { id: "trusted-user", permissions: ["prevention:risk:view"] } }

describe("loadMiperHistoryPageAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveWorksiteScope.mockReturnValue({ mode: "some", ids: ["ws-own"] })
  })

  it("sin permiso no llama al servicio", async () => {
    guardPermission.mockResolvedValue(denied)
    await expect(loadMiperHistoryPageAction({ matrixId: "m1", cursor: "c" })).resolves.toEqual(denied.error)
    expect(guardPermission).toHaveBeenCalledWith("prevention:risk:view")
    expect(getMiperHistory).not.toHaveBeenCalled()
  })

  it("devuelve la página en data, con el alcance de la sesión y sin revalidar", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    const page = { events: [{ id: "e1", at: "2026-01-01T00:00:00Z", actorName: null, actingAs: null, changeType: "created", object: null, reason: null }], nextCursor: "sig" }
    getMiperHistory.mockResolvedValue(page)
    const result = await loadMiperHistoryPageAction({ matrixId: "m1", cursor: "c1" })
    expect(result).toEqual({ ok: true, data: page })
    expect(getMiperHistory).toHaveBeenCalledWith("m1", { userId: "trusted-user", scope: { mode: "some", ids: ["ws-own"] }, permissions: ["prevention:risk:view"] }, { cursor: "c1" })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
