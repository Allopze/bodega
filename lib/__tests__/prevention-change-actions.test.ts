/**
 * Fase 1 H-27 paso 4a: las 4 actions de gestión del cambio
 * (createChangeRequestAction, evaluateChangeDimensionAction,
 * approveChangeRequestAction, rejectChangeRequestAction) migradas a
 * parseZ. Cubre el boundary de validación (input inválido rechazado sin
 * invocar el servicio) y que el camino exitoso sigue funcionando igual
 * que antes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGuardPermission = vi.hoisted(() => vi.fn())
const mockResolveWorksiteScope = vi.hoisted(() => vi.fn())
const mockCreateChangeRequest = vi.hoisted(() => vi.fn())
const mockEvaluateChangeDimension = vi.hoisted(() => vi.fn())
const mockApproveChangeRequest = vi.hoisted(() => vi.fn())
const mockRejectChangeRequest = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission: mockGuardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: mockResolveWorksiteScope }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
// Mockea solo las funciones de servicio; deja pasar createSchema,
// evaluateSchema, approveSchema y rejectSchema reales para que el boundary
// parseZ de cada action valide contra el schema de producción real, no un
// doble de prueba que pueda divergir.
vi.mock("@/lib/services/prevention-change", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/prevention-change")>()
  return {
    ...actual,
    createChangeRequest: mockCreateChangeRequest,
    evaluateChangeDimension: mockEvaluateChangeDimension,
    approveChangeRequest: mockApproveChangeRequest,
    rejectChangeRequest: mockRejectChangeRequest,
  }
})

const session = {
  user: { id: "user-1", permissions: ["prevention:change:manage", "prevention:change:evaluate", "prevention:change:approve"] },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGuardPermission.mockResolvedValue({ session, error: null })
  mockResolveWorksiteScope.mockReturnValue({ mode: "all", ids: [] })
  mockCreateChangeRequest.mockResolvedValue({ id: "chg-1" })
  mockEvaluateChangeDimension.mockResolvedValue({ id: "assess-1" })
  mockApproveChangeRequest.mockResolvedValue({ id: "chg-1" })
  mockRejectChangeRequest.mockResolvedValue({ id: "chg-1" })
})

describe("createChangeRequestAction", () => {
  it("forwards validated input to the service on success", async () => {
    const { createChangeRequestAction } = await import("@/app/(app)/prevencion/gestion-cambio/actions")
    const input = {
      worksiteId: "ws-1", title: "Cambio de proveedor de andamios", changeType: "proveedor",
      description: "Se reemplaza al proveedor actual por incumplimientos reiterados de norma.",
      reason: "Riesgo de caída documentado en la última auditoría.",
    }

    const res = await createChangeRequestAction(input)

    expect(res.ok).toBe(true)
    expect(mockCreateChangeRequest).toHaveBeenCalledTimes(1)
    const [calledInput] = mockCreateChangeRequest.mock.calls[0]!
    expect(calledInput).toMatchObject({ worksiteId: "ws-1", title: input.title, riskLevel: "medium" })
  })

  it("rejects invalid input via the parseZ boundary before calling the service", async () => {
    const { createChangeRequestAction } = await import("@/app/(app)/prevencion/gestion-cambio/actions")

    // title de 2 caracteres viola createSchema (min 3).
    const res = await createChangeRequestAction({
      worksiteId: "ws-1", title: "ab", changeType: "proveedor",
      description: "Se reemplaza al proveedor actual por incumplimientos reiterados de norma.",
      reason: "Riesgo documentado.",
    })

    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.title).toBeDefined()
    expect(mockCreateChangeRequest).not.toHaveBeenCalled()
  })

  it("rejects when the permission guard fails, without reaching parseZ or the service", async () => {
    mockGuardPermission.mockResolvedValue({
      session: null,
      error: { ok: false, message: "No tienes permisos para realizar esta acción" },
    })
    const { createChangeRequestAction } = await import("@/app/(app)/prevencion/gestion-cambio/actions")

    const res = await createChangeRequestAction({ worksiteId: "ws-1", title: "Cambio válido" })

    expect(res.ok).toBe(false)
    expect(mockCreateChangeRequest).not.toHaveBeenCalled()
  })
})

describe("evaluateChangeDimensionAction", () => {
  it("forwards validated input to the service on success", async () => {
    const { evaluateChangeDimensionAction } = await import("@/app/(app)/prevencion/gestion-cambio/actions")
    const input = { changeRequestId: "chg-1", dimension: "risk", impacted: false }

    const res = await evaluateChangeDimensionAction(input)

    expect(res.ok).toBe(true)
    expect(mockEvaluateChangeDimension).toHaveBeenCalledTimes(1)
    const [calledInput] = mockEvaluateChangeDimension.mock.calls[0]!
    expect(calledInput).toMatchObject({ changeRequestId: "chg-1", dimension: "risk", impacted: false, actionRequired: false })
  })

  it("rejects invalid input via the parseZ boundary before calling the service (actionRequired sin plazo)", async () => {
    const { evaluateChangeDimensionAction } = await import("@/app/(app)/prevencion/gestion-cambio/actions")

    // actionRequired=true exige actionDescription y targetDate (superRefine).
    const res = await evaluateChangeDimensionAction({
      changeRequestId: "chg-1", dimension: "risk", impacted: true, actionRequired: true,
    })

    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.actionDescription).toBeDefined()
    expect(res.fieldErrors?.targetDate).toBeDefined()
    expect(mockEvaluateChangeDimension).not.toHaveBeenCalled()
  })

  it("rejects when the permission guard fails, without reaching parseZ or the service", async () => {
    mockGuardPermission.mockResolvedValue({
      session: null,
      error: { ok: false, message: "No tienes permisos para realizar esta acción" },
    })
    const { evaluateChangeDimensionAction } = await import("@/app/(app)/prevencion/gestion-cambio/actions")

    const res = await evaluateChangeDimensionAction({ changeRequestId: "chg-1", dimension: "risk", impacted: false })

    expect(res.ok).toBe(false)
    expect(mockEvaluateChangeDimension).not.toHaveBeenCalled()
  })
})

describe("approveChangeRequestAction", () => {
  it("forwards validated input to the service on success", async () => {
    const { approveChangeRequestAction } = await import("@/app/(app)/prevencion/gestion-cambio/actions")
    const input = { changeRequestId: "chg-1", expectedVersion: 2, plannedReviewDate: "2026-09-01" }

    const res = await approveChangeRequestAction(input)

    expect(res.ok).toBe(true)
    expect(mockApproveChangeRequest).toHaveBeenCalledTimes(1)
    const [calledInput] = mockApproveChangeRequest.mock.calls[0]!
    expect(calledInput).toEqual(input)
  })

  it("rejects invalid input via the parseZ boundary before calling the service", async () => {
    const { approveChangeRequestAction } = await import("@/app/(app)/prevencion/gestion-cambio/actions")

    // plannedReviewDate no cumple el formato YYYY-MM-DD.
    const res = await approveChangeRequestAction({ changeRequestId: "chg-1", expectedVersion: 2, plannedReviewDate: "01-09-2026" })

    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.plannedReviewDate).toBeDefined()
    expect(mockApproveChangeRequest).not.toHaveBeenCalled()
  })

  it("rejects when the permission guard fails, without reaching parseZ or the service", async () => {
    mockGuardPermission.mockResolvedValue({
      session: null,
      error: { ok: false, message: "No tienes permisos para realizar esta acción" },
    })
    const { approveChangeRequestAction } = await import("@/app/(app)/prevencion/gestion-cambio/actions")

    const res = await approveChangeRequestAction({ changeRequestId: "chg-1", expectedVersion: 2, plannedReviewDate: "2026-09-01" })

    expect(res.ok).toBe(false)
    expect(mockApproveChangeRequest).not.toHaveBeenCalled()
  })
})

describe("rejectChangeRequestAction", () => {
  it("forwards validated input to the service on success", async () => {
    const { rejectChangeRequestAction } = await import("@/app/(app)/prevencion/gestion-cambio/actions")
    const input = { changeRequestId: "chg-1", expectedVersion: 2, rejectedReason: "Falta evaluación de impacto en MIPER." }

    const res = await rejectChangeRequestAction(input)

    expect(res.ok).toBe(true)
    expect(mockRejectChangeRequest).toHaveBeenCalledTimes(1)
    const [calledInput] = mockRejectChangeRequest.mock.calls[0]!
    expect(calledInput).toEqual(input)
  })

  it("rejects invalid input via the parseZ boundary before calling the service", async () => {
    const { rejectChangeRequestAction } = await import("@/app/(app)/prevencion/gestion-cambio/actions")

    // rejectedReason de 3 caracteres viola rejectSchema (min 5).
    const res = await rejectChangeRequestAction({ changeRequestId: "chg-1", expectedVersion: 2, rejectedReason: "no" })

    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.rejectedReason).toBeDefined()
    expect(mockRejectChangeRequest).not.toHaveBeenCalled()
  })

  it("rejects when the permission guard fails, without reaching parseZ or the service", async () => {
    mockGuardPermission.mockResolvedValue({
      session: null,
      error: { ok: false, message: "No tienes permisos para realizar esta acción" },
    })
    const { rejectChangeRequestAction } = await import("@/app/(app)/prevencion/gestion-cambio/actions")

    const res = await rejectChangeRequestAction({ changeRequestId: "chg-1", expectedVersion: 2, rejectedReason: "Motivo válido y trazable." })

    expect(res.ok).toBe(false)
    expect(mockRejectChangeRequest).not.toHaveBeenCalled()
  })
})
