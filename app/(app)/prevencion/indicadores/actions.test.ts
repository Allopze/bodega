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

const denied = { session: null, error: { ok: false, message: "No tienes permisos" } }
const session = {
  user: {
    id: "trusted-user",
    permissions: ["prevention:indicadores:manage", "prevention:indicadores:close"],
  },
}

const validDenominatorInput = {
  worksiteId: "ws-own",
  year: 2026,
  month: 5,
  workerCount: 10,
  workedHours: 160,
  sourceType: "manual" as const,
  sourceReference: "planilla julio",
  evidenceReference: "evidencia-julio.pdf",
  reconciliationStatus: "matched" as const,
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

  it("derives actor, scope and permissions from the authenticated session, dropping forged fields the schema does not declare", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    saveDenominator.mockResolvedValue({})
    // `actorUserId` no pertenece a safetyIndicatorDenominatorSchema — parseZ
    // lo descarta al validar (zod strips unknown keys por defecto), así que
    // nunca llega al servicio como parte del dato validado.
    const forged = { ...validDenominatorInput, actorUserId: "forged-user" }

    await expect(saveSafetyIndicatorDenominatorAction(forged)).resolves.toEqual({ ok: true })

    expect(saveDenominator).toHaveBeenCalledTimes(1)
    const [calledInput, calledAccess] = saveDenominator.mock.calls[0]!
    expect(calledInput).not.toHaveProperty("actorUserId")
    expect(calledInput).toMatchObject(validDenominatorInput)
    expect(calledAccess).toEqual({
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

  // Fase 1 (H-27 paso 4a): las 4 actions validan con `parseZ` en el boundary,
  // antes de invocar el servicio. Un input inválido se rechaza aquí mismo —
  // el servicio nunca se llama — y devuelve `fieldErrors` estructurados.
  describe("parseZ boundary rejects invalid input without invoking the service", () => {
    it("saveSafetyIndicatorMonthAction", async () => {
      guardPermission.mockResolvedValue({ session, error: null })

      const result = await saveSafetyIndicatorMonthAction({ worksiteId: "", year: 2020, month: 13 })

      expect(result.ok).toBe(false)
      expect(result.message).toBe("Revisa los campos marcados.")
      expect(result.fieldErrors).toEqual({
        worksiteId: ["Faena requerida"],
        year: ["El año debe ser al menos 2024"],
        month: ["Too big: expected number to be <=12"],
      })
      expect(saveMonth).not.toHaveBeenCalled()
    })

    it("saveSafetyIndicatorDenominatorAction", async () => {
      guardPermission.mockResolvedValue({ session, error: null })

      const result = await saveSafetyIndicatorDenominatorAction({
        worksiteId: "ws-1", year: 2026, month: 5, workerCount: 10, workedHours: 100,
        sourceType: "manual", sourceReference: "ref", evidenceReference: "ev",
        reconciliationStatus: "difference",
      })

      expect(result.ok).toBe(false)
      expect(result.message).toBe("Revisa los campos marcados.")
      // El diálogo ahora pinta estos textos bajo cada campo, así que dejaron de
      // ser diagnóstico interno: ningún mensaje de Zod en inglés puede llegar a
      // la pantalla, y el de la nota depende del estado de conciliación.
      expect(result.fieldErrors).toEqual({
        evidenceReference: ["Identifica la evidencia con al menos 3 caracteres."],
        reconciliationNotes: ["Documenta la diferencia encontrada."],
      })
      expect(saveDenominator).not.toHaveBeenCalled()
    })

    it("closeSafetyIndicatorPeriodAction — antes llegaba sin ningún chequeo runtime", async () => {
      guardPermission.mockResolvedValue({ session, error: null })

      const result = await closeSafetyIndicatorPeriodAction({
        worksiteId: "ws-own", year: 2026, month: 7, reason: "corto",
      })

      expect(result.ok).toBe(false)
      expect(result.fieldErrors).toEqual({ reason: ["Too small: expected string to have >=10 characters"] })
      expect(closePeriod).not.toHaveBeenCalled()
    })

    it("approveSafetyIndicatorDenominatorAction — antes un input inválido caía como unexpectedActionError", async () => {
      guardPermission.mockResolvedValue({ session, error: null })

      const result = await approveSafetyIndicatorDenominatorAction({ denominatorId: "den-1" })

      expect(result.ok).toBe(false)
      expect(result.fieldErrors).toMatchObject({
        expectedVersion: expect.any(Array),
        decision: expect.any(Array),
        reason: expect.any(Array),
      })
      expect(approveDenominator).not.toHaveBeenCalled()
    })
  })

  describe("success path is unchanged for the newly-validated actions", () => {
    it("closeSafetyIndicatorPeriodAction forwards the validated data to the service", async () => {
      guardPermission.mockResolvedValue({ session, error: null })
      closePeriod.mockResolvedValue({})
      const input = { worksiteId: "ws-own", year: 2026, month: 7, reason: "Conciliación mensual aprobada y documentada." }

      const result = await closeSafetyIndicatorPeriodAction(input)

      expect(result).toEqual({ ok: true })
      expect(closePeriod).toHaveBeenCalledWith(input, "trusted-user", { mode: "some", ids: ["ws-own"] })
    })

    it("approveSafetyIndicatorDenominatorAction forwards the validated data to the service", async () => {
      guardPermission.mockResolvedValue({ session, error: null })
      approveDenominator.mockResolvedValue({})
      const input = { denominatorId: "den-1", expectedVersion: 1, decision: "approved" as const, reason: "Evidencia y conciliación revisadas." }

      const result = await approveSafetyIndicatorDenominatorAction(input)

      expect(result).toEqual({ ok: true })
      expect(approveDenominator).toHaveBeenCalledWith(input, {
        userId: "trusted-user",
        scope: { mode: "some", ids: ["ws-own"] },
        permissions: session.user.permissions,
      })
    })
  })
})
