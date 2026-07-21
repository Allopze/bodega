import { beforeEach, describe, expect, it, vi } from "vitest"

const guardPermission = vi.hoisted(() => vi.fn())
const resolveWorksiteScope = vi.hoisted(() => vi.fn())
const approveDenominator = vi.hoisted(() => vi.fn())
const saveDenominator = vi.hoisted(() => vi.fn())
const saveMonth = vi.hoisted(() => vi.fn())
const closePeriod = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/services/prevention-indicadores", () => ({
  approveSafetyIndicatorDenominator: approveDenominator,
  upsertSafetyIndicatorDenominator: saveDenominator,
  upsertSafetyIndicatorMonth: saveMonth,
  closeSafetyIndicatorPeriod: closePeriod,
}))

import {
  approveSafetyIndicatorDenominatorAction,
  closeSafetyIndicatorPeriodAction,
  saveSafetyIndicatorDenominatorAction,
  saveSafetyIndicatorMonthAction,
} from "./actions"
import {
  safetyIndicatorDenominatorSchema,
  safetyIndicatorMonthSchema,
} from "@/lib/validation/prevention-module/safety-indicators"

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

  // Fase 0 (baseline): estas dos actions no validan con Zod dentro de sí
  // mismas — reenvían `input: unknown` al servicio, que hace
  // `schema.parse(input)` y lanza ZodError; la action atrapa ese error y lo
  // convierte en `{ ok: false, message, fieldErrors }`. Este test fija ese
  // mensaje y esos fieldErrors (derivados del schema real) como el contrato
  // actual, antes de que Fase 1 (H-27) introduzca `parseZ` en este boundary.
  describe("current fieldErrors contract when the service's Zod schema rejects input", () => {
    it("saveSafetyIndicatorMonthAction", async () => {
      guardPermission.mockResolvedValue({ session, error: null })
      saveMonth.mockImplementation(async (input: unknown) => {
        safetyIndicatorMonthSchema.parse(input)
      })

      const result = await saveSafetyIndicatorMonthAction({ worksiteId: "", year: 2020, month: 13 })

      expect(result.ok).toBe(false)
      expect(result.message).toBe("Revisa los campos marcados.")
      expect(result.fieldErrors).toEqual({
        worksiteId: ["Faena requerida"],
        year: ["El año debe ser al menos 2024"],
        month: ["Too big: expected number to be <=12"],
      })
    })

    it("saveSafetyIndicatorDenominatorAction", async () => {
      guardPermission.mockResolvedValue({ session, error: null })
      saveDenominator.mockImplementation(async (input: unknown) => {
        safetyIndicatorDenominatorSchema.parse(input)
      })

      const result = await saveSafetyIndicatorDenominatorAction({
        worksiteId: "ws-1", year: 2026, month: 5, workerCount: 10, workedHours: 100,
        sourceType: "manual", sourceReference: "ref", evidenceReference: "ev",
        reconciliationStatus: "difference",
      })

      expect(result.ok).toBe(false)
      expect(result.message).toBe("Revisa los campos marcados.")
      expect(result.fieldErrors).toEqual({
        evidenceReference: ["Too small: expected string to have >=3 characters"],
        reconciliationNotes: ["Documenta la diferencia o excepción."],
      })
    })
  })
})
