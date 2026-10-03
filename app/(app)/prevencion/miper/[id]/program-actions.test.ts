import { beforeEach, describe, expect, it, vi } from "vitest"

const guardPermission = vi.hoisted(() => vi.fn())
const resolveWorksiteScope = vi.hoisted(() => vi.fn())
const getProgramActionDetail = vi.hoisted(() => vi.fn())
const revalidatePath = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope }))
vi.mock("next/cache", () => ({ revalidatePath }))
vi.mock("@/lib/services/miper/program-queries", () => ({ getProgramActionDetail }))

import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { OUT_OF_SCOPE } from "@/lib/services/miper/shared"
import { loadProgramActionDetailAction } from "./program-actions"

const denied = { session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } }
const session = { user: { id: "trusted-user", permissions: ["prevention:risk:view"] } }

describe("loadProgramActionDetailAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveWorksiteScope.mockReturnValue({ mode: "some", ids: ["ws-own"] })
  })

  it("sin permiso no llama al servicio", async () => {
    guardPermission.mockResolvedValue(denied)
    await expect(loadProgramActionDetailAction({ matrixId: "m-1", actionId: "a-1" })).resolves.toEqual(denied.error)
    expect(guardPermission).toHaveBeenCalledWith("prevention:risk:view")
    expect(getProgramActionDetail).not.toHaveBeenCalled()
  })

  it("sin actionId responde el error de alcance", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    await expect(loadProgramActionDetailAction({ matrixId: "m-1" })).resolves.toEqual({ ok: false, message: OUT_OF_SCOPE })
    expect(getProgramActionDetail).not.toHaveBeenCalled()
  })

  it("devuelve el detalle en data", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    const detail = { actionId: "a-1", occurrences: [] }
    getProgramActionDetail.mockResolvedValue(detail)
    await expect(loadProgramActionDetailAction({ matrixId: "m-1", actionId: "a-1" })).resolves.toEqual({ ok: true, data: detail })
    expect(getProgramActionDetail).toHaveBeenCalledWith("a-1", {
      userId: "trusted-user", scope: { mode: "some", ids: ["ws-own"] }, permissions: ["prevention:risk:view"],
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("un RiskLegalDomainError llega con su mensaje", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    getProgramActionDetail.mockRejectedValue(new RiskLegalDomainError(OUT_OF_SCOPE))
    await expect(loadProgramActionDetailAction({ matrixId: "m-1", actionId: "a-9" })).resolves.toEqual({ ok: false, message: OUT_OF_SCOPE })
  })
})
