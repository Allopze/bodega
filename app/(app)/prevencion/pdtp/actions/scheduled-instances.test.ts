/**
 * PREV-I08-c: la acción de resultado de una ocurrencia programada confiaba en
 * `sourceMetadata` del cliente. Con `{ sourceApproved: true, sourceRecordId }`
 * completaba sin aprobación ni guarda de mes cerrado. Ahora el estado
 * "cumplida" sólo lo deriva el servidor desde la ejecución aprobada (D19); la
 * vía manual admite enviar, "no aplica" y cancelar.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const guardAuth = vi.hoisted(() => vi.fn())
const resolveWorksiteScope = vi.hoisted(() => vi.fn())
const recordPdtpScheduledInstanceOutcome = vi.hoisted(() => vi.fn())
const getPdtpScheduledInstanceStartContext = vi.hoisted(() => vi.fn())
const reviewPdtpScheduledInstanceOutcome = vi.hoisted(() => vi.fn())
const withdrawPdtpScheduledInstanceOutcomeRequest = vi.hoisted(() => vi.fn())
const guardPermission = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardAuth, guardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/services/pdtp/scheduled-execution", () => ({
  recordPdtpScheduledInstanceOutcome,
  getPdtpScheduledInstanceStartContext,
  startPdtpScheduledInstance: vi.fn(),
}))
vi.mock("@/lib/services/pdtp/scheduled-outcome-review", () => ({
  reviewPdtpScheduledInstanceOutcome,
  withdrawPdtpScheduledInstanceOutcomeRequest,
}))

import {
  recordPdtpScheduledInstanceOutcomeAction,
  reviewPdtpScheduledInstanceOutcomeAction,
  withdrawPdtpScheduledInstanceOutcomeAction,
} from "./scheduled-instances"

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const session = { user: { id: "trusted-user", permissions: ["prevention:inspections:execute", "prevention:pdtp:override:manage", "prevention:pdtp:obligation:cancel"] } }

describe("recordPdtpScheduledInstanceOutcomeAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guardAuth.mockResolvedValue({ session, error: null })
    resolveWorksiteScope.mockReturnValue({ mode: "all" })
    getPdtpScheduledInstanceStartContext.mockResolvedValue({
      instance: { id: "inst-1", worksiteId: "ws-1", programId: "prog-1" },
      connector: { key: "inspections", executePermission: "prevention:inspections:execute" },
    })
    recordPdtpScheduledInstanceOutcome.mockResolvedValue({ id: "inst-1", programId: "prog-1", status: "submitted" })
  })

  it("autentica antes de validar: sin sesión no llama al servicio aunque el input sea inválido", async () => {
    const error = { ok: false, message: "No autenticado" }
    guardAuth.mockResolvedValue({ session: null, error })
    await expect(recordPdtpScheduledInstanceOutcomeAction({ nada: true })).resolves.toEqual(error)
    expect(recordPdtpScheduledInstanceOutcome).not.toHaveBeenCalled()
  })

  it("descarta los metadatos del cliente y usa el actor de la sesión", async () => {
    await expect(recordPdtpScheduledInstanceOutcomeAction({
      instanceId: "inst-1",
      action: "submit",
      sourceMetadata: { sourceApproved: true, sourceRecordId: "x", executionId: "forjada" },
      userId: "forged",
    })).resolves.toMatchObject({ ok: true })
    expect(recordPdtpScheduledInstanceOutcome).toHaveBeenCalledTimes(1)
    const call = recordPdtpScheduledInstanceOutcome.mock.calls[0]![0]
    expect(call).not.toHaveProperty("sourceMetadata")
    expect(call).toMatchObject({ instanceId: "inst-1", action: "submit", userId: "trusted-user" })
  })

  it("no ofrece completar a mano: la ocurrencia se completa al aprobar su ejecución (D19)", async () => {
    const result = await recordPdtpScheduledInstanceOutcomeAction({ instanceId: "inst-1", action: "complete" })
    expect(result.ok).toBe(false)
    expect(recordPdtpScheduledInstanceOutcome).not.toHaveBeenCalled()
  })
})

describe("'no aplica' y cancelación de una ocurrencia en revisión (PREV-C07, 0334)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guardAuth.mockResolvedValue({ session, error: null })
    guardPermission.mockResolvedValue({ session: { user: { id: "revisor", permissions: ["prevention:pdtp:approve"] } }, error: null })
    resolveWorksiteScope.mockReturnValue({ mode: "some", ids: ["ws-1"] })
    getPdtpScheduledInstanceStartContext.mockResolvedValue({
      instance: { id: "inst-1", worksiteId: "ws-1", programId: "prog-1" },
      connector: { key: "inspections", executePermission: "prevention:inspections:execute" },
    })
  })

  it("al pedir 'no aplica' avisa que queda en revisión", async () => {
    recordPdtpScheduledInstanceOutcome.mockResolvedValue({ id: "inst-1", programId: "prog-1", status: "pending", outcomeRequestId: "req-1" })
    const result = await recordPdtpScheduledInstanceOutcomeAction({ instanceId: "inst-1", action: "not_applicable", reason: "La faena estuvo detenida" })
    expect(result).toMatchObject({ ok: true, data: { instanceId: "inst-1", status: "pending", outcomeRequestId: "req-1", pendingReview: true } })
    expect(result.message).toMatch(/revisión/)
  })

  it("revisar exige prevention:pdtp:approve y pasa el alcance del revisor", async () => {
    reviewPdtpScheduledInstanceOutcome.mockResolvedValue({ id: "req-1", status: "approved" })
    const result = await reviewPdtpScheduledInstanceOutcomeAction(form({ requestId: "req-1", decision: "approve" }))
    expect(result.ok).toBe(true)
    expect(guardPermission).toHaveBeenCalledWith("prevention:pdtp:approve")
    expect(reviewPdtpScheduledInstanceOutcome).toHaveBeenCalledWith({ requestId: "req-1", decision: "approve", reason: "" }, "revisor", ["ws-1"])
  })

  it("sin el permiso no revisa", async () => {
    const error = { ok: false, message: "Sin permiso" }
    guardPermission.mockResolvedValue({ session: null, error })
    await expect(reviewPdtpScheduledInstanceOutcomeAction(form({ requestId: "req-1", decision: "approve" }))).resolves.toEqual(error)
    expect(reviewPdtpScheduledInstanceOutcome).not.toHaveBeenCalled()
  })

  it("un rechazo sin motivo no llega al servicio", async () => {
    const result = await reviewPdtpScheduledInstanceOutcomeAction(form({ requestId: "req-1", decision: "reject", reason: "no" }))
    expect(result.ok).toBe(false)
    expect(reviewPdtpScheduledInstanceOutcome).not.toHaveBeenCalled()
  })

  it("el error del servicio (p. ej. revisar lo propio) vuelve como mensaje", async () => {
    reviewPdtpScheduledInstanceOutcome.mockRejectedValue(new Error("No puedes revisar tu propia solicitud: debe hacerlo otra persona."))
    const result = await reviewPdtpScheduledInstanceOutcomeAction(form({ requestId: "req-1", decision: "approve" }))
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/otra persona/) })
  })

  it("retirar usa el actor de la sesión (el servicio exige que sea quien la pidió)", async () => {
    withdrawPdtpScheduledInstanceOutcomeRequest.mockResolvedValue({ id: "req-1", status: "withdrawn" })
    const result = await withdrawPdtpScheduledInstanceOutcomeAction(form({ requestId: "req-1" }))
    expect(result.ok).toBe(true)
    expect(withdrawPdtpScheduledInstanceOutcomeRequest).toHaveBeenCalledWith({ requestId: "req-1", reason: "" }, "trusted-user", ["ws-1"])
  })
})
