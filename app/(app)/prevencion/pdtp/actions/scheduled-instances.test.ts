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

vi.mock("@/lib/auth/can", () => ({ guardAuth }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/services/pdtp/scheduled-execution", () => ({
  recordPdtpScheduledInstanceOutcome,
  getPdtpScheduledInstanceStartContext,
  startPdtpScheduledInstance: vi.fn(),
}))

import { recordPdtpScheduledInstanceOutcomeAction } from "./scheduled-instances"

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
